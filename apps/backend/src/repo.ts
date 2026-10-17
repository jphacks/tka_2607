import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "./db";
import { issues, lessons, messages, projects } from "./db/schema";
import type { ChatMessage, Lesson, Project, ProjectSummary } from "./types";

export const newId = (): string =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 10);

// UTC・秒精度 (例 2026-10-17T12:00:00Z)。文字列のまま時系列に並べられる
export const now = (): string =>
  new Date().toISOString().replace(/\.\d+Z$/, "Z");

export function getProject(pid: string): Project | undefined {
  const row = db.select().from(projects).where(eq(projects.id, pid)).get();
  if (!row) return undefined;

  const chats = new Map<string, ChatMessage[]>();
  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.projectId, pid))
    .orderBy(asc(messages.id))
    .all();
  for (const m of msgs) {
    const msg: ChatMessage = { id: m.id, role: m.role, text: m.text, at: m.at };
    if (m.name !== null) msg.name = m.name;
    if (m.kind !== null) msg.kind = m.kind;
    const list = chats.get(m.issueId);
    if (list) list.push(msg);
    else chats.set(m.issueId, [msg]);
  }

  const issueRows = db
    .select()
    .from(issues)
    .where(eq(issues.projectId, pid))
    .orderBy(asc(issues.day), sql`rowid`)
    .all();

  return {
    id: row.id,
    created_at: row.createdAt,
    background: row.background,
    source: row.source,
    findings: row.findings,
    features: row.features,
    issues: issueRows.map((r) => ({
      id: r.id,
      day: r.day,
      ...(r.phase ? { phase: r.phase } : {}),
      chat: chats.get(r.id) ?? [],
      ...r.data,
    })),
    architecture: row.architecture,
    flows: row.flows,
    dismissed: row.dismissed,
    uncovered_features: row.uncoveredFeatures,
    assumed_users: row.assumedUsers,
    sim_day: row.simDay,
    analyzed_by: row.analyzedBy,
  };
}

/**
 * 保存する。chat は id を持たない発言だけ INSERT し、id を振り戻す (既存の発言は触らない)。
 * 消えた issue は、その発言ごと消す。
 */
export function saveProject(p: Project): void {
  const fresh: [ChatMessage, number][] = [];
  db.transaction((tx) => {
    const { id, ...rest } = {
      id: p.id,
      createdAt: p.created_at,
      background: p.background,
      source: p.source,
      findings: p.findings,
      features: p.features,
      architecture: p.architecture,
      flows: p.flows,
      dismissed: p.dismissed,
      uncoveredFeatures: p.uncovered_features,
      assumedUsers: p.assumed_users,
      simDay: p.sim_day,
      analyzedBy: p.analyzed_by,
    };
    tx.insert(projects)
      .values({ id, ...rest })
      .onConflictDoUpdate({ target: projects.id, set: rest })
      .run();

    const ids = p.issues.map((i) => i.id);
    tx.delete(issues)
      .where(
        ids.length
          ? and(eq(issues.projectId, p.id), notInArray(issues.id, ids))
          : eq(issues.projectId, p.id),
      )
      .run();
    tx.delete(messages)
      .where(
        ids.length
          ? and(eq(messages.projectId, p.id), notInArray(messages.issueId, ids))
          : eq(messages.projectId, p.id),
      )
      .run();

    for (const issue of p.issues) {
      const { id: iid, day, phase, chat, ...data } = issue;
      tx.insert(issues)
        .values({ projectId: p.id, id: iid, day, phase: phase ?? null, data })
        .onConflictDoUpdate({
          target: [issues.projectId, issues.id],
          set: { day, phase: phase ?? null, data },
        })
        .run();
      for (const m of chat) {
        if (m.id != null) continue;
        const row = tx
          .insert(messages)
          .values({
            projectId: p.id,
            issueId: iid,
            role: m.role,
            name: m.name ?? null,
            kind: m.kind ?? null,
            text: m.text,
            at: m.at ?? now(),
          })
          .returning({ id: messages.id, at: messages.at })
          .get();
        m.at = row.at;
        fresh.push([m, row.id]);
      }
    }
  });
  // トランザクションが成功してから振り戻す (失敗したら id なしのまま再試行できる)
  for (const [m, id] of fresh) m.id = id;
}

export function listProjects(): ProjectSummary[] {
  const rows = db
    .select()
    .from(projects)
    .orderBy(desc(projects.createdAt))
    .all();
  const all = db
    .select({ projectId: issues.projectId, data: issues.data })
    .from(issues)
    .all();
  return rows.map((r) => {
    const mine = all.filter((i) => i.projectId === r.id);
    return {
      id: r.id,
      title: r.background.title,
      created_at: r.createdAt,
      issues: mine.length,
      decided: mine.filter((i) => i.data.feedback).length,
    };
  });
}

export function listLessons(): Lesson[] {
  return db
    .select()
    .from(lessons)
    .orderBy(desc(lessons.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      project_id: r.projectId,
      project_title: r.projectTitle,
      issue_title: r.issueTitle,
      rule: r.rule,
      category: r.category,
      stance: r.stance,
      chosen: r.chosen,
      reason: r.reason,
      lesson: r.lesson,
      created_at: r.createdAt,
    }));
}

/** 同じ id があれば置き換える */
export function addLesson(l: Lesson): void {
  const { id, ...rest } = {
    id: l.id,
    projectId: l.project_id,
    projectTitle: l.project_title,
    issueTitle: l.issue_title,
    rule: l.rule,
    category: l.category,
    stance: l.stance,
    chosen: l.chosen,
    reason: l.reason,
    lesson: l.lesson,
    createdAt: l.created_at,
  };
  db.insert(lessons)
    .values({ id, ...rest })
    .onConflictDoUpdate({ target: lessons.id, set: rest })
    .run();
}

export function removeLesson(id: string): void {
  db.delete(lessons).where(eq(lessons.id, id)).run();
}
