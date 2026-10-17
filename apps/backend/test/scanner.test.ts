import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractFeatures,
  readConfig,
  readSources,
  relocate,
  scan,
  snapshotTarget,
} from "../src/scanner";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scanner-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, body: string) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
}

test("extractFeatures", () => {
  put(
    "bot.py",
    [
      '@app_commands.command(name="rank", description="x")',
      "async def rank(i): ...",
      "@bot.command()",
      "async def ping(ctx): ...",
      "@bot.event",
      "async def on_message(m): ...",
      "@tasks.loop(hours=1)",
      "async def hourly(): ...",
      "",
    ].join("\n"),
  );
  put("api.py", '@router.post("/items")\ndef add(): ...\n');
  put("srv.js", "app.get('/health', h);\nclient.on('messageCreate', f);\n");
  put("pages/Home.tsx", '<Route path="/home" />\n');
  put("tests/test_x.py", '@app.get("/ignored")\n');

  const feats = extractFeatures(root);
  const names = feats.map((f) => f.name);
  for (const want of [
    "コマンド: rank",
    "コマンド: ping",
    "イベント: on_message",
    "定期実行: hourly",
    "ルート: /items (post)",
    "ルート: /health (get)",
    "イベント: messageCreate",
    "画面: pages/Home.tsx",
    "画面: /home",
  ]) {
    expect(names).toContain(want);
  }
  expect(names.some((n) => n.includes("ignored"))).toBe(false);
  expect(new Set(names).size).toBe(names.length);
  expect(feats.map((f) => f.id)).toEqual(feats.map((_, i) => `f${i + 1}`));
  expect(extractFeatures(root)).toEqual(feats);
});

test("scan: 代表ルールが検出され、ダミー値とテストは除外される", () => {
  put(
    "app.py",
    [
      "from x import y",
      "DEBUG = True",
      'api_key = "sk-live-abcdef123456"',
      'api_key = "test-abcdef123456"',
      'db.execute("SELECT * FROM t WHERE id=" + uid)',
      "print(user.email)",
      'CORS(app, origins="*")',
      "",
    ].join("\n"),
  );
  put("tests/test_app.py", "DEBUG = True\n");
  put("node_modules/x/index.js", "DEBUG = True\n");

  const found = scan(root);
  const byRule = (r: string) => found.filter((f) => f.rule === r);
  expect(byRule("debug-enabled").map((f) => f.line)).toEqual([2]);
  expect(byRule("hardcoded-secret").map((f) => f.line)).toEqual([3]);
  expect(byRule("sql-string-build").map((f) => f.line)).toEqual([5]);
  expect(byRule("select-all-columns").map((f) => f.line)).toEqual([5]);
  expect(byRule("pii-in-logs").map((f) => f.line)).toEqual([6]);
  expect(byRule("cors-wildcard").map((f) => f.line)).toEqual([7]);
  expect(found.every((f) => f.file === "app.py")).toBe(true);
  expect(found.map((f) => f.id)).toEqual(found.map((_, i) => `F${i + 1}`));
  expect(found[0].snippet).toContain("   1  from x import y");
});

test("scan: 認証なしのルートだけ拾う / 複数行のSQLも拾う", () => {
  put(
    "api.py",
    [
      '@app.get("/open")',
      "def open_(): ...",
      '@app.get("/closed")',
      "def closed(user=Depends(auth)): ...",
      "db.execute(",
      '    "SELECT a FROM t WHERE x=" + v',
      ")",
      "",
    ].join("\n"),
  );
  const found = scan(root);
  expect(
    found.filter((f) => f.rule === "route-without-auth").map((f) => f.title),
  ).toEqual(["認証なしで呼べるAPI（/open）"]);
  expect(found.filter((f) => f.rule === "sql-string-build")).toHaveLength(1);
});

