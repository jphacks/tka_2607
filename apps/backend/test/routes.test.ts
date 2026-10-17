import { afterEach, beforeEach, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  AIError,
  type GenerateOpts,
  type generate,
  setAI,
} from "../src/ai/client";
import app from "../src/app";
import { config } from "../src/config";
import type { Issue, Lesson, Project } from "../src/types";

type Payload = Project & { sim_days: number; related_lessons: Lesson[] };

// --- 偽 AI: task で分岐し、返した値は schema で検証する (ずれたらテストが落ちる) ---
let calls: { task: string; system: string }[] = [];
let findingIds: string[] = [];
const appPy = readFileSync(join(config.targetDir, "app.py"), "utf8");
const debugLine =
  appPy.split("\n").findIndex((l) => l.includes("debug=True")) + 1;

const signal = (source: string) => ({
  time: "06:12:03",
  source,
  level: "error" as const,
  text: "「検索結果がおかしい」",
});
const incident = (day: number, title: string) => ({
  day,
  incident_title: `${title}の連絡が来た`,
  incident_story: "朝6時に気づいた。",
  signals: [signal("B社から")],
  view: "code" as const,
  affected_nodes: ["api", "no_such_node"],
  title,
  category: "脆弱性" as const,
  severity: "高" as const,
  what_happens: "放っておくと広がる",
  who_is_affected: "B社",
  background_link: "",
});
const senior = (text: string) => ({
  role: "senior" as const,
  name: "先輩",
  text,
});

function chatReply(prompt: string) {
  const said = [...prompt.matchAll(/若手（本人）: (.*)/g)].at(-1)?.[1] ?? "";
  if (prompt.includes("<hint>"))
    return { messages: [senior("ログの2行目を見て")], phase: "investigate" };
  if (said.includes("外から"))
    return { messages: [senior("どこに根拠がある？")], phase: "investigate" };
  if (said.includes("B社が"))
    return {
      messages: [
        {
          role: "stakeholder" as const,
          name: "B社 サポート担当",
          text: "止めないで",
        },
        senior("1"),
        senior("2"),
        senior("3"), // 4件目は切り捨てられる
      ],
      phase: "decide",
    };
  if (said.includes("直す"))
    return {
      messages: [senior("その方針で直してみようか")],
      phase: "ready",
      plan: said,
      reason: "B社への影響を抑えるため",
    };
  if (said.includes("やっぱり"))
    return { messages: [senior("もう一度考えよう")], phase: "decide" };
  if (said.includes("次は"))
    return { messages: [senior("いいね")], phase: "done", lesson: said };
  return { messages: [senior("入れたあとは？")], phase: "reflect" };
}

function reply(o: GenerateOpts<z.ZodType>): unknown {
  switch (o.task) {
    case "arch":
      return {
        architecture: {
          nodes: [
            { id: "api", label: "API", kind: "internal" },
            { id: "db", label: "DB", kind: "db" },
            { id: "partner", label: "B社", kind: "partner" },
          ],
          edges: [
            {
              from: "partner",
              to: "api",
              label: "毎朝取得",
              direction: "both",
              kind: "runtime",
            },
            {
              from: "api",
              to: "db",
              label: "検索",
              direction: "both",
              kind: "runtime",
            },
          ],
        },
      };
    case "flows_all":
      return {
        flows: [
          {
            actor: "partner",
            title: "B社が前日分を取得する",
            per_day: 1,
            feature_ids: ["f1"],
            steps: [{ from: "partner", to: "api", label: "取得" }],
          },
        ],
        assumed_users: 30,
      };
    case "flows":
      return {
        flows: [
          {
            actor: "partner",
            title: "B社が残りの機能を使う",
            per_day: 2,
            feature_ids: ["f2", "f3", "f4"],
            steps: [{ from: "partner", to: "api", label: "呼ぶ" }],
          },
        ],
      };
    case "issues": {
      const ifIgnored = {
        impact: "escalate" as const,
        reason: "広がる",
        after_days: 14,
        incident_title: "見送った件が悪化した",
        incident_story: "被害が増えた",
        signals: [signal("監視")],
      };
      return {
        issues: [
          {
            ...incident(40, "二つ目"),
            finding_ids: [findingIds[1]],
            if_ignored: { ...ifIgnored, impact: "none", after_days: 0 },
          },
          {
            ...incident(10, "一つ目"),
            finding_ids: [findingIds[0]],
            if_ignored: ifIgnored,
          },
          {
            ...incident(5, "根拠なし"),
            finding_ids: ["F999"],
            if_ignored: ifIgnored,
          },
        ],
        dismissed: [],
      };
    }
    case "chat":
      return chatReply(o.prompt);
    case "apply":
      return {
        summary: "debug を切った",
        code_changes: [
          {
            file: "app.py",
            start_line: debugLine,
            end_line: debugLine,
            new_lines: ['    app.run(host="127.0.0.1", port=5001)'],
            note: "debug を外した",
          },
          {
            file: "../src/app.py",
            start_line: 1,
            end_line: 1,
            new_lines: ["HACK"],
            note: "",
          },
          {
            file: "../outside.txt",
            start_line: 1,
            end_line: 1,
            new_lines: ["HACK"],
            note: "",
          },
        ],
        architecture_after: {
          nodes: [
            { id: "api", label: "API", kind: "internal" },
            { id: "waf", label: "IP制限", kind: "internal" },
          ],
          edges: [
            {
              from: "waf",
              to: "api",
              label: "許可",
              direction: "one",
              kind: "runtime",
            },
          ],
        },
        arch_notes: ["IP制限を足した"],
        future: [{ issue_id: "I2", effect: "reduced", reason: "狭まる" }],
        new_incidents: [incident(20, "副作用A"), incident(30, "副作用B")],
        reflection: "入れたあと、何を確認する？",
      };
    case "attack_scenarios":
      return {
        scenarios: Array.from({ length: 5 }, (_, i) => ({
          title: `攻撃${i}`,
          path: "p",
          target: "t",
          preconditions: "特になし",
          detectable_signs: "ログ",
        })),
      };
    default:
      throw new Error(`unexpected task ${o.task}`);
  }
}

