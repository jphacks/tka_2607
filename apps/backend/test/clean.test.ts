import { expect, test } from "bun:test";
import type { Architecture, Flow } from "@tka/shared";
import {
  clampDay,
  cleanArchitecture,
  cleanFlows,
  cleanIfIgnored,
  ifIgnoredFor,
  settled,
  uniqueDay,
} from "../src/clean";

const arch: Architecture = {
  nodes: [
    { id: "user", label: "利用者", kind: "person" },
    { id: "api", label: "API", kind: "internal" },
    { id: "db", label: "DB", kind: "db" },
  ],
  edges: [
    {
      from: "user",
      to: "api",
      label: "要求",
      direction: "one",
      kind: "runtime",
    },
    {
      from: "api",
      to: "db",
      label: "保存",
      direction: "both",
      kind: "runtime",
    },
  ],
};

test("cleanArchitecture: 重複・空 id・存在しない端点の edge を捨て、不正な kind を直す", () => {
  const dirty = {
    nodes: [
      { id: " a ", label: "A", kind: "bogus" },
      { id: "a", label: "dup", kind: "db" },
      { id: "", label: "empty", kind: "db" },
      { id: "b", label: "B", kind: "db" },
    ],
    edges: [
      { from: "a", to: "b", label: "x", direction: "weird", kind: "weird" },
      { from: "a", to: "ghost", label: "y", direction: "one", kind: "ops" },
    ],
  } as unknown as Architecture;
  expect(cleanArchitecture(dirty)).toEqual({
    nodes: [
      { id: "a", label: "A", kind: "internal" },
      { id: "b", label: "B", kind: "db" },
    ],
    edges: [
      { from: "a", to: "b", label: "x", direction: "one", kind: "runtime" },
    ],
  });
  expect(cleanArchitecture(undefined)).toEqual({ nodes: [], edges: [] });
});

const flow = (over: Partial<Flow>): Flow => ({
  actor: "user",
  title: "t",
  per_day: 10,
  feature_ids: [],
  steps: [{ from: "user", to: "api", label: "go" }],
  ...over,
});

test("cleanFlows: 構成図に無い actor・通信は捨てる", () => {
  const out = cleanFlows(
    [
      flow({}),
      flow({ actor: "ghost" }),
      flow({ steps: [{ from: "user", to: "db", label: "直接" }] }),
      flow({
        steps: [
          { from: "user", to: "api", label: "ok" },
          { from: "api", to: "user", label: "逆向き(oneなので不可)" },
        ],
      }),
      flow({
        title: "逆向きOK",
        steps: [{ from: "db", to: "api", label: "both なので可" }],
      }),
    ],
    arch,
  );
  expect(out.map((f) => f.title)).toEqual(["t", "t", "逆向きOK"]);
  expect(out[1]?.steps).toHaveLength(1);
});

test("cleanFlows: per_day は NaN なら 1、範囲外は丸める", () => {
  const per = (n: number) =>
    cleanFlows([flow({ per_day: n })], arch)[0]?.per_day;
  expect(per(Number.NaN)).toBe(1);
  expect(per(-5)).toBe(0);
  expect(per(1e9)).toBe(100000);
  expect(per(Number.POSITIVE_INFINITY)).toBe(100000);
  expect(per(2.5)).toBe(2.5);
});

test("cleanFlows: feature_ids は重複と未知の ID を除く", () => {
  const out = cleanFlows(
    [flow({ feature_ids: ["f1", "f1", "zzz", "f2"] })],
    arch,
    ["f1", "f2"],
  );
  expect(out[0]?.feature_ids).toEqual(["f1", "f2"]);
  expect(
    cleanFlows([flow({ feature_ids: ["f1"] })], arch)[0]?.feature_ids,
  ).toEqual([]);
});

test("cleanIfIgnored: after_days は escalate のとき 7〜90、none なら 0", () => {
  const base = {
    reason: "r",
    incident_title: "t",
    incident_story: "s",
    signals: [],
  };
  const after = (impact: "none" | "escalate", d: number) =>
    cleanIfIgnored({ ...base, impact, after_days: d })?.after_days;
  expect(after("escalate", 1)).toBe(7);
  expect(after("escalate", 1000)).toBe(90);
  expect(after("escalate", 30.9)).toBe(30);
  expect(after("escalate", Number.NaN)).toBe(7);
  expect(after("none", 30)).toBe(0);
});

test("cleanIfIgnored: escalate なのにタイトルが空なら使えない", () => {
  expect(
    cleanIfIgnored({ impact: "escalate", incident_title: "  " }),
  ).toBeNull();
  expect(cleanIfIgnored(null)).toBeNull();
  expect(cleanIfIgnored({ impact: "x" as "none" })).toBeNull();
});

test("cleanIfIgnored: signals は8件まで", () => {
  const signals = Array.from({ length: 12 }, () => ({
    time: "00:00:00",
    source: "s",
    level: "info" as const,
    text: "t",
  }));
  expect(cleanIfIgnored({ impact: "none", signals })?.signals).toHaveLength(8);
});

test("ifIgnoredFor: 台本があればそれを、無ければ重要度から決める", () => {
  const issue = { title: "SQL注入", who_is_affected: "会員（全員）、運営" };
  expect(ifIgnoredFor({ ...issue, severity: "低" }).impact).toBe("none");
  const high = ifIgnoredFor({ ...issue, severity: "高" });
  expect(high.impact).toBe("escalate");
  expect(high.after_days).toBe(21);
  expect(high.incident_title).toContain("会員への影響");
  expect(ifIgnoredFor({ ...issue, severity: "中" }).after_days).toBe(35);
  expect(ifIgnoredFor({ title: "x" }).incident_title).toContain("利用者");

  const scripted = ifIgnoredFor({
    ...issue,
    severity: "高",
    if_ignored: {
      impact: "escalate",
      reason: "r",
      after_days: 500,
      incident_title: "漏えい",
      incident_story: "s",
      signals: [],
    },
  });
  expect(scripted.incident_title).toBe("漏えい");
  expect(scripted.after_days).toBe(90);

  expect(
    ifIgnoredFor({ ...issue, severity: "高", escalated_from: "I1" }),
  ).toMatchObject({
    impact: "none",
  });
});

test("clampDay", () => {
  expect(clampDay(0, 180)).toBe(1);
  expect(clampDay(-3, 180)).toBe(1);
  expect(clampDay(999, 180)).toBe(180);
  expect(clampDay(12.7, 180)).toBe(12);
  expect(clampDay(Number.NaN, 180)).toBe(1);
});

test("uniqueDay: 同じ日は後ろへずらし、max を超えない", () => {
  expect(uniqueDay(10, [], 180)).toBe(10);
  expect(uniqueDay(10, [10, 11, 12], 180)).toBe(13);
  expect(uniqueDay(500, [], 180)).toBe(180);
  expect(uniqueDay(179, [179, 180], 180)).toBe(180);
  expect(uniqueDay(-5, [1], 180)).toBe(2);
});

test("settled", () => {
  expect(settled({})).toBe(false);
  expect(settled({ feedback: null })).toBe(false);
  expect(
    settled({
      feedback: { consequence: "", covered: [], questions: [], stance_gap: "" },
    }),
  ).toBe(true);
  expect(settled({ prevented_by: "I1" })).toBe(true);
  expect(
    settled({
      skipped: { reason: "r", at: "t", impact: "none", impact_reason: "" },
    }),
  ).toBe(true);
});