test("relocate: 行がずれても snippet の行で探し直す", () => {
  put("app.py", "import os\n\n\nDEBUG = True\n");
  const [f] = scan(root);
  put("app.py", "# a\n# b\nimport os\n\n\nDEBUG = True\n");
  expect(relocate(root, [f])[0].line).toBe(f.line + 2);
  expect(relocate(root, [{ ...f, file: "missing.py" }])[0].line).toBe(f.line);
});

test("readSources: 指摘ファイルが先頭、入りきらないものはフォルダごとに列挙", () => {
  put("a.py", "x = 1\n");
  put("b.py", "y = 2\n");
  put("sub/c.py", `z = 3\n${"# pad\n".repeat(50)}`);
  const full = readSources(root, 60_000, [{ file: "b.py", line: 1 }]);
  expect(full.indexOf("### b.py")).toBeLessThan(full.indexOf("### a.py"));
  expect(full).toContain("   1  y = 2");

  const small = readSources(root, 40, [{ file: "b.py", line: 1 }]);
  expect(small).toContain("### b.py");
  expect(small).toContain("中身を省略したファイル");
  expect(small).toContain("sub/ (1): c.py");
});

test("readConfig: 秘密の値を伏せる", () => {
  put(
    "docker-compose.yml",
    "services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: hunter2\n    image: x@sha256:" +
      "a".repeat(64) +
      "\n  app:\n    environment:\n      DATABASE_URL: postgres://u:pw123@db/x\n",
  );
  put("docker-compose.dev.yml", "services: {}\n");
  put(".env.example", "API_KEY=sk-real-value\nPORT=3000\n");
  put(".env", "SECRET=should-not-be-read\n");
  put("README.md", "# hi\n");
  put("docs/README.md", "# deeper\n");

  const out = readConfig(root);
  expect(out).toContain("POSTGRES_PASSWORD: …");
  expect(out).toContain("postgres://u:…@db/x");
  expect(out).toContain("API_KEY=…");
  expect(out).toContain("PORT=…");
  expect(out).not.toContain("hunter2");
  expect(out).not.toContain("pw123");
  expect(out).not.toContain("sk-real-value");
  expect(out).not.toContain("sha256");
  expect(out).not.toContain("should-not-be-read");
  expect(out).not.toContain("docker-compose.dev.yml");
  expect(out).not.toContain("deeper");
  expect(out.indexOf("docker-compose.yml")).toBeLessThan(out.indexOf("README"));
});

test("snapshotTarget: 自分自身・node_modules・data・symlink を除いてコピーし、内側のコピー先でも止まる", () => {
  put("app/main.py", "print(1)\n");
  put("app/node_modules/x.js", "x\n");
  put("app/.git/HEAD", "ref\n");
  put("data/secret.db", "db\n");
  put("tka_2607/index.ts", "self\n");
  put("other/data/keep.txt", "nested data is kept\n");
  symlinkSync(join(root, "app/main.py"), join(root, "link.py"));

  const dest = join(root, "tka_2607/data/projects/p1"); // 対象の内側 (除外された自分自身のさらに内側)
  snapshotTarget(root, dest, [join(root, "tka_2607")]);
  expect(existsSync(join(dest, "app/main.py"))).toBe(true);
  expect(existsSync(join(dest, "other/data/keep.txt"))).toBe(true);
  expect(existsSync(join(dest, "app/node_modules"))).toBe(false);
  expect(existsSync(join(dest, "app/.git"))).toBe(false);
  expect(existsSync(join(dest, "data"))).toBe(false);
  expect(existsSync(join(dest, "tka_2607"))).toBe(false);
  expect(existsSync(join(dest, "link.py"))).toBe(false);

  // 除外に自分自身を渡さなくても、コピー先が対象の内側なら再帰しない
  const dest2 = join(root, "snap2");
  snapshotTarget(root, dest2, []);
  expect(existsSync(join(dest2, "app/main.py"))).toBe(true);
  expect(existsSync(join(dest2, "snap2"))).toBe(false);
});
