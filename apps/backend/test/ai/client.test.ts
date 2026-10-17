import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import {
  AIError,
  buildArgs,
  cleanEnv,
  explainClaudeError,
  extractJson,
  generate,
  setAI,
} from "../../src/ai/client";

afterEach(() => setAI(null));

const schema = z.object({ a: z.string() });

test("buildArgs: 固定フラグと $schema 抜きの JSON Schema", () => {
  const args = buildArgs({
    bin: "claude",
    model: "sonnet",
    systemFile: "/tmp/sys.txt",
    schema,
  });
  const pair = (flag: string) => args[args.indexOf(flag) + 1];
  expect(args[0]).toBe("claude");
  expect(args).toContain("-p");
  expect(pair("--output-format")).toBe("stream-json");
  for (const f of [
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ]) {
    expect(args).toContain(f);
  }
  expect(pair("--setting-sources")).toBe("");
  expect(pair("--tools")).toBe("");
  expect(pair("--system-prompt-file")).toBe("/tmp/sys.txt");
  expect(pair("--model")).toBe("sonnet");
  expect(args).not.toContain("--bare");
  const js = JSON.parse(pair("--json-schema"));
  expect(js.$schema).toBeUndefined();
  expect(js.type).toBe("object");
  expect(js.required).toEqual(["a"]);
});

test("cleanEnv: API キー系だけ外す", () => {
  expect(
    cleanEnv({
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "t",
      PATH: "/bin",
      GONE: undefined,
    }),
  ).toEqual({ PATH: "/bin" });
});

test("explainClaudeError", () => {
  expect(explainClaudeError("Not logged in · Please run /login")).toContain(
    "ログイン",
  );
  expect(explainClaudeError("OAuth token has expired")).toContain("ログイン");
  expect(explainClaudeError("5-hour limit reached")).toContain("利用上限");
  expect(explainClaudeError("boom")).toBe("boom");
});

test("extractJson: 前後の文章や文字列中の括弧に惑わされない", () => {
  expect(extractJson('結果です\n{"a":"}{","b":{"c":1}} 以上')).toEqual({
    a: "}{",
    b: { c: 1 },
  });
  expect(extractJson("no json")).toBeUndefined();
  expect(extractJson('{"a":')).toBeUndefined();
});

test("setAI: generate は差し替えた関数へ委譲し、null で戻る", async () => {
  const seen: string[] = [];
  setAI((async (o) => {
    seen.push(o.task);
    return { a: "fake" };
  }) as typeof generate);
  const r = await generate({
    task: "t1",
    system: "s",
    prompt: "p",
    schema,
  });
  expect(r).toEqual({ a: "fake" });
  expect(seen).toEqual(["t1"]);
});

test("AIError は Error", () => {
  expect(new AIError("x")).toBeInstanceOf(Error);
});
