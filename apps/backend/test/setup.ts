// bun test は全ファイルが同じプロセスで動くので、config / db が読まれる前にここで環境を固定する
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.DATABASE_URL = ":memory:";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tka-test-"));
process.env.TARGET_DIR = resolve(
  import.meta.dir,
  "../../../samples/a_company_api",
);
// 実際の claude を呼ばない
process.env.CLAUDE_BIN = "/nonexistent/claude";
