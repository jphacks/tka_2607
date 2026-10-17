/**
 * コードから「根拠になる箇所」を機械的に拾う簡易スキャナ。
 *
 * AI にいきなり脆弱性を探させると、ありもしない問題を言い出すことがある。
 * そこで、まずルールで該当行を拾い、AI にはその行を根拠に「運用で何が起きるか」を説明させる。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const CODE_EXT = new Set([
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".php",
  ".rb",
  ".go",
  ".java",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "__pycache__",
  "dist",
  "build",
]);
const MAX_FILE_BYTES = 200_000;
const TEST_PATH =
  /(^|[\\/])(test|tests|__tests__|__mocks__|fixtures|e2e)([\\/]|$)|\.(test|spec)\.|(^|[\\/])test_[^\\/]*\.py$|_test\.(py|go)$/i;

export type Finding = {
  id: string;
  rule: string;
  title: string;
  file: string;
  line: number;
  snippet: string;
};

type Rule = {
  rule: string;
  title: string;
  pattern: RegExp;
  multilineHint?: RegExp;
  ignoreValue?: RegExp;
};

const RULES: Rule[] = [
  {
    rule: "sql-string-build",
    title: "SQLを文字列の連結で組み立てている",
    pattern:
      /(execute|query|raw)\s*\(\s*(f["'].*(SELECT|INSERT|UPDATE|DELETE).*\{|["'].*(SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+)/i,
    multilineHint:
      /^\s*(f["']|["']).*(SELECT|INSERT|UPDATE|DELETE).*(\{|["']\s*\+)/i,
  },
  {
    rule: "hardcoded-secret",
    title: "APIキーやパスワードをコードに直接書いている",
    pattern:
      /(api_?key|secret|password|passwd|token)\w*\s*[:=]\s*["'](?<val>[^"'\s]{8,})["']/i,
    // 明らかなプレースホルダだけ捨てる ("prod-test-..." のような本物は残し、判断は AI の dismissed に任せる)
    ignoreValue:
      /^(test|dummy|example|sample|placeholder|changeme|fake|mock)([-_.].*)?$|^your[-_]|^x{4,}$|^<.*>$|^\$\{.*\}$/i,
  },
  {
    rule: "debug-enabled",
    title: "デバッグモードのまま公開している",
    pattern: /debug\s*=\s*True|DEBUG\s*=\s*True/i,
  },
  {
    rule: "cors-wildcard",
    title: "どのサイトからでもAPIを呼べる設定（CORS *）",
    pattern:
      /origins\s*=\s*["']\*["']|Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*/i,
  },
  {
    rule: "pii-in-logs",
    title: "ログに個人情報を書き出している",
    pattern:
      /(log(ger)?\.\w+|print|console\.log)\s*\(.*(email|phone|tel|address|password)/i,
  },
  {
    rule: "select-all-columns",
    title: "全カラム（SELECT *）をそのまま返している",
    pattern: /SELECT\s+\*\s+FROM/i,
  },
];

const AUTH_WORDS =
  /check_key|login_required|auth|token|Depends\(|permission|verify/i;
const ROUTE_RE =
  /^\s*@\w+\.(route|get|post|put|delete|patch)\(\s*["']([^"']+)["']/;

// Python の str.splitlines() 相当 (行番号を元の実装と揃えるため)
// biome-ignore lint/suspicious/noControlCharactersInRegex: splitlines が区切る制御文字をそのまま使う
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;
function splitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function snippet(lines: string[], idx: number, around = 2): string {
  const lo = Math.max(0, idx - around);
  const hi = Math.min(lines.length, idx + around + 1);
  const out: string[] = [];
  for (let n = lo; n < hi; n++) {
    out.push(`${String(n + 1).padStart(4)}  ${lines[n]}`);
  }
  return out.join("\n");
}

// テストは本番で動かないので対象外
const isTestPath = (rel: string) => TEST_PATH.test(rel);

type Entry = { rel: string; abs: string; name: string };

// 除外ディレクトリは降りない。シンボリックリンクは辿らない。名前順の深さ優先で、Python の sorted(rglob) と同じ並びになる
function walk(root: string): Entry[] {
  const out: Entry[] = [];
  const visit = (dir: string, relDir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push({ rel, abs: join(dir, e.name), name: e.name });
      }
    }
  };
  visit(root, "");
  return out;
}

function iterFiles(root: string): Entry[] {
  return walk(root).filter(
    (f) =>
      !isTestPath(f.rel) &&
      CODE_EXT.has(extname(f.name)) &&
      statSync(f.abs).size <= MAX_FILE_BYTES,
  );
}

