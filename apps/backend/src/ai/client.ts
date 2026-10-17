import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { config } from "../config";

export class AIError extends Error {}

export type GenerateOpts<T extends z.ZodType> = {
  task: string; // ログ用の識別子
  system: string; // 不変の文脈はここに入れる (キャッシュのため)
  prompt: string; // 毎回変わる部分
  schema: T;
  model?: string;
  onProgress?: (chars: number) => void; // 書いた文字数
  signal?: AbortSignal;
};

// $schema を付けたままだと --json-schema が "no schema with key or ref" で拒否する (実機確認済み)
function toJsonSchema(schema: z.ZodType): string {
  const { $schema: _omit, ...rest } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  return JSON.stringify(rest);
}

// これらのフラグが無いと ~/.claude の hook やプラグインが読み込まれ、遅くなり返答にも混入する。
// --bare は Pro の OAuth を読まないので使えない。
export function buildArgs(o: {
  bin: string;
  model: string;
  systemFile: string;
  schema: z.ZodType;
}): string[] {
  return [
    o.bin,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--tools",
    "",
    "--system-prompt-file",
    o.systemFile,
    "--json-schema",
    toJsonSchema(o.schema),
    "--model",
    o.model,
  ];
}

// API キーが残っていると Claude Code が従量課金側を優先してしまう
export function cleanEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] =>
        e[1] !== undefined &&
        e[0] !== "ANTHROPIC_API_KEY" &&
        e[0] !== "ANTHROPIC_AUTH_TOKEN",
    ),
  );
}

export function explainClaudeError(msg: string): string {
  const low = msg.toLowerCase();
  if (
    low.includes("not logged in") ||
    msg.includes("/login") ||
    low.includes("oauth") ||
    low.includes("authenticate")
  ) {
    return "Claude Code にログインしていないか、ログインの期限が切れています。ターミナルで claude を起動し、/logout → /login で「Claude account with subscription」(Pro のアカウント)を選んでログインしてから、もう一度試してください。";
  }
  if (low.includes("limit")) {
    return `Pro プランの利用上限に達しています。リセットまで待ってください。(${msg.slice(0, 200)})`;
  }
  return msg;
}

// result が structured_output に入らなかったときの保険。最初の {...} を括弧の対応で切り出す
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

type StreamEvent = {
  type?: string;
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  event?: { delta?: { text?: string; partial_json?: string } };
};

let override: typeof generate | null = null;

/** テスト用: generate をこの関数に差し替える。null で戻す */
export function setAI(fn: typeof generate | null): void {
  override = fn;
}

export async function generate<T extends z.ZodType>(
  o: GenerateOpts<T>,
): Promise<z.infer<T>> {
  if (override) return override(o);

  const timeoutSec = config.aiTimeoutSec;
  // 空のフォルダで実行し、手元のプロジェクト設定 (CLAUDE.md など) を読ませない
  const dir = mkdtempSync(join(tmpdir(), "tka-ai-"));
  let timedOut = false;
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
  const kill = () => proc?.kill();
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutSec * 1000);
  o.signal?.addEventListener("abort", kill);
  try {
    const systemFile = join(dir, "system.txt");
    writeFileSync(systemFile, o.system);
    try {
      proc = Bun.spawn(
        buildArgs({
          bin: config.claudeBin,
          model: o.model ?? config.claudeModel,
          systemFile,
          schema: o.schema,
        }),
        {
          cwd: dir,
          env: cleanEnv(process.env),
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    } catch {
      throw new AIError(
        "Claude Code が見つかりません。インストールしてログインしてください",
      );
    }
    if (o.signal?.aborted) kill();

    const stderrText = new Response(proc.stderr).text();
    try {
      proc.stdin.write(o.prompt);
      await proc.stdin.end();
    } catch {
      // プロセスが先に落ちた場合。理由は下の stderr / result で報告する
    }

    let payload: StreamEvent | undefined;
    let tail = "";
    let written = 0;
    let buf = "";
    const onLine = (line: string) => {
      if (!line.trim()) return;
      tail = line;
      let ev: StreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "result") payload = ev;
      else if (ev.type === "stream_event" && o.onProgress) {
        const d = ev.event?.delta;
        const n = (d?.text ?? d?.partial_json ?? "").length;
        if (n) {
          written += n;
          o.onProgress(written);
        }
      }
    };
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let i = buf.indexOf("\n");
      while (i >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        i = buf.indexOf("\n");
      }
    }
    onLine(buf);
    await proc.exited;
    const err = await stderrText;

    if (timedOut) {
      throw new AIError(
        `Claude Code の応答が ${timeoutSec} 秒以内に返ってきませんでした`,
      );
    }
    if (o.signal?.aborted) throw new AIError("中断されました");
    if (!payload) {
      throw new AIError(
        `Claude Code の出力を読めませんでした: ${(err || tail).slice(-400)}`,
      );
    }
    if (payload.is_error) {
      throw new AIError(
        explainClaudeError(
          String(payload.result || payload.subtype || "不明なエラー"),
        ),
      );
    }
    const data = payload.structured_output ?? extractJson(payload.result ?? "");
    if (data === undefined) {
      throw new AIError("Claude Code の応答から JSON を取り出せませんでした");
    }
    const parsed = o.schema.safeParse(data);
    if (!parsed.success) {
      throw new AIError(
        `AI の返答が期待した形ではありません (${o.task}): ${z.prettifyError(parsed.error).slice(0, 400)}`,
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", kill);
    kill(); // 例外で抜けたときに claude を残さない (終了済みなら何も起きない)
    rmSync(dir, { recursive: true, force: true });
  }
}
