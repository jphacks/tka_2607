import { readFileSync, writeFileSync } from "node:fs";
import { applyResultSchema, SIM_DAYS } from "@tka/shared";
import { generate } from "./ai/client";
import { clampDay, cleanArchitecture, settled, uniqueDay } from "./clean";
import { diffRows, splitLines } from "./diff";
import { HttpError } from "./http";
import {
  chosenOf,
  currentDir,
  incidentFields,
  inside,
  isFile,
  nextIssueId,
} from "./project";
import { applyPrompt, applySystem } from "./prompts/apply";
import { readSources, relocate } from "./scanner";
import type { Effect, Issue, Project } from "./types";

/** 選び直したときに、前の修正の影響を元に戻す */
export function undoFix(p: Project, issue: Issue): void {
  const fix = issue.fix;
  if (!fix) return;
  const cur = currentDir(p.id);
  for (const [file, content] of Object.entries(fix.before_files)) {
    const target = inside(cur, file);
    if (target) writeFileSync(target, content);
  }
  p.architecture = fix.arch_before;
  for (const o of p.issues) {
    if (o.prevented_by === issue.id) {
      delete o.prevented_by;
      delete o.prevented_reason;
    }
    if (o.changed_by?.issue_id === issue.id) delete o.changed_by;
  }
  p.issues = p.issues.filter((o) => !(o.caused_by === issue.id && !o.feedback));
  issue.fix = null;
}

/** 決めた方針を current/ のコードと構成図に反映する。保存は呼び出し側 */
export async function applyFix(p: Project, issue: Issue): Promise<void> {
  if (!issue.decision) throw new HttpError(400, "先に修正案を選んでください");
  const cur = currentDir(p.id);
  // undoFix は AI に元のコードを見せるために先にファイルを戻す。失敗したら DB の状態 (前の修正あり) に合わせて戻す
  const applied: Record<string, string> = {};
  for (const file of Object.keys(issue.fix?.before_files ?? {})) {
    const t = inside(cur, file);
    if (t && isFile(t)) applied[file] = readFileSync(t, "utf8");
  }
  undoFix(p, issue);
  const chosen = chosenOf(issue);
  const evidence = p.findings.filter((f) => issue.finding_ids.includes(f.id));
  const future = p.issues
    .filter((o) => o.id !== issue.id && o.day > issue.day && !settled(o))
    .sort((a, b) => a.day - b.day);
  const archBefore = p.architecture;
  let result: Awaited<ReturnType<typeof generate<typeof applyResultSchema>>>;
  try {
    result = await generate({
      task: "apply",
      system: applySystem({
        bg: p.background,
        sources: readSources(cur, 60_000, relocate(cur, evidence)),
        arch: archBefore,
      }),
      prompt: applyPrompt({
        issue,
        chosen,
        reason: issue.decision.reason,
        future,
      }),
      schema: applyResultSchema,
    });
  } catch (e) {
    for (const [file, content] of Object.entries(applied)) {
      const t = inside(cur, file);
      if (t) writeFileSync(t, content);
    }
    throw e;
  }

  // コードの変更を反映する (後ろの行から置き換えて、行番号がずれないようにする)
  const byFile = new Map<string, typeof result.code_changes>();
  for (const c of result.code_changes) {
    byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  }
  const beforeFiles: Record<string, string> = {};
  const diffs = [];
  for (const [file, changes] of byFile) {
    const target = inside(cur, file); // current/ の外は書き換えない
    if (!target || !isFile(target)) continue;
    const before = readFileSync(target, "utf8");
    const lines = splitLines(before);
    const notes: string[] = [];
    let applied = false;
    let lastStart = lines.length + 2;
    for (const c of [...changes].sort((a, b) => b.start_line - a.start_line)) {
      const s = c.start_line;
      const e = c.end_line;
      // 範囲外・直前に適用した変更と重なるものは捨てる
      if (s > lines.length + 1 || s - 1 > e || e > lines.length) continue;
      if (e >= lastStart) continue;
      lines.splice(s - 1, e - (s - 1), ...c.new_lines);
      lastStart = s;
      applied = true;
      if (c.note) notes.push(c.note);
    }
    if (!applied) continue;
    const after = lines.join("\n") + (before.endsWith("\n") ? "\n" : "");
    writeFileSync(target, after);
    beforeFiles[file] = before;
    diffs.push({
      file,
      notes: notes.reverse(),
      rows: diffRows(before, after),
    });
  }

  let archAfter = cleanArchitecture(result.architecture_after);
  if (archAfter.nodes.length === 0) archAfter = archBefore;
  p.architecture = archAfter;

  // この先の出来事への影響
  const effects: Effect[] = [];
  const byId = new Map(p.issues.map((o) => [o.id, o]));
  const futureIds = new Set(future.map((o) => o.id));
  for (const e of result.future) {
    const o = byId.get(e.issue_id);
    if (!o || !futureIds.has(o.id)) continue;
    effects.push({
      issue_id: o.id,
      effect: e.effect,
      reason: e.reason,
      day: o.day,
    });
    if (e.effect === "prevented") {
      o.prevented_by = issue.id;
      o.prevented_reason = e.reason;
    } else if (e.effect === "reduced" || e.effect === "worse") {
      o.changed_by = {
        issue_id: issue.id,
        effect: e.effect,
        reason: e.reason,
      };
    }
  }

  // 修正が原因で新しく起きる出来事 (1件まで)
  const newIds: string[] = [];
  const nodeIds = new Set(archAfter.nodes.map((n) => n.id));
  for (const it of result.new_incidents.slice(0, 1)) {
    const day = uniqueDay(
      Math.max(issue.day + 1, clampDay(it.day, SIM_DAYS)),
      p.issues.map((o) => o.day),
      SIM_DAYS,
    );
    const created: Issue = {
      id: nextIssueId(p),
      day,
      chat: [],
      ...incidentFields(it, nodeIds),
      finding_ids: [],
      _rule: "side-effect",
      caused_by: issue.id,
      stance: "",
      decision: null,
      feedback: null,
      lesson: "",
    };
    p.issues.push(created);
    newIds.push(created.id);
  }
  p.issues.sort((a, b) => a.day - b.day);

  issue.fix = {
    summary: result.summary,
    diffs,
    arch_before: archBefore,
    arch_after: archAfter,
    arch_notes: result.arch_notes,
    effects,
    new_issue_ids: newIds,
    before_files: beforeFiles,
  };
  // 修正の結果を会話に流し、振り返りに進む
  issue.chat.push({ role: "event", kind: "fix", text: result.summary });
  if (result.reflection) {
    issue.chat.push({ role: "senior", name: "先輩", text: result.reflection });
  }
  issue.phase = "reflect";
  if (!issue.feedback) {
    issue.feedback = {
      consequence: result.summary,
      covered: [],
      questions: [],
      stance_gap: "",
    };
  }
}
