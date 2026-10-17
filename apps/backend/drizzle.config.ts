import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

// src/config.ts は import.meta.dir を使うので、drizzle-kit からは読まず同じ既定値を持つ
// (cwd は apps/backend なので、リポジトリルートの data は ../../data)
const dataDir = process.env.DATA_DIR ?? "../../data";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? join(dataDir, "app.db") },
});
