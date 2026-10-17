import { config } from "../config";
import { cleanEnv } from "./client";

export type AIStatus = { ok: boolean; detail: string };

const TIMEOUT_MS = 15_000;

export async function claudeStatus(): Promise<AIStatus> {
  const bin = Bun.which(config.claudeBin);
  if (!bin) {
    return {
      ok: false,
      detail:
        "Claude Code が見つかりません。インストールして `claude` でログインしてください",
    };
  }
  try {
    const proc = Bun.spawn([bin, "auth", "status"], {
      env: cleanEnv(process.env),
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    clearTimeout(timer);
    if (proc.signalCode) throw new Error("timeout");
    const method = (JSON.parse(out || "{}") as { authMethod?: string })
      .authMethod;
    if (code !== 0 || method === "none") {
      return {
        ok: false,
        detail:
          "Claude Code にログインしていません。ターミナルで `claude` を起動してログインしてください",
      };
    }
    if (method !== "claude.ai") {
      return {
        ok: true,
        detail: `ログイン方法: ${method}（Proプランの枠ではない可能性があります）`,
      };
    }
    return { ok: true, detail: "Proプランでログイン済み" };
  } catch {
    // 古いバージョンなど auth status が使えない場合は、呼べるかどうかだけで判断する
    return { ok: true, detail: "ログイン状態は未確認" };
  }
}
