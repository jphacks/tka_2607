import {
  IconArrowDown,
  IconBulb,
  IconPlayerPlayFilled,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArchDiagram } from "#/components/ArchDiagram";
import { CodeView } from "#/components/CodeView";
import { Crumbs, crumbLinkClass } from "#/components/Crumbs";
import { DiffView } from "#/components/DiffView";
import { ErrorBox } from "#/components/ErrorBox";
import { FixView } from "#/components/FixView";
import { LogView } from "#/components/LogView";
import { SkipForm } from "#/components/SkipForm";
import { Button } from "#/components/starwind/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#/components/starwind/tabs";
import { Textarea } from "#/components/starwind/textarea";
import { Waiting } from "#/components/Waiting";
import { api } from "#/lib/api";
import { chosenLabel, limitDay, MIN_PLAN } from "#/lib/judge";
import type { ChatMessage, Issue, ProjectView } from "#/lib/types";
import { useDetail } from "#/lib/useDetail";
import { useProject } from "#/lib/useProject";

export const Route = createFileRoute("/p/$pid/i/$iid")({
  component: IssueRoute,
});

// 「直す」は反映を待つだけで若手の操作がないので、「決める」とまとめて1つのステップにしている
const STEPS = ["調べる", "決めて直す", "振り返る"];

type Tab = "code" | "infra" | "log" | "fix";
type Busy = "" | "start" | "chat" | "hint" | "commit" | "skip";

const TAB_CLASS =
  "grow-0 rounded-none border-0 border-b-2 border-transparent px-3.5 py-2 text-sub data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none";
// 修正の結果のタブは、選んでいてもいなくても緑で目立たせる（Starwind の既定の文字色やダーク時の色も上書きする）
const FIX_TAB_CLASS =
  "grow-0 rounded-none border-0 border-b-2 border-transparent px-3.5 py-2 font-medium text-primary data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none dark:text-primary";
const TAB_COUNT =
  "rounded-lg bg-line-soft px-1.5 text-[11px] font-normal text-sub";

const SEVERITY_CLASS = {
  高: "border-error text-error",
  中: "border-sub text-foreground",
  低: "text-sub",
} as const;

function IssueRoute() {
  const { pid, iid } = Route.useParams();
  const { project: p, setProject, error } = useProject(pid);
  const issue = p?.issues.find((x) => x.id === iid);

  if (!p || !issue) {
    return (
      <div className="grid gap-4">
        {error || p ? (
          <>
            <ErrorBox message={error || "出来事が見つかりません。"} />
            <Link to="/" className="underline">
              アプリを登録する
            </Link>
          </>
        ) : (
          <Waiting text="読み込み中" />
        )}
      </div>
    );
  }
  return <DetailGate p={p} issue={issue} onProject={setProject} />;
}

// 本文が未生成の出来事は、作ってから開く (空の本文を見せない)
function DetailGate({
  p,
  issue,
  onProject,
}: {
  p: ProjectView;
  issue: Issue;
  onProject: (p: ProjectView) => void;
}) {
  const { loading, error, retry } = useDetail(p, issue, onProject);
  if (loading)
    return (
      <div className="grid gap-5">
        <Crumbs
          parent={
            <Link
              to="/p/$pid"
              params={{ pid: p.id }}
              className={crumbLinkClass}
            >
              {p.background.title}
            </Link>
          }
          current={`${issue.day}日目の出来事`}
        />
        <div className="grid gap-3 rounded-r-lg border-l-4 border-error bg-warn-tint px-5 py-4">
          <div>
            <p className="text-xs font-bold tracking-wider text-error">
              運用 {issue.day}日目に発生
            </p>
            <h1 className="mt-1 text-[22px] leading-snug font-bold">
              {issue.incident_title}
            </h1>
          </div>
          <Waiting
            text="出来事の詳細を書いています"
            pid={p.id}
            iid={issue.id}
          />
        </div>
      </div>
    );
  if (error)
    return (
      <div className="grid gap-4">
        <ErrorBox message={error} />
        <Button variant="primary" className="self-start" onClick={retry}>
          もう一度試す
        </Button>
      </div>
    );
  return (
    <IssuePage
      key={`${p.id}/${issue.id}`}
      p={p}
      issue={issue}
      onProject={onProject}
    />
  );
}

