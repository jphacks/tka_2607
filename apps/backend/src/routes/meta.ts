import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { claudeStatus } from "../ai/status";
import { config } from "../config";
import * as repo from "../repo";

const targetExists = () =>
  existsSync(config.targetDir) && statSync(config.targetDir).isDirectory();

// 検査対象に background.json があれば、登録フォームの下書きに使う
function readBackground(): unknown {
  try {
    return JSON.parse(
      readFileSync(join(config.targetDir, "background.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

export default new Hono()
  .get("/config", async (c) =>
    c.json({
      provider: "claude_code" as const,
      label: "Claude Code（Proプラン）",
      status: await claudeStatus(),
      target: { dir: config.targetDir, exists: targetExists() },
    }),
  )
  .get("/target", (c) =>
    c.json({
      dir: config.targetDir,
      exists: targetExists(),
      background: readBackground(),
    }),
  )
  .get("/lessons", (c) => c.json(repo.listLessons()));
