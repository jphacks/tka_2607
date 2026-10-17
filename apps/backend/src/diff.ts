import type { DiffRow } from "./types";

type Op = { eq: boolean; i1: number; i2: number; j1: number; j2: number };

// shortcut: 先頭・末尾を除いた変更部分が 5000x5000 行を超えると丸ごと差し替え扱い, 必要になったら Myers 法にする
const MAX_CELLS = 25_000_000;
const CONTEXT = 3;

// Python の str.splitlines 相当 (末尾の改行では空行を作らない)
export function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function opcodes(a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  const push = (
    eq: boolean,
    i1: number,
    i2: number,
    j1: number,
    j2: number,
  ) => {
    if (i1 === i2 && j1 === j2) return;
    const last = ops[ops.length - 1];
    if (last && last.eq === eq) {
      last.i2 = i2;
      last.j2 = j2;
    } else ops.push({ eq, i1, i2, j1, j2 });
  };

  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (
    s < a.length - p &&
    s < b.length - p &&
    a[a.length - 1 - s] === b[b.length - 1 - s]
  )
    s++;
  push(true, 0, p, 0, p);

  const aEnd = a.length - s;
  const bEnd = b.length - s;
  const w = bEnd - p + 1;
  if ((aEnd - p + 1) * w > MAX_CELLS) {
    push(false, p, aEnd, p, bEnd);
  } else {
    // dp[i][j] = a[i..] と b[j..] の最長共通部分列の長さ
    const dp = new Uint32Array((aEnd - p + 1) * w);
    const at = (i: number, j: number) => (i - p) * w + (j - p);
    for (let i = aEnd - 1; i >= p; i--) {
      for (let j = bEnd - 1; j >= p; j--) {
        dp[at(i, j)] =
          a[i] === b[j]
            ? (dp[at(i + 1, j + 1)] ?? 0) + 1
            : Math.max(dp[at(i + 1, j)] ?? 0, dp[at(i, j + 1)] ?? 0);
      }
    }
    let i = p;
    let j = p;
    while (i < aEnd && j < bEnd) {
      if (a[i] === b[j]) {
        push(true, i, i + 1, j, j + 1);
        i++;
        j++;
      } else if ((dp[at(i + 1, j)] ?? 0) >= (dp[at(i, j + 1)] ?? 0)) {
        push(false, i, i + 1, j, j);
        i++;
      } else {
        push(false, i, i, j, j + 1);
        j++;
      }
    }
    push(false, i, aEnd, j, bEnd);
  }
  push(true, aEnd, a.length, bEnd, b.length);
  return ops;
}

// Python の difflib.SequenceMatcher.get_grouped_opcodes と同じ前後の切り方
function groupedOps(all: Op[], n: number): Op[][] {
  if (all.length === 0) return [];
  const codes = all.map((o) => ({ ...o }));
  const first = codes[0] as Op;
  if (first.eq) {
    first.i1 = Math.max(first.i1, first.i2 - n);
    first.j1 = Math.max(first.j1, first.j2 - n);
  }
  const last = codes[codes.length - 1] as Op;
  if (last.eq) {
    last.i2 = Math.min(last.i2, last.i1 + n);
    last.j2 = Math.min(last.j2, last.j1 + n);
  }
  const groups: Op[][] = [];
  let group: Op[] = [];
  for (const c of codes) {
    let { i1, j1 } = c;
    if (c.eq && c.i2 - c.i1 > n * 2) {
      group.push({
        eq: true,
        i1,
        i2: Math.min(c.i2, i1 + n),
        j1,
        j2: Math.min(c.j2, j1 + n),
      });
      groups.push(group);
      group = [];
      i1 = Math.max(i1, c.i2 - n);
      j1 = Math.max(j1, c.j2 - n);
    }
    group.push({ ...c, i1, j1 });
  }
  if (group.length > 0 && !(group.length === 1 && group[0]?.eq))
    groups.push(group);
  return groups;
}

/** 修正前後の差分を、画面で並べやすい行のリストにする */
export function diffRows(before: string, after: string): DiffRow[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const rows: DiffRow[] = [];
  for (const group of groupedOps(opcodes(a, b), CONTEXT)) {
    rows.push({ type: "hunk", text: `${(group[0] as Op).i1 + 1}行目あたり` });
    for (const { eq, i1, i2, j1, j2 } of group) {
      if (eq) {
        for (let k = 0; k < i2 - i1; k++)
          rows.push({
            type: "ctx",
            old: i1 + k + 1,
            new: j1 + k + 1,
            text: a[i1 + k] as string,
          });
        continue;
      }
      for (let k = i1; k < i2; k++)
        rows.push({ type: "del", old: k + 1, new: null, text: a[k] as string });
      for (let k = j1; k < j2; k++)
        rows.push({ type: "add", old: null, new: k + 1, text: b[k] as string });
    }
  }
  return rows;
}
