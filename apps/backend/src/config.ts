import { resolve } from "node:path";

// apps/backend/src から3つ上がリポジトリルート
export const REPO_ROOT = resolve(import.meta.dir, "../../..");

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? resolve(REPO_ROOT, "data"));

export const config = {
  port: Number(env.PORT ?? 3001),
  // ":memory:" も使える (テスト用)
  databaseUrl: env.DATABASE_URL ?? resolve(dataDir, "app.db"),
  // 検査プロダクトの中にこのリポジトリを置く前提なので、既定は親フォルダ
  targetDir: resolve(env.TARGET_DIR ?? resolve(REPO_ROOT, "..")),
  dataDir,
  claudeBin: env.CLAUDE_BIN ?? "claude",
  claudeModel: env.CLAUDE_MODEL ?? "sonnet",
  aiTimeoutSec: Number(env.AI_TIMEOUT ?? 600),
};
