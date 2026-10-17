import type {
  Architecture,
  Background,
  CHAT_PHASES,
  Flow,
  Signal,
} from "@tka/shared";
import type { Feature, Finding } from "./scanner";

export type ChatPhase = (typeof CHAT_PHASES)[number];

export type ChatMessage = {
  id?: number; // 保存済みなら DB の id。無いものだけ saveProject が INSERT する
  role: "user" | "senior" | "stakeholder" | "event";
  name?: string;
  kind?: "fix" | "hint" | "decided";
  text: string;
  at?: string;
};

export type IfIgnored = {
  impact: "none" | "escalate";
  reason: string;
  after_days: number;
  incident_title: string;
  incident_story: string;
  signals: Signal[];
};

export type Effect = {
  issue_id: string;
  effect: "prevented" | "reduced" | "unchanged" | "worse";
  reason: string;
  day: number;
};

export type DiffRow = {
  type: "hunk" | "ctx" | "del" | "add";
  old?: number | null;
  new?: number | null;
  text: string;
};

export type Fix = {
  summary: string;
  diffs: { file: string; notes: string[]; rows: DiffRow[] }[];
  arch_before: Architecture;
  arch_after: Architecture;
  arch_notes: string[];
  effects: Effect[];
  new_issue_ids: string[];
  before_files: Record<string, string>; // 選び直したときに戻すための元の内容
  by?: string;
};

export type AttackScenario = {
  title: string;
  path: string;
  target: string;
  preconditions: string;
  detectable_signs: string;
};

// issues.data に JSON で入る項目 (id / day / phase / chat 以外)
export type IssueData = {
  title: string;
  category: string;
  severity: "高" | "中" | "低";
  what_happens: string;
  who_is_affected: string;
  background_link: string;
  finding_ids: string[];
  incident_title: string;
  incident_story: string;
  signals: Signal[];
  view: "code" | "infra";
  affected_nodes: string[];
  if_ignored?: IfIgnored;
  stance?: string;
  chosen?: { label: string; change_summary: string };
  // 会話フローでは option_index は常に null
  decision?: {
    option_index: null;
    plan: string;
    reason: string;
    at: string;
  } | null;
  feedback?: {
    consequence: string;
    covered: string[];
    questions: string[];
    stance_gap: string;
  } | null;
  fix?: Fix | null;
  skipped?: {
    reason: string;
    at: string;
    impact: "none" | "escalate";
    impact_reason: string;
    escalation_id?: string;
  };
  hints?: number;
  plan_draft?: { plan: string; reason: string };
  lesson?: string;
  attack_scenarios?: AttackScenario[];
  prevented_by?: string;
  prevented_reason?: string;
  changed_by?: {
    issue_id: string;
    effect: "reduced" | "worse";
    reason: string;
  };
  caused_by?: string;
  escalated_from?: string;
  _rule?: string;
};

export type Issue = {
  id: string;
  day: number;
  phase?: ChatPhase;
  chat: ChatMessage[];
} & IssueData;

export type Lesson = {
  id: string;
  project_id: string;
  project_title: string;
  issue_title: string;
  rule: string | null;
  category: string;
  stance: string;
  chosen: string;
  reason: string;
  lesson: string;
  created_at: string;
};

// sim_days / related_lessons は DB に持たず、ルートが返すときに足す
export type Project = {
  id: string;
  created_at: string;
  background: Background;
  source: string;
  findings: Finding[];
  features: Feature[];
  issues: Issue[];
  architecture: Architecture;
  flows: Flow[];
  dismissed: { finding_id: string; reason: string }[];
  uncovered_features: string[];
  assumed_users: number | null;
  sim_day: number;
  analyzed_by: string | null;
};

export type ProjectSummary = {
  id: string;
  title: string;
  created_at: string;
  issues: number;
  decided: number;
};
