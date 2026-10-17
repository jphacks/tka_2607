import type { Architecture, Background, Flow } from "@tka/shared";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import type { Feature, Finding } from "../scanner";
import type { ChatMessage, ChatPhase, IssueData } from "../types";

// テーブル定義はここに閉じ込める (サーバー内に置き、フロントとは共有しない)
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  background: text("background", { mode: "json" })
    .$type<Background>()
    .notNull(),
  source: text("source").notNull(),
  findings: text("findings", { mode: "json" }).$type<Finding[]>().notNull(),
  features: text("features", { mode: "json" }).$type<Feature[]>().notNull(),
  architecture: text("architecture", { mode: "json" })
    .$type<Architecture>()
    .notNull(),
  flows: text("flows", { mode: "json" }).$type<Flow[]>().notNull(),
  dismissed: text("dismissed", { mode: "json" })
    .$type<{ finding_id: string; reason: string }[]>()
    .notNull(),
  uncoveredFeatures: text("uncovered_features", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  assumedUsers: integer("assumed_users"),
  simDay: integer("sim_day").notNull().default(0),
  analyzedBy: text("analyzed_by"),
});

export const issues = sqliteTable(
  "issues",
  {
    projectId: text("project_id").notNull(),
    id: text("id").notNull(),
    day: integer("day").notNull(),
    phase: text("phase").$type<ChatPhase>(),
    data: text("data", { mode: "json" }).$type<IssueData>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.id] })],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    issueId: text("issue_id").notNull(),
    role: text("role").$type<ChatMessage["role"]>().notNull(),
    name: text("name"),
    kind: text("kind").$type<NonNullable<ChatMessage["kind"]>>(),
    text: text("text").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("messages_issue_idx").on(t.projectId, t.issueId)],
);

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  projectTitle: text("project_title").notNull(),
  issueTitle: text("issue_title").notNull(),
  rule: text("rule"),
  category: text("category").notNull(),
  stance: text("stance").notNull(),
  chosen: text("chosen").notNull(),
  reason: text("reason").notNull(),
  lesson: text("lesson").notNull(),
  createdAt: text("created_at").notNull(),
});