function stepOf(i: Issue, busy: Busy): number {
  if (busy === "commit") return 1;
  switch (i.phase) {
    case "decide":
    case "ready":
      return 1;
    case "reflect":
      return 2;
    case "done":
      return 3;
    default:
      return i.fix ? 2 : 0;
  }
}

// 各ステップの会話が始まる位置（chat の添字）。まだ無い、または記録が無いときは null
function stepStarts(i: Issue): (number | null)[] {
  const fix = i.chat.findIndex((m) => m.kind === "fix");
  return [
    i.chat.length > 0 ? 0 : null,
    i.decide_at ?? null,
    // 「修正を反映しました」のカードから振り返りが始まる
    fix >= 0 ? fix : null,
  ];
}

function IssuePage({
  p,
  issue: initial,
  onProject,
}: {
  p: ProjectView;
  issue: Issue;
  onProject: (p: ProjectView) => void;
}) {
  const navigate = useNavigate();
  const pid = p.id;
  const iid = initial.id;
  const [issue, setIssue] = useState(initial);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState(initial.plan_draft?.plan ?? "");
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  // 修正の結果が一番見てほしいところなので、あればそれを最初に開く
  const [tab, setTab] = useState<Tab>(
    initial.fix ? "fix" : initial.view === "infra" ? "infra" : "code",
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  // 会話を遡って見ているステップ。最新を見ているとき（今のステップ）は null
  const [viewing, setViewing] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 毎回新しい配列にならないようにする（コードのスクロール位置が入力のたびに戻るため）
  const evidence = useMemo(
    () =>
      p.findings
        .filter((f) => issue.finding_ids.includes(f.id))
        .sort((x, y) => x.file.localeCompare(y.file) || x.line - y.line),
    [p.findings, issue.finding_ids],
  );
  const logLines = useMemo(
    () => issue.signals.map((s, n) => ({ key: String(n), ...s })),
    [issue.signals],
  );

  const byId = (id?: string) =>
    id ? p.issues.find((x) => x.id === id) : undefined;
  const cause = byId(issue.caused_by);
  const preventer = byId(issue.prevented_by);
  const changer = byId(issue.changed_by?.issue_id);
  const origin = byId(issue.escalated_from);
  const escalation = byId(issue.skipped?.escalation_id);
  const firstOpenDay = limitDay(p.issues, p.sim_days);
  const handled = !!issue.fix || !!issue.feedback;
  const ready = issue.phase === "ready" && !!issue.plan_draft && !issue.fix;
  const step = stepOf(issue, busy);
  const starts = stepStarts(issue);
  const shown = Math.min(viewing ?? step, step); // ハイライトするステップ

  // 押したステップの会話の頭まで、会話欄の中だけをスクロールする（今のステップなら最新まで）
  const jumpTo = (n: number) => {
    const list = listRef.current;
    if (!list) return;
    const at = starts[n];
    const el = n >= step || at == null ? null : list.children[at];
    if (!(el instanceof HTMLElement)) {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      return;
    }
    const top =
      list.scrollTop +
      el.getBoundingClientRect().top -
      list.getBoundingClientRect().top -
      16;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };
  const showChat = !preventer && !issue.skipped;

  // 最新の発言から離れているとき「最新へ」を出し、画面の一番上にある発言がどのステップかも調べる
  const checkEnd = () => {
    const list = listRef.current;
    if (!list) return;
    const away = list.scrollHeight - list.scrollTop - list.clientHeight > 80;
    setAwayFromEnd(away);
    if (!away) return setViewing(null);
    const top = list.getBoundingClientRect().top + 24;
    let at = 0;
    for (let k = 0; k < issue.chat.length; k++) {
      const child = list.children[k];
      if (child && child.getBoundingClientRect().bottom > top) {
        at = k;
        break;
      }
    }
    let n = 0;
    for (let k = 0; k <= Math.min(step, STEPS.length - 1); k++) {
      const from = starts[k];
      if (from != null && from <= at) n = k;
    }
    setViewing(n);
  };
  const jumpToEnd = () =>
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });

  // 会話をまだ始めていなければ、最初の一言（AI を使わない）を出す
  useEffect(() => {
    if (
      issue.chat.length === 0 &&
      !issue.decision &&
      !issue.prevented_by &&
      !issue.skipped
    ) {
      setBusy("start");
      api
        .chatStart(pid, iid)
        .then(setIssue)
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(""));
    }
  }, [
    pid,
    iid,
    issue.chat.length,
    issue.decision,
    issue.prevented_by,
    issue.skipped,
  ]);

  useEffect(() => {
    setPlan(issue.plan_draft?.plan ?? "");
  }, [issue.plan_draft?.plan]);

  // 発言が増えたら、会話欄の中だけを最新までスクロールする。
  // scrollIntoView だとページ全体もスクロールし、会話欄が sticky なので、ページの一番上に飛ばされてしまう
  // biome-ignore lint/correctness/useExhaustiveDependencies: 発言の数と待ち状態が変わったときだけ動かす
  useEffect(() => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [issue.chat.length, busy]);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const resume = () =>
    navigate({ to: "/p/$pid", params: { pid }, search: { play: true } });

  const send = (hint = false) => {
    const t = text.trim();
    if (!hint && !t) return;
    const before = issue;
    if (t)
      setIssue({ ...issue, chat: [...issue.chat, { role: "user", text: t }] });
    setText("");
    return run(hint ? "hint" : "chat", async () => {
      try {
        setIssue(await api.chat(pid, iid, t, hint));
      } catch (e) {
        setText(t);
        setIssue(before);
        throw e;
      }
    });
  };

  const commit = () =>
    run("commit", async () => {
      const r = await api.commit(
        pid,
        iid,
        plan,
        issue.plan_draft?.reason ?? "",
      );
      setIssue(r.issue);
      onProject(r.project);
      setTab("fix");
    });

  const skip = (reason: string) =>
    run("skip", async () => {
      onProject(await api.skip(pid, iid, reason));
      resume();
    });

  const unskip = () =>
    run("skip", async () => {
      const np = await api.unskip(pid, iid);
      onProject(np);
      setIssue(await api.chatStart(pid, iid));
    });

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 日本語の変換を確定する Enter では送らない
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) send();
    }
  };

  return (
    <div className="grid gap-5">
      <Crumbs
        parent={
          <Link to="/p/$pid" params={{ pid }} className={crumbLinkClass}>
            {p.background.title}
          </Link>
        }
        current={`${issue.day}日目の出来事`}
      />

      <div className="grid gap-2 rounded-r-lg border-l-4 border-error bg-warn-tint px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold tracking-wider text-error">
              運用 {issue.day}日目に発生
            </p>
            {handled && (
              <span
                className={`rounded border px-2 py-px text-xs font-medium whitespace-nowrap ${SEVERITY_CLASS[issue.severity]}`}
              >
                影響 {issue.severity}
              </span>
            )}
          </div>
          <h1 className="mt-1 text-[22px] leading-snug font-bold">
            {issue.incident_title}
          </h1>
        </div>
        <p className="max-w-[48em]">{issue.incident_story}</p>
        {cause && (
          <p className="text-sm font-medium text-error">
            この出来事は、{cause.day}日目にあなたが入れた修正「
            {chosenLabel(cause)}」がきっかけで起きています。
          </p>
        )}
        {origin && (
          <p className="text-sm font-medium text-error">
            {origin.day}日目に「{origin.skipped?.reason}
            」という理由で見送った出来事の原因が、直されないまま残っていました。
          </p>
        )}
        {changer && issue.changed_by && (
          <p className="text-sm font-medium text-error">
            {changer.day}日目の修正で、影響が
            {issue.changed_by.effect === "reduced" ? "小さく" : "大きく"}
            なっています：{issue.changed_by.reason}
          </p>
        )}
      </div>

      {preventer && (
        <div className="rounded-[10px] border-2 border-primary bg-tint px-5 py-4">
          <h2 className="mb-2 text-[19px] font-bold text-primary-accent">
            この出来事は起きませんでした
          </h2>
          <div className="grid gap-3">
            <p>
              {preventer.day}日目の修正「{chosenLabel(preventer)}
              」で原因が取り除かれていました。{issue.prevented_reason}
            </p>
            <Button variant="primary" className="self-start" onClick={resume}>
              運用に戻る <IconPlayerPlayFilled />
            </Button>
          </div>
        </div>
      )}

      {issue.skipped && (
        <div className="rounded-[10px] border-2 border-dashed border-muted-foreground bg-muted px-5 py-4">
          <h2 className="mb-2 text-[19px] font-bold">
            この出来事は、今回は対応しないことにしました
          </h2>
          <div className="grid gap-3">
            <p>見送った理由：{issue.skipped.reason}</p>
            <p>
              {issue.skipped.impact === "none" ? (
                `放っておいても運用への影響は小さいと見込まれています。${issue.skipped.impact_reason}`
              ) : escalation && firstOpenDay >= escalation.day ? (
                <>
                  見送った結果、{escalation.day}
                  日目に影響が大きくなって表に出ました。{" "}
                  <Link
                    to="/p/$pid/i/$iid"
                    params={{ pid, iid: escalation.id }}
                    className="underline"
                  >
                    {escalation.day}日目の出来事を見る
                  </Link>
                </>
              ) : (
                "見送った影響は、この先の運用で表に出るかもしれません。"
              )}
            </p>
            <ErrorBox message={busy ? "" : error} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={resume}>
                運用に戻る <IconPlayerPlayFilled />
              </Button>
              {busy === "skip" ? (
                <Waiting text="取り消しています" />
              ) : (
                <Button variant="secondary" onClick={unskip}>
                  やっぱり対応する
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        className={`grid items-start gap-6 ${showChat ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,1fr)]" : ""}`}
      >
        {/* 中の列も最小幅 0 にする。auto のままだと長いコード行の幅まで広がり、右の会話欄の下にはみ出す */}
        <section
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          aria-label="根拠"
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="code" className={TAB_CLASS}>
                コード
                <span className={TAB_COUNT}>{evidence.length}</span>
              </TabsTrigger>
              <TabsTrigger value="infra" className={TAB_CLASS}>
                構成図
              </TabsTrigger>
              <TabsTrigger value="log" className={TAB_CLASS}>
                その日のログ
                <span className={TAB_COUNT}>{issue.signals.length}</span>
              </TabsTrigger>
              {issue.fix && (
                <TabsTrigger value="fix" className={FIX_TAB_CLASS}>
                  <IconSparkles className="size-4" />
                  修正の結果
                  {tab !== "fix" && (
                    <span aria-hidden className="relative flex size-2">
                      <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="code" className="pt-3">
              {evidence.length > 0 ? (
                <CodeView pid={pid} findings={evidence} hideLabels={!handled} />
              ) : cause?.fix ? (
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">
                    この出来事のきっかけになった、{cause.day}日目の修正です。
                  </p>
                  <DiffView diffs={cause.fix.diffs} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  コードに直接の原因はありません。構成図とログを見てください。
                </p>
              )}
            </TabsContent>
            <TabsContent value="infra" className="grid gap-2 pt-3">
              <ArchDiagram
                arch={p.architecture}
                affected={issue.affected_nodes}
              />
              <p className="text-sm text-muted-foreground">
                赤い枠が、この出来事で影響が出ている部分です。影響あり：
                {issue.affected_nodes
                  .map(
                    (id) =>
                      p.architecture.nodes.find((n) => n.id === id)?.label ??
                      id,
                  )
                  .join("、") || "なし"}
              </p>
            </TabsContent>
            <TabsContent value="log" className="pt-3">
              <LogView lines={logLines} height={320} />
            </TabsContent>
            {issue.fix && (
              <TabsContent value="fix" className="pt-3">
                <FixView fix={issue.fix} />
              </TabsContent>
            )}
          </Tabs>

          {/* 原因の答えは、対応し終わるまで出さない */}
          {handled && (
            <details
              className="rounded-lg border bg-muted/40 px-4 py-3"
              open={!showChat}
            >
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                原因の答え合わせ
              </summary>
              <div className="grid gap-2 pt-3">
                <h3 className="font-semibold">原因：{issue.title}</h3>
                <p className="text-sm">{issue.what_happens}</p>
                <dl className="grid gap-2 text-sm">
                  <div className="grid grid-cols-[8rem_1fr] gap-3 border-t pt-2">
                    <dt className="text-muted-foreground">影響を受ける人</dt>
                    <dd>{issue.who_is_affected}</dd>
                  </div>
                  {issue.background_link && (
                    <div className="grid grid-cols-[8rem_1fr] gap-3 border-t pt-2">
                      <dt className="text-muted-foreground">関係する背景</dt>
                      <dd>{issue.background_link}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </details>
          )}
        </section>
        {showChat && (
          <section
            aria-label="先輩・関係者との会話"
            className="flex flex-col overflow-hidden rounded-xl border bg-background lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)] lg:min-h-[32rem]"
          >
            <ol
              className="relative flex gap-1.5 border-b p-3 text-xs"
              aria-label="進み具合"
            >
              {/* 今見ているステップの色（緑の丸）。ステップが変わると横になめらかに動く */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-3 bottom-3 left-3 rounded-full bg-primary transition-[transform,opacity] duration-500 ease-in-out"
                style={{
                  width: `calc((100% - 1.5rem - ${(STEPS.length - 1) * 0.375}rem) / ${STEPS.length})`,
                  transform: `translateX(calc(${shown} * (100% + 0.375rem)))`,
                  opacity: shown < STEPS.length ? 1 : 0,
                }}
              />
              {STEPS.map((s, n) => {
                const canJump = n <= step && (n === step || starts[n] != null);
                return (
                  <li key={s} className="relative z-10 flex-1">
                    <button
                      type="button"
                      disabled={!canJump}
                      onClick={() => jumpTo(n)}
                      aria-current={n === step ? "step" : undefined}
                      title={
                        canJump && n < step
                          ? `「${s}」の会話まで戻る`
                          : undefined
                      }
                      className={`w-full rounded-full py-1 text-center transition-colors duration-500 ease-in-out disabled:cursor-default ${
                        n === shown
                          ? "font-medium text-primary-foreground"
                          : n <= step
                            ? "bg-primary/10 text-primary hover:bg-primary/20 disabled:hover:bg-primary/10"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="relative flex min-h-64 flex-1 flex-col overflow-hidden">
              <div
                ref={listRef}
                onScroll={checkEnd}
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/30 p-4"
                aria-live="polite"
              >
                {issue.chat.map((m, n) => (
                  <Bubble
                    // biome-ignore lint/suspicious/noArrayIndexKey: 発言は後ろに足すだけで並び替えない
                    key={n}
                    m={m}
                    onShowFix={() => setTab("fix")}
                  />
                ))}
                {(busy === "chat" || busy === "hint" || busy === "start") && (
                  <Typing />
                )}
                {busy === "commit" && (
                  <div className="rounded-lg border bg-background p-3">
                    <Waiting text="決めた方針をコードと構成に反映して、この先の運用への影響を計算しています（20〜40秒）" />
                  </div>
                )}
                {issue.lesson && issue.phase === "done" && (
                  <div className="rounded-lg border border-dashed border-primary bg-background p-3">
                    <span className="text-xs font-bold text-muted-foreground">
                      判断の記録に残したメモ
                    </span>
                    <p className="text-sm">{issue.lesson}</p>
                  </div>
                )}
              </div>
              {awayFromEnd && (
                <Button
                  variant="primary"
                  size="sm"
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md"
                  onClick={jumpToEnd}
                >
                  <IconArrowDown />
                  最新へ
                </Button>
              )}
            </div>

            <div className="grid gap-2 border-t p-3">
              <ErrorBox message={busy ? "" : error} />

              {ready && busy !== "commit" && (
                <div className="grid gap-2 rounded-lg border-2 border-primary bg-primary/5 p-3">
                  <label
                    htmlFor="plan"
                    className="text-xs font-bold text-muted-foreground"
                  >
                    この方針で直しますか？（書き直してもOK）
                  </label>
                  <Textarea
                    id="plan"
                    rows={3}
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    className="bg-background"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!!busy || plan.trim().length < MIN_PLAN}
                      onClick={commit}
                    >
                      この方針で直す
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => inputRef.current?.focus()}
                    >
                      もう少し話す
                    </Button>
                  </div>
                </div>
              )}

              {handled && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="sm" onClick={resume}>
                    運用を再開する <IconPlayerPlayFilled />
                  </Button>
                  {!issue.lesson && (
                    <span className="text-xs text-muted-foreground">
                      振り返りを続けると、次へのメモが判断の記録に残ります
                    </span>
                  )}
                </div>
              )}

              {busy !== "commit" && (
                <>
                  <div className="flex items-end gap-2">
                    <Textarea
                      ref={inputRef}
                      rows={2}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={onKey}
                      aria-label="メッセージ"
                      className="flex-1 resize-none"
                      placeholder={
                        issue.phase === "reflect" || issue.phase === "done"
                          ? "振り返りを書く"
                          : "気づいたこと・考えたことを書く（Enterで送信、Shift+Enterで改行）"
                      }
                    />
                    <Button
                      variant="primary"
                      disabled={!!busy || !text.trim()}
                      onClick={() => send()}
                      aria-label="送信"
                    >
                      <IconSend />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {issue.phase !== "done" && (
                      <Button
                        variant="success"
                        size="sm"
                        className="border border-primary/40"
                        disabled={!!busy}
                        onClick={() => send(true)}
                      >
                        <IconBulb />
                        ヒントをもらう
                      </Button>
                    )}
                    {!handled && (
                      <SkipForm openLabel="今回は対応しない" onSkip={skip} />
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-start gap-2">
      <Avatar who="senior" name="先輩" />
      <div className="rounded-xl rounded-tl-sm border bg-background px-3 py-2">
        <span
          className="flex gap-1 py-1"
          role="img"
          aria-label="返事を考えています"
        >
          {[0, 1, 2].map((n) => (
            <i
              key={n}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
              style={{ animationDelay: `${n * 150}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function Avatar({ who, name }: { who: ChatMessage["role"]; name: string }) {
  return (
    <span
      aria-hidden
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${who === "senior" ? "bg-primary" : "bg-orange-600"}`}
    >
      {who === "senior" ? "先" : name.slice(0, 1)}
    </span>
  );
}

function Bubble({ m, onShowFix }: { m: ChatMessage; onShowFix: () => void }) {
  if (m.role === "event") {
    if (m.kind === "hint")
      return (
        <p className="self-center text-xs text-muted-foreground">
          ヒントを求めました
        </p>
      );
    if (m.kind === "decided")
      return (
        <div className="rounded-lg border border-l-4 border-l-foreground bg-background p-3">
          <span className="text-xs font-bold text-muted-foreground">
            決めた方針
          </span>
          <p className="text-sm">{m.text}</p>
        </div>
      );
    return (
      <div className="grid gap-1 rounded-lg border border-l-4 border-l-green-600 bg-green-600/5 p-3">
        <span className="text-xs font-bold text-muted-foreground">
          修正を反映しました
        </span>
        <p className="text-sm">{m.text}</p>
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start px-0 underline"
          onClick={onShowFix}
        >
          コードと構成の変化を見る
        </Button>
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div className="max-w-[90%] self-end whitespace-pre-wrap rounded-xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {m.text}
      </div>
    );
  }
  const name = m.name || (m.role === "senior" ? "先輩" : "関係者");
  return (
    <div className="flex max-w-[92%] items-start gap-2">
      <Avatar who={m.role} name={name} />
      <div className="min-w-0">
        <span className="ml-1 text-[11px] text-muted-foreground">{name}</span>
        <div
          className={`whitespace-pre-wrap rounded-xl rounded-tl-sm border px-3 py-2 text-sm leading-relaxed ${m.role === "stakeholder" ? "border-orange-200 bg-orange-50 dark:bg-orange-950/40" : "bg-background"}`}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
}