const fakeAI = async (o: GenerateOpts<z.ZodType>) => {
  calls.push({ task: o.task, system: o.system });
  return o.schema.parse(reply(o));
};

beforeEach(() => {
  calls = [];
  setAI(fakeAI as unknown as typeof generate);
});
afterEach(() => setAI(null));

async function api<T = Payload>(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function setup() {
  const target = await api<{ background: Record<string, string> }>(
    "GET",
    "/api/target",
  );
  const reg = await api("POST", "/api/projects", {
    background: target.data.background,
  });
  expect(reg.status).toBe(200);
  findingIds = reg.data.findings.map((f) => f.id);
  expect(findingIds.length).toBeGreaterThanOrEqual(2);
  const done = await api("POST", `/api/projects/${reg.data.id}/analyze`);
  expect(done.status).toBe(200);
  return {
    pid: reg.data.id,
    project: done.data,
    p: `/api/projects/${reg.data.id}`,
  };
}

const chat = (p: string, iid: string, body: unknown) =>
  api<Issue>("POST", `${p}/issues/${iid}/chat`, body);

test("config / target", async () => {
  const cfg = await api<{
    status: { ok: boolean };
    target: { exists: boolean };
  }>("GET", "/api/config");
  expect(cfg.data.status.ok).toBe(false); // CLAUDE_BIN は存在しない
  expect(cfg.data.target.exists).toBe(true);
  const t = await api<{ exists: boolean; background: { title: string } }>(
    "GET",
    "/api/target",
  );
  expect(t.data.exists).toBe(true);
  expect(t.data.background.title).toContain("A社");
});

test("登録の入力検査", async () => {
  expect(
    (await api("POST", "/api/projects", { background: { title: "  " } }))
      .status,
  ).toBe(400);
  expect((await api("POST", "/api/projects", {})).status).toBe(400);
  expect((await api("GET", "/api/projects/nope")).status).toBe(404);
});

test("analyze: 4回の呼び出しで system が同じで、arch が先頭", async () => {
  const before = readdirSync(config.targetDir).sort();
  const { project } = await setup();
  expect(calls.map((c) => c.task).sort()).toEqual([
    "arch",
    "flows",
    "flows_all",
    "issues",
  ]);
  expect(calls[0]?.task).toBe("arch");
  expect(new Set(calls.map((c) => c.system)).size).toBe(1);

  expect(project.architecture.nodes.length).toBe(3);
  expect(project.assumed_users).toBe(30);
  expect(project.flows.length).toBe(2);
  expect(project.analyzed_by).toBe("claude_code");
  // 根拠のない指摘は捨て、day の順に並べて I1.. を振る
  expect(project.issues.map((i) => [i.id, i.day, i.title])).toEqual([
    ["I1", 10, "一つ目"],
    ["I2", 40, "二つ目"],
  ]);
  expect(project.issues[0]?.affected_nodes).toEqual(["api"]);
  expect(project.sim_days).toBe(180);
  expect(readdirSync(config.targetDir).sort()).toEqual(before);
});

test("会話 → 方針の確定 → 反映 → 振り返り → メモ", async () => {
  const { pid, p } = await setup();
  const iid = "I1";
  const srcBefore = readFileSync(
    join(config.dataDir, "projects", pid, "src", "app.py"),
    "utf8",
  );
  const outside = join(config.dataDir, "projects", pid, "outside.txt");
  writeFileSync(outside, "orig");

  const start = await api<Issue>("POST", `${p}/issues/${iid}/chat/start`);
  expect(start.data.phase).toBe("investigate");
  expect(start.data.chat.map((m) => m.role)).toEqual(["stakeholder", "senior"]);
  expect(start.data.chat[0]?.name).toBe("B社の担当");

  let i = (await chat(p, iid, { hint: true })).data;
  expect(i.hints).toBe(1);
  expect(i.chat.at(-1)?.role).toBe("senior");

  i = (await chat(p, iid, { text: "デバッグ画面が外から見えている" })).data;
  const n = i.chat.length;
  i = (await chat(p, iid, { text: "B社が困る" })).data;
  expect(i.phase).toBe("decide");
  expect(i.chat.length).toBe(n + 1 + 3); // 発言 + AI の発言は3件まで
  expect(i.chat.some((m) => m.role === "stakeholder")).toBe(true);

  i = (
    await chat(p, iid, { text: "本番ではdebugを切って直す、B社には連絡する" })
  ).data;
  expect(i.phase).toBe("ready");
  expect(i.plan_draft?.plan).toContain("debugを切って直す");

  const r = await api<{ issue: Issue; project: Payload }>(
    "POST",
    `${p}/issues/${iid}/commit`,
    { plan: i.plan_draft?.plan },
  );
  expect(r.status).toBe(200);
  i = r.data.issue;
  expect(i.phase).toBe("reflect");
  expect(i.fix?.diffs.map((d) => d.file)).toEqual(["app.py"]);
  expect(i.feedback).toBeTruthy();
  expect(i.plan_draft).toBeUndefined();
  expect(i.chat.some((m) => m.kind === "fix")).toBe(true);
  expect(i.fix?.new_issue_ids).toEqual(["I3"]); // 新しい出来事は1件まで
  expect(r.data.project.architecture.nodes.map((x) => x.id)).toEqual([
    "api",
    "waf",
  ]);
  const issue2 = r.data.project.issues.find((x) => x.id === "I2");
  expect(issue2?.changed_by?.effect).toBe("reduced");

  // 修正は current/ にだけ入る
  const cur = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );
  expect(cur.data.content).toContain('host="127.0.0.1"');
  const orig = await api<{ content: string }>("GET", `${p}/file?path=app.py`);
  expect(orig.data.content).toBe(appPy);
  expect(
    readFileSync(
      join(config.dataDir, "projects", pid, "src", "app.py"),
      "utf8",
    ),
  ).toBe(srcBefore);
  expect(readFileSync(outside, "utf8")).toBe("orig");
  expect(readFileSync(join(config.targetDir, "app.py"), "utf8")).toBe(appPy);

  // 反映後も、未対応の出来事(副作用の I3)より先へは進めない
  const sim = await api<{ sim_day: number; limit: number }>(
    "POST",
    `${p}/sim`,
    { day: 999 },
  );
  expect(sim.data.sim_day).toBe(20);
  expect(sim.data.limit).toBe(20);

  i = (await chat(p, iid, { text: "B社には漏れた範囲を伝える" })).data;
  expect(i.phase).toBe("reflect");
  i = (await chat(p, iid, { text: "次は本番の設定を最初から分けておく" })).data;
  expect(i.phase).toBe("done");
  expect(i.lesson).toBe("次は本番の設定を最初から分けておく");
  const lessons = await api<Lesson[]>("GET", "/api/lessons");
  const mine = lessons.data.find((l) => l.project_id === pid);
  expect(mine?.lesson).toBe(i.lesson);
  expect(mine?.chosen).toContain("本番ではdebugを切って直す");

  const ls = await api<Issue>("POST", `${p}/issues/${iid}/lesson`, {
    lesson: " 書き直した ",
  });
  expect(ls.data.lesson).toBe("書き直した");
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.find(
      (l) => l.project_id === pid,
    )?.lesson,
  ).toBe("書き直した");

  const atk = await api<Issue>("POST", `${p}/issues/${iid}/attack-scenarios`);
  expect(atk.data.attack_scenarios?.length).toBe(4);
});

