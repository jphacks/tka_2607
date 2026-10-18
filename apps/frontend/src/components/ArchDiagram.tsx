import { graphlib, layout } from "@dagrejs/dagre";
import { useMemo, useState } from "react";
import type { Architecture, ArchNode } from "#/lib/types";

const BOX_H = 48;
const MIN_W = 120;
const MAX_W = 240;
const BOX_PAD = 24; // 箱の左右の余白の合計
const MARGIN = 20;

const KIND_LABEL: Record<ArchNode["kind"], string> = {
  internal: "自社システム",
  db: "データベース",
  partner: "取引先",
  person: "人",
  external: "外部",
};

// 色はモックに合わせる
const KIND_CLASS: Record<ArchNode["kind"], string> = {
  internal: "fill-tint stroke-[#9fc8b6] dark:stroke-[#2f6b58]",
  db: "fill-[#f1f4f7] stroke-[#b6c0ca] dark:fill-[#1a2126] dark:stroke-[#4a5761]",
  partner:
    "fill-[#eef3fa] stroke-[#a9bfdc] dark:fill-[#19232e] dark:stroke-[#3d5878]",
  person:
    "fill-white stroke-[#c9d0d6] dark:fill-[#161c20] dark:stroke-[#4a5761]",
  external:
    "fill-white stroke-[#9aa5b1] [stroke-dasharray:5_4] dark:fill-[#161c20] dark:stroke-[#6b7782]",
};

type Pt = { x: number; y: number };

// 表示用に括弧書きを外す（正式名は title で出す）
const shortLabel = (s: string) =>
  s.replace(/（[^）]*）|\([^)]*\)/g, "").trim() || s;

// 文字幅の目安（14px 太字）。ASCII は細く、日本語などは太く数える
const charW = (c: string) => (c.charCodeAt(0) < 128 ? 8.6 : 14.5);
const textW = (s: string) => [...s].reduce((a, c) => a + charW(c), 0);

function fitLabel(s: string, w: number) {
  const max = w - BOX_PAD;
  if (textW(s) <= max) return s;
  let acc = 0;
  let out = "";
  for (const c of s) {
    if (acc + charW(c) > max - 10) break;
    acc += charW(c);
    out += c;
  }
  return `${out}…`;
}

const boxW = (label: string) =>
  Math.min(
    MAX_W,
    Math.max(MIN_W, Math.ceil(textW(shortLabel(label)) + BOX_PAD)),
  );