/** Python のルート定義で、関数の中に認証チェックが見当たらないもの */
function routeWithoutAuth(lines: string[]) {
  const out: { rule: string; title: string; idx: number }[] = [];
  lines.forEach((line, i) => {
    const m = ROUTE_RE.exec(line);
    if (!m) return;
    const body: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      if (
        j > i + 1 &&
        (ROUTE_RE.test(lines[j]) || /^(def |class |if __name__)/.test(lines[j]))
      ) {
        break;
      }
      body.push(lines[j]);
    }
    if (!AUTH_WORDS.test(body.join("\n"))) {
      out.push({
        rule: "route-without-auth",
        title: `認証なしで呼べるAPI（${m[2]}）`,
        idx: i,
      });
    }
  });
  return out;
}

export function scan(root: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (
    rule: string,
    title: string,
    rel: string,
    lines: string[],
    idx: number,
  ) => {
    const key = `${rule}\0${rel}\0${idx}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id: `F${findings.length + 1}`,
      rule,
      title,
      file: rel,
      line: idx + 1,
      snippet: snippet(lines, idx),
    });
  };

  for (const f of iterFiles(root)) {
    const lines = splitLines(readFileSync(f.abs, "utf8"));
    lines.forEach((line, i) => {
      for (const r of RULES) {
        let hit = r.pattern.exec(line);
        if (
          !hit &&
          r.multilineHint &&
          i > 0 &&
          /(execute|query)\s*\(\s*$/.test(lines[i - 1])
        ) {
          hit = r.multilineHint.exec(line);
        }
        // ダミー値は拾わない
        if (hit && r.ignoreValue?.test(hit.groups?.val ?? "")) hit = null;
        if (hit) add(r.rule, r.title, f.rel, lines, i);
      }
    });
    if (extname(f.name) === ".py") {
      for (const r of routeWithoutAuth(lines)) {
        add(r.rule, r.title, f.rel, lines, r.idx);
      }
    }
  }
  return findings;
}

const MAX_FEATURES = 150;
const NEXT_DEF = /^\s*(?:async\s+)?def\s+(\w+)/;
const Q = "[\"'`]([^\"'`]+)[\"'`]";
// 1行で名前まで取れるもの: [正規表現, 表示名]。{0}{1} は正規表現のグループ
const FEATURE_LINE: [RegExp, string][] = [
  [
    new RegExp(
      String.raw`\.(?:command|hybrid_command|slash_command)\([^)]*?\bname\s*=\s*${Q}`,
    ),
    "コマンド: {0}",
  ],
  [new RegExp(String.raw`\bsetName\(\s*${Q}`), "コマンド: {0}"],
  [
    new RegExp(String.raw`\b(?:client|bot)\.(?:on|once)\(\s*${Q}`),
    "イベント: {0}",
  ],
  [
    new RegExp(
      String.raw`@\w+(?:\.\w+)*\.(get|post|put|delete|patch|route)\(\s*${Q}`,
    ),
    "ルート: {1} ({0})",
  ],
  [
    new RegExp(
      String.raw`\b(?:app|router)\.(get|post|put|delete|patch)\(\s*${Q}`,
    ),
    "ルート: {1} ({0})",
  ],
  [/\bpath\s*(?:=\s*\{?\s*|:\s*)["']([^"']+)["']/, "画面: {0}"],
  [/\bschedule\.every\(([^)]*)\)/, "定期実行: every({0})"],
  [/cron.*["']((?:[\d*/,-]+\s+){4}[\d*/,-]+)["']/i, "定期実行: cron {0}"],
];
// 次の def の名前を機能名にするもの (デコレータだけの行)
const FEATURE_DECO: [RegExp, string][] = [
  [/^\s*@\w+(?:\.\w+)*\.(?:command|hybrid_command)\(\s*\)/, "コマンド: {0}"],
  [/^\s*@[\w.]+\.(?:event|listener)\b/, "イベント: {0}"],
  [/^\s*@tasks\.loop\(/, "定期実行: {0}"],
];
const PAGE_PATH =
  /(^|\/)pages\/.+\.(tsx|jsx|ts|js)$|(^|\/)app\/(.+\/)?page\.(tsx|jsx|ts|js)$/;

const fill = (fmt: string, g: string[]) =>
  fmt.replace(/\{(\d)\}/g, (_, n) => g[Number(n)]);

export type Feature = { id: string; name: string; source: string };

/** コードから機能 (コマンド・イベント・ルート・画面・定期処理) を機械的に拾う。決定的・ソート済み・重複なし */
export function extractFeatures(root: string): Feature[] {
  const found = new Map<string, string>(); // 機能名 -> 最初に見つけた場所
  const setDefault = (name: string, src: string) => {
    if (!found.has(name)) found.set(name, src);
  };
  for (const f of iterFiles(root)) {
    const lines = splitLines(readFileSync(f.abs, "utf8"));
    if (PAGE_PATH.test(f.rel)) setDefault(`画面: ${f.rel}`, `${f.rel}:1`);
    lines.forEach((line, i) => {
      for (const [pat, fmt] of FEATURE_DECO) {
        if (!pat.test(line)) continue;
        for (const l of lines.slice(i + 1, i + 6)) {
          const m = NEXT_DEF.exec(l);
          if (m) {
            setDefault(fill(fmt, [m[1]]), `${f.rel}:${i + 1}`);
            break;
          }
        }
      }
      for (const [pat, fmt] of FEATURE_LINE) {
        const m = pat.exec(line);
        if (m) {
          setDefault(
            fill(
              fmt,
              m.slice(1).map((x) => x.trim()),
            ),
            `${f.rel}:${i + 1}`,
          );
        }
      }
    });
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const items = [...found.entries()].sort(
    (a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]),
  );
  // shortcut: 上限を超えたら名前順で切る。重要度順にしたければ種類ごとに優先度をつける
  return items
    .slice(0, MAX_FEATURES)
    .map(([name, source], n) => ({ id: `f${n + 1}`, name, source }));
}

/** 指摘行の前後だけを元の行番号つきで取り出す (重なる範囲は結合) */
function excerpt(
  rel: string,
  lines: string[],
  hitLines: number[],
  around = 30,
): string {
  const ranges: [number, number][] = [];
  for (const n of [...hitLines].sort((a, b) => a - b)) {
    const lo = Math.max(1, n - around);
    const hi = Math.min(lines.length, n + around);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  const body = ranges
    .map(([lo, hi]) => {
      const out: string[] = [];
      for (let n = lo; n <= hi; n++) {
        out.push(`${String(n).padStart(4)}  ${lines[n - 1]}`);
      }
      return out.join("\n");
    })
    .join("\n   …\n");
  // 見出しはファイル名だけにする (AI が修正先のファイル名として使うため)
  return `### ${rel}\n（抜粋）\n${body}\n`;
}

/** 修正で行がずれたファイルでも指摘行を指すよう、snippet の該当行の文字列で今の行番号を探し直す */
export function relocate<F extends { file: string; line: number }>(
  root: string,
  findings: (F & { snippet?: string })[],
): F[] {
  return findings.map((f) => {
    const m = new RegExp(`^\\s*${f.line}  (.*)$`, "m").exec(f.snippet ?? "");
    const path = join(root, f.file);
    if (m?.[1].trim() && existsSync(path) && statSync(path).isFile()) {
      const lines = splitLines(readFileSync(path, "utf8"));
      let best: number | undefined;
      lines.forEach((l, i) => {
        // 同じ行が複数あれば元の位置に一番近いもの。見つからなければ元の番号のまま
        if (
          l === m[1] &&
          (best === undefined ||
            Math.abs(i + 1 - f.line) < Math.abs(best - f.line))
        ) {
          best = i + 1;
        }
      });
      if (best !== undefined) return { ...f, line: best };
    }
    return f;
  });
}

const CONFIG_NAME =
  /^(docker-compose.*\.ya?ml|compose.*\.ya?ml|dockerfile.*|caddyfile|nginx.*\.conf|procfile|fly\.toml|vercel\.json|netlify\.toml|render\.yaml|app\.yaml|\.env\.example|\.env\.sample|readme\.md)$/i;
const ENV_VALUE = /^(\s*(?:export\s+)?[A-Za-z_][\w.]*\s*=).*$/;
// 値は行末まで ([^…\r\n]*)。参考実装は改行も含めてしまい、最初の秘密以降のファイル全体が … になっていた
// compose などの「PASSWORD: xxx」「- API_KEY=xxx」の値も伏せる。行頭でなくても ({API_KEY: xxx, ...} のような1行の書き方でも) 伏せる
const SECRET_VALUE =
  /([\w.-]*(?:password|passwd|secret|token|api_?key|private_?key|credential)[\w.-]*["']?\s*[:=]\s*)(?!…)[^,}\]\s][^,}\]\r\n]*/gi;
const COMPOSE_NAME = /^(docker-)?compose.*\.ya?ml$/i;
const COMPOSE_VARIANT = /\.(dev|override|local|test)\.ya?ml$/i;

/** AI に渡す構成ファイル (docker-compose・Dockerfile・README など)。参考用なので行番号は付けない。
 * .env は読まない。.env.example の値は本物の秘密が入っていることがあるので伏せる */
export function readConfig(root: string, limitChars = 25_000): string {
  const depth = (rel: string) => rel.split("/").length;
  let found = walk(root).filter(
    (f) => CONFIG_NAME.test(f.name) && !isTestPath(f.rel),
  );
  const readmes = found
    .filter((f) => f.name.toLowerCase() === "readme.md")
    .map((f) => depth(f.rel));
  found = found.filter(
    (f) =>
      f.name.toLowerCase() !== "readme.md" ||
      depth(f.rel) === Math.min(...readmes),
  );
  // 開発用の compose (docker-compose.dev.yml など) は、同じ場所に本体があれば外す
  const bases = new Set(
    found
      .filter((f) => COMPOSE_NAME.test(f.name) && !COMPOSE_VARIANT.test(f.name))
      .map((f) => dirname(f.abs)),
  );
  found = found.filter(
    (f) => !(COMPOSE_VARIANT.test(f.name) && bases.has(dirname(f.abs))),
  );
  // 構成がいちばんわかる compose を先に
  const key = (f: Entry) =>
    [!COMPOSE_NAME.test(f.name), depth(f.rel), f.abs] as const;
  found.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (
      Number(x[0]) - Number(y[0]) ||
      x[1] - y[1] ||
      (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0)
    );
  });

  const parts: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const f of found) {
    let text = readFileSync(f.abs, "utf8");
    if (f.name.toLowerCase().startsWith(".env")) {
      text = splitLines(text)
        .map((l) => l.replace(ENV_VALUE, "$1…"))
        .join("\n");
    }
    text = text.replace(SECRET_VALUE, "$1…");
    text = text.replace(/(:\/\/[^/\s:@]+):[^@\s]+@/g, "$1:…@"); // URL に埋め込まれたパスワード
    text = text.replace(/@sha256:[0-9a-f]{64}/g, ""); // イメージのダイジェストは長いだけなので外す
    const cap = COMPOSE_NAME.test(f.name) ? 12_000 : 4_000;
    if (text.length > cap) text = `${text.slice(0, cap)}…（以下省略）`;
    const chunk = `### ${f.rel}\n${text}\n`;
    if (total + chunk.length > limitChars) {
      skipped.push(f.rel);
      continue;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  if (skipped.length) {
    parts.push(`（容量のため省略: ${skipped.join("、")}）`);
  }
  return parts.join("\n");
}

/** AI に渡すためのソースコード。指摘のあるファイルを先に入れ、入りきらなければ指摘の前後だけ、
 * それも無理なら (他のファイルも) パスだけ載せる */
export function readSources(
  root: string,
  limitChars = 60_000,
  findings: { file: string; line: number }[] = [],
): string {
  const hits = new Map<string, number[]>();
  for (const f of findings) {
    hits.set(f.file, [...(hits.get(f.file) ?? []), f.line]);
  }
  // 安定ソート: 指摘ありが先頭、残りは元の順
  const files = iterFiles(root).sort(
    (a, b) => Number(!hits.has(a.rel)) - Number(!hits.has(b.rel)),
  );
  const parts: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const { rel, abs } of files) {
    const lines = splitLines(readFileSync(abs, "utf8"));
    let chunk = `### ${rel}\n${lines
      .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
      .join("\n")}\n`;
    const hit = hits.get(rel);
    if (total + chunk.length > limitChars && hit) {
      chunk = excerpt(rel, lines, hit);
    }
    if (total + chunk.length > limitChars) {
      skipped.push(rel);
      continue;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  if (skipped.length) {
    // ファイル1つずつだと名前順の先頭しか入らないので、フォルダごとにまとめて全体の形が見えるようにする
    const dirs = new Map<string, string[]>();
    for (const rel of skipped) {
      const d = dirname(rel);
      dirs.set(d, [...(dirs.get(d) ?? []), basename(rel)]);
    }
    const listed: string[] = [];
    let size = 0;
    for (const [d, names] of [...dirs.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      const line = `${d}/ (${names.length}): ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`;
      if (size + line.length > 8_000) {
        listed.push(`…ほか ${dirs.size - listed.length}フォルダ`);
        break;
      }
      listed.push(line);
      size += line.length + 1;
    }
    parts.push(
      `## 中身を省略したファイル（フォルダごと: ファイル数とファイル名）\n${listed.join("\n")}`,
    );
  }
  return parts.join("\n");
}

/** targetDir を dest にコピーする。元のファイルは変えない。
 * 除外: SKIP_DIRS・直下の data・excludeAbs・dest 自身 (dest が targetDir の内側でも再帰しない)・シンボリックリンク */
export function snapshotTarget(
  targetDir: string,
  dest: string,
  excludeAbs: string[],
): void {
  const root = resolve(targetDir);
  const excluded = new Set(
    [...excludeAbs, dest, join(root, "data")].map((p) => resolve(p)),
  );
  // cpSync は dest が src の内側だと filter の前に拒否するので、自前で降りる
  const copy = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name);
      if (excluded.has(src)) continue;
      if (/^\.env(\.|$)/i.test(e.name) && !/\.(example|sample)$/i.test(e.name))
        continue; // 秘密を複製しない
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) copy(src, join(to, e.name));
      } else if (e.isFile()) {
        copyFileSync(src, join(to, e.name));
      }
    }
  };
  copy(root, resolve(dest));
}
