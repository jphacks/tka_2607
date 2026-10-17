import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type Issue as Incident, SIM_DAYS } from "@tka/shared";
import { config } from "./config";
import { HttpError } from "./http";
import * as repo from "./repo";
import type { Issue, Lesson, Project } from "./types";

const projectDir = (pid: string) => join(config.dataDir, "projects", pid);
/** 登録時のコピー (元の状態) */
export const srcDir = (pid: string) => join(projectDir(pid), "src");
/** 修正を入れていく作業コピー。元のファイルや src は変えない */
export const currentDir = (pid: string) => join(projectDir(pid), "current");

/** root の中のファイルだけを返す (区切り文字つきで検査し、/root-evil のような兄弟も弾く) */
export function inside(root: string, rel: string): string | null {
  const r = resolve(root);
  const f = resolve(r, rel);
  return f.startsWith(r + sep) ? f : null;
}

export const isFile = (path: string) =>
  existsSync(path) && statSync(path).isFile();

export function loadProject(pid: string): Project {
  const p = repo.getProject(pid);
  if (!p) throw new HttpError(404, "プロジェクトが見つかりません");
  return p;
}

export function findIssue(p: Project, iid: string): Issue {
  const issue = p.issues.find((i) => i.id === iid);
  if (!issue) throw new HttpError(404, "問題が見つかりません");
  return issue;
}

export function nextIssueId(p: Project): string {
  const nums = p.issues.map((i) => Number(i.id.slice(1)));
  return `I${Math.max(0, ...nums.filter(Number.isInteger)) + 1}`;
}

/** AI が作った出来事から、保存する項目を取り出す (affected_nodes は構成図にあるものだけ) */
export function incidentFields(
  it: Omit<Incident, "finding_ids" | "if_ignored" | "day">,
  nodeIds: Set<string>,
) {
  return {
    title: it.title,
    category: it.category,
    severity: it.severity,
    what_happens: it.what_happens,
    who_is_affected: it.who_is_affected,
    background_link: it.background_link,
    incident_title: it.incident_title,
    incident_story: it.incident_story,
    view: it.view,
    signals: it.signals.slice(0, 8),
    affected_nodes: it.affected_nodes.filter((a) => nodeIds.has(a)),
  };
}

// 同じ種類の問題を先にして、前の人のメモを5件まで
function relatedLessons(p: Project): Lesson[] {
  const rules = new Set(p.issues.map((i) => i._rule));
  return repo
    .listLessons()
    .filter((l) => l.project_id !== p.id)
    .sort(
      (a, b) =>
        Number(!rules.has(a.rule ?? "")) - Number(!rules.has(b.rule ?? "")),
    )
    .slice(0, 5);
}

export const projectPayload = (p: Project) => ({
  ...p,
  sim_days: SIM_DAYS,
  related_lessons: relatedLessons(p),
});

export const chosenOf = (issue: Issue) =>
  issue.chosen ?? { label: "（不明）", change_summary: "" };

export function saveLesson(p: Project, issue: Issue): void {
  repo.addLesson({
    id: `${p.id}-${issue.id}`,
    project_id: p.id,
    project_title: p.background.title,
    issue_title: issue.title,
    rule: issue._rule ?? null,
    category: issue.category,
    stance: issue.stance ?? "",
    chosen: chosenOf(issue).label,
    reason: issue.decision?.reason ?? "",
    lesson: issue.lesson ?? "",
    created_at: repo.now(),
  });
}

/** 見送りを取り消す。見送った結果として足した出来事も消す */
export function unskip(p: Project, issue: Issue): void {
  if (!issue.skipped) return;
  const esc = p.issues.find((o) => o.escalated_from === issue.id);
  if (esc && (esc.stance || esc.feedback || esc.skipped)) {
    throw new HttpError(
      400,
      `見送った結果として起きた${esc.day}日目の出来事にすでに対応しているため、見送りを取り消せません`,
    );
  }
  p.issues = p.issues.filter((o) => o.escalated_from !== issue.id);
  delete issue.skipped;
  repo.removeLesson(`${p.id}-${issue.id}`);
}
