import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { config } from "../config";
import * as schema from "./schema";

const url = config.databaseUrl;
if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true });

export const db = drizzle(new Database(url, { create: true }), { schema });

// 起動のたびに未適用のマイグレーションを流す (apps/backend/drizzle)
migrate(db, { migrationsFolder: resolve(import.meta.dir, "../../drizzle") });