test("反映をやり直す途中で AI が失敗しても、前の修正は current/ に残る", async () => {
  const { p } = await setup();
  const iid = "I1";
  for (const text of [
    "デバッグ画面が外から見えている",
    "B社が困る",
    "本番ではdebugを切って直す、B社には連絡する",
  ]) {
    await chat(p, iid, { text });
  }
  const ready = await api("GET", p).then((r) =>
    r.data.issues.find((x) => x.id === iid),
  );
  const plan = ready?.plan_draft?.plan;
  expect(
    (await api("POST", `${p}/issues/${iid}/commit`, { plan })).status,
  ).toBe(200);
  const fixed = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );

  setAI(async () => {
    throw new AIError("失敗");
  });
  expect(
    (await api("POST", `${p}/issues/${iid}/commit`, { plan })).status,
  ).toBe(502);
  const after = await api<{ content: string }>(
    "GET",
    `${p}/file?path=app.py&version=current`,
  );
  expect(after.data.content).toBe(fixed.data.content);
});

test("ready のあとに話し続けると decide に戻り、plan_draft が消える", async () => {
  const { p } = await setup();
  let ready: Issue | undefined;
  for (const text of ["外から見えている", "B社が困る", "debugを切って直す"]) {
    ready = (await chat(p, "I1", { text })).data;
  }
  expect(ready?.phase).toBe("ready");
  expect(ready?.plan_draft).toBeTruthy();
  const back = (await chat(p, "I1", { text: "やっぱり" })).data;
  expect(back.phase).toBe("decide");
  expect(back.plan_draft).toBeUndefined();
  expect((await chat(p, "I1", {})).status).toBe(400);
});

