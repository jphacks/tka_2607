import { expect, test } from "bun:test";
import { db } from "../src/db";
import { messages } from "../src/db/schema";
import * as repo from "../src/repo";
import type { ChatMessage, Issue, Lesson, Project } from "../src/types";

const issue = (id: string, day: number, over: Partial<Issue> = {}): Issue => ({
  id,
  day,
  chat: [],
  title: `問題${id}`,
  category: "脆弱性",
  severity: "高",
  what_happens: "w",
  who_is_affected: "u",
  background_link: "b",
  finding_ids: ["F1"],
  incident_title: "i",
  incident_story: "s",
  signals: [{ time: "09:00:00", source: "監視", level: "warn", text: "t" }],
  view: "code",
  affected_nodes: [],
  ...over,
});

const project = (): Project => ({
  id: repo.newId(),
  created_at: repo.now(),
  background: {
    title: "アプリ",
    stakeholders: "",
    data_flow: "",
    data_types: "",
    constraints: "",
    team: "",
    notes: "",
  },
  source: "target",
  findings: [],
  features: [],
  issues: [issue("I2", 30), issue("I1", 10)],
  architecture: { nodes: [], edges: [] },
  flows: [],
  dismissed: [],
  uncovered_features: [],
  assumed_users: null,
  sim_day: 0,
  analyzed_by: null,
});

const count = (pid: string) =>
  db
    .select()
    .from(messages)
    .all()
    .filter((m) => m.projectId === pid).length;

test("newId / now の形", () => {
  expect(repo.newId()).toMatch(/^[0-9a-f]{10}$/);
  expect(repo.now()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test("存在しない project は undefined", () => {
  expect(repo.getProject("nope")).toBeUndefined();
});

test("保存して取得すると同じ形で返り、issue は day 順", () => {
  const p = project();
  p.issues[1] = issue("I1", 10, {
    phase: "decide",
    stance: "直す",
    decision: { option_index: null, plan: "p", reason: "r", at: "t" },
  });
  p.assumed_users = 500;
  p.analyzed_by = "claude";
  repo.saveProject(p);
  const got = repo.getProject(p.id);
  expect(got?.issues.map((i) => i.id)).toEqual(["I1", "I2"]);
  expect(got?.issues[0]).toEqual({
    ...(p.issues[1] as Issue),
  });
  expect(got?.issues[1]?.phase).toBeUndefined();
  expect(got?.assumed_users).toBe(500);
  expect(got?.analyzed_by).toBe("claude");
  expect(got?.background.title).toBe("アプリ");
});

test("chat は id の無い発言だけが INSERT され、id が振り戻される", () => {
  const p = project();
  const i1 = p.issues.find((i) => i.id === "I1") as Issue;
  i1.chat.push({ role: "senior", name: "先輩", text: "どう思う？" });
  repo.saveProject(p);
  expect(count(p.id)).toBe(1);
  const first = i1.chat[0];
  expect(first?.id).toBeNumber();
  expect(first?.at).toBeString();

  // 再保存しても増えない
  repo.saveProject(p);
  expect(count(p.id)).toBe(1);

  // 追記した分だけ増える。取得すると id 順
  i1.chat.push({ role: "user", text: "直します", at: "2026-01-01T00:00:00Z" });
  i1.chat.push({ role: "event", kind: "hint", text: "ヒント" });
  repo.saveProject(p);
  expect(count(p.id)).toBe(3);
  const got = repo.getProject(p.id);
  const chat = got?.issues.find((i) => i.id === "I1")?.chat ?? [];
  expect(chat.map((m) => m.text)).toEqual(["どう思う？", "直します", "ヒント"]);
  expect(chat[0]).toMatchObject({ role: "senior", name: "先輩" });
  expect(chat[0]).not.toHaveProperty("kind");
  expect(chat[2]?.kind).toBe("hint");
  expect(chat[1]?.at).toBe("2026-01-01T00:00:00Z");
  expect(got?.issues.find((i) => i.id === "I2")?.chat).toEqual([]);
});

test("既存の発言を書き換えても DB は変わらない", () => {
  const p = project();
  const msg: ChatMessage = { role: "user", text: "元" };
  (p.issues[0] as Issue).chat.push(msg);
  repo.saveProject(p);
  msg.text = "改ざん";
  repo.saveProject(p);
  const got = repo
    .getProject(p.id)
    ?.issues.find((i) => i.id === p.issues[0]?.id);
  expect(got?.chat[0]?.text).toBe("元");
});

test("issue を消すと反映され、その発言も消える。更新は反映される", () => {
  const p = project();
  (p.issues[0] as Issue).chat.push({ role: "user", text: "x" });
  repo.saveProject(p);
  expect(count(p.id)).toBe(1);

  p.issues = p.issues.filter((i) => i.id !== p.issues[0]?.id);
  (p.issues[0] as Issue).title = "更新後";
  p.sim_day = 42;
  repo.saveProject(p);
  const got = repo.getProject(p.id);
  expect(got?.issues).toHaveLength(1);
  expect(got?.issues[0]?.title).toBe("更新後");
  expect(got?.sim_day).toBe(42);
  expect(count(p.id)).toBe(0);

  p.issues = [];
  repo.saveProject(p);
  expect(repo.getProject(p.id)?.issues).toEqual([]);
});

test("他の project には影響しない", () => {
  const a = project();
  const b = project();
  (a.issues[0] as Issue).chat.push({ role: "user", text: "a" });
  repo.saveProject(a);
  repo.saveProject(b);
  b.issues = [];
  repo.saveProject(b);
  expect(repo.getProject(a.id)?.issues).toHaveLength(2);
  expect(count(a.id)).toBe(1);
});

test("listProjects は新しい順で、件数と対応済み数を返す", () => {
  const p = project();
  p.created_at = "2999-01-01T00:00:00Z";
  (p.issues[0] as Issue).feedback = {
    consequence: "c",
    covered: [],
    questions: [],
    stance_gap: "",
  };
  repo.saveProject(p);
  const list = repo.listProjects();
  expect(list[0]).toEqual({
    id: p.id,
    title: "アプリ",
    created_at: "2999-01-01T00:00:00Z",
    issues: 2,
    decided: 1,
  });
});

const lesson = (id: string, createdAt: string, text = "l"): Lesson => ({
  id,
  project_id: "p",
  project_title: "t",
  issue_title: "i",
  rule: null,
  category: "脆弱性",
  stance: "",
  chosen: "c",
  reason: "r",
  lesson: text,
  created_at: createdAt,
});

test("lessons: 新しい順、同じ id は置き換え、削除できる", () => {
  repo.addLesson(lesson("L-old", "2001-01-01T00:00:00Z"));
  repo.addLesson(lesson("L-new", "2002-01-01T00:00:00Z"));
  repo.addLesson(lesson("L-old", "2003-01-01T00:00:00Z", "置換"));
  const got = repo.listLessons().filter((l) => l.id.startsWith("L-"));
  expect(got.map((l) => l.id)).toEqual(["L-old", "L-new"]);
  expect(got[0]?.lesson).toBe("置換");
  expect(got[0]?.rule).toBeNull();
  repo.removeLesson("L-old");
  repo.removeLesson("L-none");
  expect(repo.listLessons().some((l) => l.id === "L-old")).toBe(false);
});
