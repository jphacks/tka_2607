import { expect, test } from "bun:test";
import { diffRows } from "../src/diff";

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line${i + 1}`);

test("同じ内容なら差分なし", () => {
  expect(diffRows("a\nb\n", "a\nb\n")).toEqual([]);
  expect(diffRows("", "")).toEqual([]);
});

test("1行の置換は hunk / ctx / del / add になる", () => {
  expect(diffRows("a\nb\nc\n", "a\nX\nc\n")).toEqual([
    { type: "hunk", text: "1行目あたり" },
    { type: "ctx", old: 1, new: 1, text: "a" },
    { type: "del", old: 2, new: null, text: "b" },
    { type: "add", old: null, new: 2, text: "X" },
    { type: "ctx", old: 3, new: 3, text: "c" },
  ]);
});

test("hunk の行番号は前の文脈3行ぶん手前から数える", () => {
  const before = lines(30);
  const after = [...before];
  after[19] = "changed"; // 20行目
  const rows = diffRows(before.join("\n"), after.join("\n"));
  expect(rows[0]).toEqual({ type: "hunk", text: "17行目あたり" });
  expect(rows.filter((r) => r.type === "ctx")).toHaveLength(6);
  expect(rows.filter((r) => r.type === "del")).toEqual([
    { type: "del", old: 20, new: null, text: "line20" },
  ]);
});

test("離れた変更は hunk が分かれる", () => {
  const before = lines(40);
  const after = [...before];
  after[1] = "x";
  after[35] = "y";
  const hunks = diffRows(before.join("\n"), after.join("\n")).filter(
    (r) => r.type === "hunk",
  );
  expect(hunks.map((h) => h.text)).toEqual(["1行目あたり", "33行目あたり"]);
});

test("追加だけ・削除だけ、空の側", () => {
  expect(diffRows("", "a\nb")).toEqual([
    { type: "hunk", text: "1行目あたり" },
    { type: "add", old: null, new: 1, text: "a" },
    { type: "add", old: null, new: 2, text: "b" },
  ]);
  expect(diffRows("a\n", "")).toEqual([
    { type: "hunk", text: "1行目あたり" },
    { type: "del", old: 1, new: null, text: "a" },
  ]);
});

test("数千行でも速い", () => {
  const before = lines(4000);
  const after = before.filter((_, i) => i % 7 !== 0).concat(["tail"]);
  const t = performance.now();
  const rows = diffRows(before.join("\n"), after.join("\n"));
  expect(performance.now() - t).toBeLessThan(2000);
  expect(rows.filter((r) => r.type === "add")).toHaveLength(1);
  expect(rows.filter((r) => r.type === "del").length).toBeGreaterThan(500);
});
