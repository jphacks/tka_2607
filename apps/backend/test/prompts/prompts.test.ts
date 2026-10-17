import { describe, expect, test } from "bun:test";
import type { Architecture, Background } from "@tka/shared";
import {
  analyzeSystem,
  archPrompt,
  flowsAllPrompt,
  flowsMissingPrompt,
  issuesPrompt,
} from "../../src/prompts/analyze";
import { applyPrompt, applySystem } from "../../src/prompts/apply";
import { attackPrompt, attackSystem } from "../../src/prompts/attack";
import { type ChatTurn, chatPrompt, chatSystem } from "../../src/prompts/chat";
import type { IssueView } from "../../src/prompts/common";
import type { Feature, Finding } from "../../src/scanner";

const bg: Background = {
  title: "BG_TITLE_XYZ",
  stakeholders: "B社",
  data_flow: "",
  data_types: "",
  constraints: "",
  team: "",
  notes: "",
};
const arch: Architecture = {
  nodes: [
    { id: "api", label: "API", kind: "internal" },
    { id: "db", label: "DB", kind: "db" },
  ],
  edges: [
    {
      from: "api",
      to: "db",
      label: "検索",
      direction: "both",
      kind: "runtime",
    },
  ],
};
const finding: Finding = {
  id: "F1",
  rule: "sql-string-build",
  title: "SQLを連結",
  file: "app.py",
  line: 58,
  snippet: "  58  SNIPPET_ABC",
};
const feature: Feature = {
  id: "f1",
  name: "ルート: /a (GET)",
  source: "app.py:1",
};
const issue: IssueView = {
  day: 12,
  incident_title: "検索がおかしい",
  incident_story: "STORY",
  signals: [
    { time: "06:00:00", source: "api.log", level: "error", text: "err" },
  ],
  title: "TITLE",
  what_happens: "WHAT",
  who_is_affected: "B社",
};
const SOURCES = "SOURCE_CODE_MARKER";

describe("analyze", () => {
  const sys = analyzeSystem({ bg, sources: SOURCES, config: "CONFIG_MARKER" });

  test("同じ入力なら同一文字列、違えば違う", () => {
    expect(
      analyzeSystem({ bg, sources: SOURCES, config: "CONFIG_MARKER" }),
    ).toBe(sys);
    expect(
      analyzeSystem({ bg, sources: "other", config: "CONFIG_MARKER" }),
    ).not.toBe(sys);
    expect(
      analyzeSystem({
        bg: { ...bg, title: "x" },
        sources: SOURCES,
        config: "",
      }),
    ).not.toBe(sys);
  });

  test("背景・構成・ソースは system だけにあり、user 側には入らない", () => {
    for (const s of ["BG_TITLE_XYZ", "CONFIG_MARKER", SOURCES])
      expect(sys).toContain(s);
    const users = [
      archPrompt(),
      flowsAllPrompt({ arch, features: [feature] }),
      issuesPrompt({ findings: [finding], arch }),
      flowsMissingPrompt({ arch, missing: [feature] }),
    ];
    for (const u of users) {
      for (const s of ["BG_TITLE_XYZ", "CONFIG_MARKER", SOURCES])
        expect(u).not.toContain(s);
    }
    expect(users[2]).toContain("F1");
  });
});

describe("chat", () => {
  const sys = chatSystem({ bg, issue, evidence: [finding], arch });

  test("system に会話履歴は入らず、user に背景・根拠コードは入らない", () => {
    const history: ChatTurn[] = [{ role: "user", text: "HISTORY_MARKER" }];
    const user = chatPrompt({ history, phase: "investigate" });
    expect(sys).not.toContain("HISTORY_MARKER");
    expect(user).toContain("HISTORY_MARKER");
    expect(sys).toContain("BG_TITLE_XYZ");
    expect(sys).toContain("SNIPPET_ABC");
    expect(user).not.toContain("BG_TITLE_XYZ");
    expect(user).not.toContain("SNIPPET_ABC");
  });

  test("system は同じ入力で同一文字列", () => {
    expect(chatSystem({ bg, issue, evidence: [finding], arch })).toBe(sys);
  });

  test("内部 ID を見せない: 根拠に id を含めず、使わない指示がある", () => {
    expect(sys).not.toContain('"id"');
    expect(sys).toContain("F1 のような内部の id");
  });

  test("history は直近 16 件に切られる", () => {
    const history: ChatTurn[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user",
      text: `msg-${i}-end`,
    }));
    const user = chatPrompt({ history, phase: "decide" });
    expect(user).not.toContain("msg-3-end");
    expect(user).toContain("msg-4-end");
    expect(user).toContain("msg-19-end");
  });

  test("hint=true でヒント指示が入る", () => {
    const base = { history: [], phase: "investigate" as const };
    expect(chatPrompt({ ...base, hint: true })).toContain("<hint>");
    expect(chatPrompt(base)).not.toContain("<hint>");
  });

  test("phase ごとに指示が変わる", () => {
    const phases = [
      "investigate",
      "decide",
      "ready",
      "reflect",
      "done",
    ] as const;
    const texts = phases.map((phase) => chatPrompt({ history: [], phase }));
    expect(new Set(texts).size).toBe(phases.length);
  });

  test("attack と fix は与えたときだけ system に入る", () => {
    const full = chatSystem({
      bg,
      issue,
      evidence: [],
      arch,
      attack: [
        {
          title: "ATK",
          path: "P",
          target: "T",
          preconditions: "",
          detectable_signs: "S",
        },
      ],
      fix: { summary: "FIX_SUMMARY", chosen_summary: "CHOSEN" },
    });
    expect(full).toContain("ATK");
    expect(full).toContain("FIX_SUMMARY");
    expect(full).toContain("<attack_paths>");
    expect(sys).not.toContain("<attack_paths>");
    expect(sys).not.toContain("<fix>");
  });
});

describe("apply / attack", () => {
  test("apply: ソースと構成は system、選んだ方針は user", () => {
    const sys = applySystem({ bg, sources: SOURCES, arch });
    const user = applyPrompt({
      issue,
      chosen: { label: "CHOSEN_LABEL", change_summary: "x" },
      reason: "r",
      future: [{ id: "i2", day: 30, title: "T2", what_happens: "W2" }],
    });
    expect(sys).toContain(SOURCES);
    expect(user).not.toContain(SOURCES);
    expect(user).toContain("CHOSEN_LABEL");
    expect(user).toContain('"issue_id": "i2"');
    expect(user).toContain("15〜180");
  });

  test("attack: 根拠とソースは system、user は固定", () => {
    const sys = attackSystem({
      bg,
      issue,
      evidence: [finding],
      sources: SOURCES,
    });
    expect(sys).toContain("SNIPPET_ABC");
    expect(sys).toContain(SOURCES);
    expect(sys).not.toContain('"id"');
    expect(attackPrompt()).not.toContain(SOURCES);
  });
});