function smooth(pts: Pt[]) {
  const last = pts[pts.length - 1];
  if (pts.length < 3) return `M${pts[0].x},${pts[0].y} L${last.x},${last.y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = {
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
    };
    d += ` Q${pts[i].x},${pts[i].y} ${m.x},${m.y}`;
  }
  return `${d} L${last.x},${last.y}`;
}

// 同じ from/to を持つ複数の線（並列通信）を区別するため label も含める
const edgeKey = (e: { from: string; to: string; label: string }) =>
  `${e.from}>${e.to}:${e.label}`;

type Props = {
  arch: Architecture;
  affected?: string[];
  /** 平常時に「通信中」として動かす線の番号（arch.edges の添字） */
  liveEdges?: number[];
  compact?: boolean;
};

export function ArchDiagram({
  arch,
  affected = [],
  liveEdges = [],
  compact = false,
}: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const { boxes, paths, W, H } = useMemo(() => {
    const g = new graphlib.Graph({ multigraph: true });
    g.setGraph({
      rankdir: "LR",
      nodesep: 24,
      ranksep: 70,
      edgesep: 12,
      marginx: MARGIN,
      marginy: MARGIN,
    });
    g.setDefaultEdgeLabel(() => ({}));
    const widths: Record<string, number> = {};
    for (const n of arch.nodes) {
      widths[n.id] = boxW(n.label);
      g.setNode(n.id, { width: widths[n.id], height: BOX_H });
    }
    for (const e of arch.edges)
      g.setEdge({ v: e.from, w: e.to, name: edgeKey(e) });
    layout(g);
    const boxes: Record<string, { x: number; y: number; w: number }> = {};
    for (const n of arch.nodes)
      boxes[n.id] = { x: g.node(n.id).x, y: g.node(n.id).y, w: widths[n.id] };
    const paths: Record<string, Pt[]> = {};
    for (const o of g.edges()) paths[o.name ?? ""] = g.edge(o).points;
    const gl = g.graph();
    return { boxes, paths, W: gl.width ?? 0, H: gl.height ?? 0 };
  }, [arch]);

  if (arch.nodes.length === 0)
    return <p className="text-sm text-muted-foreground">構成図はありません</p>;

  const bad = new Set(affected);
  const label = (id: string) =>
    arch.nodes.find((n) => n.id === id)?.label ?? id;
  const edgeState = (e: { from: string; to: string }, i: number) =>
    bad.has(e.from) && bad.has(e.to)
      ? "bad"
      : liveEdges.includes(i)
        ? "live"
        : "";
  const drawn = arch.edges.map((e, i) => ({
    e,
    i,
    d: paths[edgeKey(e)]?.length >= 2 ? smooth(paths[edgeKey(e)]) : null,
  }));
  const near = new Set<string>();
  if (hover) {
    near.add(hover);
    for (const { e } of drawn) {
      if (e.from === hover) near.add(e.to);
      if (e.to === hover) near.add(e.from);
    }
  }

  return (
    <div>
      <svg
        className={`mx-auto h-auto w-full ${compact ? "max-h-[520px]" : "max-h-[600px]"}`}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`システム構成図：${arch.nodes.map((n) => n.label).join("、")}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>

        {drawn.map(({ e, i, d }) => {
          if (!d) return null;
          const st = edgeState(e, i);
          const focus = hover
            ? e.from === hover || e.to === hover
              ? ""
              : "opacity-20"
            : "";
          const stroke =
            st === "bad"
              ? "stroke-error stroke-[2.2] [stroke-dasharray:6_4] animate-[arch-dash_0.8s_linear_infinite]"
              : st === "live"
                ? "stroke-primary stroke-[2.2]"
                : "stroke-[#b6c0ca] stroke-[1.6] dark:stroke-[#4a5761]";
          return (
            <g key={edgeKey(e)} className={`transition-opacity ${focus}`}>
              <path
                d={d}
                className={`fill-none ${stroke}`}
                markerEnd="url(#arrow)"
              />
              {st === "live" && (
                <circle r="4" className="fill-primary">
                  {/* 終わったあと原点に戻って見えないよう、最後は消して止める */}
                  <animateMotion
                    dur="0.9s"
                    repeatCount="1"
                    fill="freeze"
                    path={d}
                  />
                  <animate
                    attributeName="opacity"
                    values="1;1;0"
                    keyTimes="0;0.9;1"
                    dur="0.9s"
                    fill="freeze"
                  />
                </circle>
              )}
              <title>
                {label(e.from)} → {label(e.to)}：{e.label}
              </title>
            </g>
          );
        })}

        {arch.nodes.map((n) => {
          const b = boxes[n.id];
          const isBad = bad.has(n.id);
          const dim = hover && !near.has(n.id) ? "opacity-30" : "";
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: 図の上でマウスを乗せた箱の周りを強調するだけ
            <g
              key={n.id}
              className={`transition-opacity ${dim}`}
              transform={`translate(${b.x - b.w / 2},${b.y - BOX_H / 2})`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            >
              {isBad && (
                <rect
                  x={-6}
                  y={-6}
                  width={b.w + 12}
                  height={BOX_H + 12}
                  rx={12}
                  className="animate-pulse fill-none stroke-error stroke-2 opacity-40"
                />
              )}
              <rect
                width={b.w}
                height={BOX_H}
                rx={8}
                className={
                  isBad
                    ? "fill-warn-tint stroke-error stroke-2"
                    : `stroke-[1.4] ${KIND_CLASS[n.kind]}`
                }
              />
              <text
                x={12}
                y={18}
                className={`text-[11px] ${isBad ? "fill-error font-medium" : "fill-muted-foreground"}`}
              >
                {KIND_LABEL[n.kind]}
              </text>
              {/* 「影響あり」は箱の右上に札として重ねる（種類の横に並べると、狭い箱からはみ出す） */}
              {isBad && (
                <g transform={`translate(${b.w - 58},-9)`}>
                  <rect width={52} height={18} rx={9} className="fill-error" />
                  <text
                    x={26}
                    y={12.5}
                    textAnchor="middle"
                    className="fill-white text-[10.5px] font-bold"
                  >
                    影響あり
                  </text>
                </g>
              )}
              <text x={12} y={38} className="fill-foreground text-sm font-bold">
                {fitLabel(shortLabel(n.label), b.w)}
              </text>
              <title>{n.label}</title>
            </g>
          );
        })}
      </svg>

      {!compact && (
        <ol className="mt-3 grid gap-x-5 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
          {drawn.map(({ e, i }) => (
            <li
              key={edgeKey(e)}
              className={`flex flex-wrap items-baseline gap-x-3 ${edgeState(e, i) === "bad" ? "text-error" : "text-sub"}`}
            >
              <span
                className={`flex size-[18px] items-center justify-center rounded-full border text-[10.5px] font-bold ${edgeState(e, i) === "bad" ? "border-error bg-error text-white" : "border-[#9aa5b1] dark:border-[#6b7782]"}`}
              >
                {i + 1}
              </span>
              <span
                className={`font-medium whitespace-nowrap ${edgeState(e, i) === "bad" ? "" : "text-foreground"}`}
              >
                {shortLabel(label(e.from))} → {shortLabel(label(e.to))}
              </span>
              <span className="text-muted-foreground">{e.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