test("見送ると escalate の出来事が増え、取り消すと消える", async () => {
  const { pid, p } = await setup();
  expect(
    (await api("POST", `${p}/issues/I1/skip`, { reason: "x" })).status,
  ).toBe(400);
  const r = await api("POST", `${p}/issues/I1/skip`, {
    reason: "今回は影響が小さい",
  });
  expect(r.status).toBe(200);
  const esc = r.data.issues.find((i) => i.escalated_from === "I1");
  expect(esc?.day).toBe(24);
  expect(r.data.issues.find((i) => i.id === "I1")?.skipped?.escalation_id).toBe(
    esc?.id,
  );
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.some(
      (l) => l.id === `${pid}-I1`,
    ),
  ).toBe(true);

  // 見送った結果の出来事(24日目)より先へは進めない
  const sim = await api<{ sim_day: number }>("POST", `${p}/sim`, { day: 999 });
  expect(sim.data.sim_day).toBe(24);

  const back = await api("POST", `${p}/issues/I1/unskip`);
  expect(back.data.issues.map((i) => i.id)).toEqual(["I1", "I2"]);
  expect(back.data.issues[0]?.skipped).toBeUndefined();
  expect(back.data.sim_day).toBe(10);
  expect(
    (await api<Lesson[]>("GET", "/api/lessons")).data.some(
      (l) => l.id === `${pid}-I1`,
    ),
  ).toBe(false);
});

test("file: パストラバーサルを拒否する", async () => {
  const { p } = await setup();
  for (const [version, sibling] of [
    ["original", "current"],
    ["current", "src"],
  ]) {
    for (const path of [
      `../${sibling}/app.py`, // もう一方のコピー
      "../../projects",
      "../../app.db",
      "/etc/passwd",
      "nothing.txt",
      "",
    ]) {
      const res = await api<{ detail: string }>(
        "GET",
        `${p}/file?path=${encodeURIComponent(path)}&version=${version}`,
      );
      expect(res.status).toBe(404);
    }
  }
});

test("再分析が AI の失敗で止まっても、前の会話は消えない", async () => {
  const { p } = await setup();
  await chat(p, "I1", { text: "デバッグ画面が外から見えている" });
  setAI(async () => {
    throw new AIError("失敗");
  });
  expect((await api("POST", `${p}/analyze`)).status).toBe(502);
  const after = await api<Payload>("GET", p);
  expect(after.data.issues.length).toBe(2);
  expect(after.data.issues[0]?.chat.length).toBeGreaterThan(1);
});

test("AIError は 502 と detail を返す", async () => {
  const { p } = await setup();
  setAI(async () => {
    throw new AIError("Claude Code が見つかりません");
  });
  const res = await api<{ detail: string }>("POST", `${p}/issues/I1/chat`, {
    hint: true,
  });
  expect(res.status).toBe(502);
  expect(res.data.detail).toBe("Claude Code が見つかりません");
  // 失敗した発言は保存されない
  const again = await api<Payload>("GET", p);
  expect(again.data.issues[0]?.chat).toEqual([]);
});
