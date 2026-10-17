import { type Architecture, type Flow, NODE_KINDS } from "@tka/shared";
import type { IfIgnored, IssueData } from "./types";

// AI の出力を信用しすぎないための整形。共有スキーマは day などの範囲を見ないので、丸めはここで行う

export function cleanArchitecture(
  arch: Architecture | null | undefined,
): Architecture {
  const nodes: Architecture["nodes"] = [];
  const ids = new Set<string>();
  for (const n of arch?.nodes ?? []) {
    const id = String(n.id ?? "").trim();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    nodes.push({
      id,
      label: String(n.label ?? id),
      kind: NODE_KINDS.includes(n.kind) ? n.kind : "internal",
    }); // 位置はフロントが自動で決める
  }
  const edges = (arch?.edges ?? [])
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      label: String(e.label ?? ""),
      direction: e.direction === "both" ? ("both" as const) : ("one" as const),
      kind: e.kind === "ops" ? ("ops" as const) : ("runtime" as const),
    }));
  return { nodes, edges };
}

/** 構成図にない人・通信は捨てる (逆向きは direction が both の edge だけ)。feature_ids は有効な機能 ID だけ残す */
export function cleanFlows(
  flows: Flow[] | null | undefined,
  arch: Architecture,
  featureIds: Iterable<string> = [],
): Flow[] {
  const nodeIds = new Set(arch.nodes.map((n) => n.id));
  const features = new Set(featureIds);
  const ok = new Set<string>();
  for (const e of arch.edges) {
    ok.add(`${e.from}\0${e.to}`);
    if (e.direction === "both") ok.add(`${e.to}\0${e.from}`);
  }
  const out: Flow[] = [];
  for (const f of flows ?? []) {
    if (!f || !nodeIds.has(f.actor)) continue;
    const steps = (f.steps ?? [])
      .filter((s) => s && ok.has(`${s.from}\0${s.to}`))
      .map((s) => ({ from: s.from, to: s.to, label: String(s.label ?? "") }));
    if (steps.length === 0) continue;
    const n = Number(f.per_day ?? 1);
    out.push({
      actor: f.actor,
      title: String(f.title ?? ""),
      per_day: Number.isNaN(n) ? 1 : Math.min(Math.max(n, 0), 100000),
      feature_ids: [...new Set(f.feature_ids ?? [])].filter((x) =>
        features.has(x),
      ),
      steps,
    });
  }
  return out;
}

/** 台本の「見送ったらどうなるか」を整える。使えない形なら null */
export function cleanIfIgnored(
  ii: Partial<IfIgnored> | null | undefined,
): IfIgnored | null {
  if (!ii || (ii.impact !== "none" && ii.impact !== "escalate")) return null;
  const title = String(ii.incident_title ?? "");
  if (ii.impact === "escalate" && !title.trim()) return null;
  const n = Math.trunc(Number(ii.after_days ?? 0));
  const after = Number.isNaN(n) ? 0 : n;
  return {
    impact: ii.impact,
    reason: String(ii.reason ?? ""),
    after_days: ii.impact === "escalate" ? Math.max(7, Math.min(90, after)) : 0,
    incident_title: title,
    incident_story: String(ii.incident_story ?? ""),
    signals: (ii.signals ?? [])
      .filter((s) => s && typeof s === "object")
      .slice(0, 8),
  };
}

const NO_FOLLOWUP = (reason: string): IfIgnored => ({
  impact: "none",
  reason,
  after_days: 0,
  incident_title: "",
  incident_story: "",
  signals: [],
});

/** 見送ったときの結果。台本に無い (古いデータ・モック) ときは重要度から決める */
export function ifIgnoredFor(
  issue: Partial<IssueData> & Pick<IssueData, "title">,
): IfIgnored {
  if (issue.escalated_from)
    return NO_FOLLOWUP(
      "一度見送った結果の出来事なので、ここから先の影響はシミュレーションしていません。",
    );
  const ii = cleanIfIgnored(issue.if_ignored);
  if (ii) return ii;
  const sev = issue.severity;
  if (sev === "低")
    return NO_FOLLOWUP(
      "影響の範囲が小さく、放っておいても運用への影響は小さいと見込まれます。",
    );
  const who =
    (issue.who_is_affected || "利用者")
      .replaceAll("(", "（")
      .split("（")[0]
      ?.split("、")[0]
      ?.trim() || "利用者";
  return {
    impact: "escalate",
    reason:
      "原因が残ったままなので、時間がたつほど影響が広がると見込まれます。",
    after_days: sev === "高" ? 21 : 35,
    incident_title: `見送っていた問題が原因で、${who}への影響が広がっていることがわかった`,
    incident_story: `前に見送った「${issue.title}」は、その後も直されないまま運用が続いていた。気づいたときには、最初に見えていたときより影響が大きくなっていた。`,
    signals: [
      {
        time: "09:12:40",
        source: "監視",
        level: "warn",
        text: "同じ種類のエラー・警告が先月の3倍に増加",
      },
      {
        time: "10:30:05",
        source: "問い合わせ",
        level: "error",
        text: "「前にも似たことがありましたよね？まだ直っていないんですか？」",
      },
      {
        time: "11:02:18",
        source: "社内チャット",
        level: "warn",
        text: "「これ、前に見送ったやつと同じ原因じゃない？」",
      },
    ],
  };
}

/** 1〜max の整数に丸める (数値でなければ 1) */
export function clampDay(day: number, max: number): number {
  const n = Math.trunc(Number(day));
  return Number.isNaN(n) ? 1 : Math.max(1, Math.min(max, n));
}

/** 同じ日に出来事が重ならないよう、後ろへずらす */
export function uniqueDay(
  day: number,
  used: Iterable<number>,
  max: number,
): number {
  const taken = new Set(used);
  let d = clampDay(day, max);
  // shortcut: max 日まで埋まっていると max で重なる, 出来事が180件近くなったら考える
  while (taken.has(d) && d < max) d++;
  return d;
}

/** 運用を先に進めてよい状態か (対応済み・修正で回避・見送り) */
export function settled(
  issue: Pick<IssueData, "feedback" | "prevented_by" | "skipped">,
): boolean {
  return Boolean(issue.feedback || issue.prevented_by || issue.skipped);
}
