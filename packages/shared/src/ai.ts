import { z } from "zod";

export const NODE_KINDS = [
  "internal",
  "db",
  "partner",
  "person",
  "external",
] as const;
export const CHAT_PHASES = [
  "investigate",
  "decide",
  "ready",
  "reflect",
  "done",
] as const;
export const SIM_DAYS = 180;

export const backgroundSchema = z.object({
  title: z.string(),
  stakeholders: z.string(),
  data_flow: z.string(),
  data_types: z.string(),
  constraints: z.string(),
  team: z.string(),
  notes: z.string(),
});
export type Background = z.infer<typeof backgroundSchema>;

export const signalSchema = z.object({
  time: z.string(),
  source: z.string(),
  level: z.enum(["info", "warn", "error"]),
  text: z.string(),
});
export type Signal = z.infer<typeof signalSchema>;

export const architectureSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().describe("英小文字と _ のみ"),
      label: z.string(),
      kind: z.enum(NODE_KINDS),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      label: z.string(),
      direction: z.enum(["one", "both"]),
      kind: z
        .enum(["runtime", "ops"])
        .describe("runtime=動作中の通信・データ / ops=人の作業"),
    }),
  ),
});
export type Architecture = z.infer<typeof architectureSchema>;

export const flowSchema = z.object({
  actor: z.string().describe("構成図の node の id"),
  title: z.string(),
  per_day: z.number().min(0),
  feature_ids: z.array(z.string()),
  steps: z.array(
    z.object({ from: z.string(), to: z.string(), label: z.string() }),
  ),
});
export type Flow = z.infer<typeof flowSchema>;

const incidentFields = {
  // 範囲外でも生成を無駄にしないよう、丸めるのはルート側。ここは説明だけ
  day: z.number().int().describe(`公開から何日目か (1〜${SIM_DAYS})`),
  incident_title: z.string(),
  incident_story: z.string(),
  signals: z.array(signalSchema),
  view: z.enum(["code", "infra"]),
  affected_nodes: z.array(z.string()),
  title: z.string(),
  category: z.enum(["脆弱性", "バグ", "運用"]),
  severity: z.enum(["高", "中", "低"]),
  what_happens: z.string(),
  who_is_affected: z.string(),
  background_link: z.string(),
};

export const issueSchema = z.object({
  finding_ids: z.array(z.string()),
  ...incidentFields,
  if_ignored: z.object({
    impact: z.enum(["none", "escalate"]),
    reason: z.string(),
    after_days: z.number().int().describe("0〜90"),
    incident_title: z.string(),
    incident_story: z.string(),
    signals: z.array(signalSchema),
  }),
});
export type Issue = z.infer<typeof issueSchema>;

export const dismissedSchema = z.object({
  finding_id: z.string(),
  reason: z.string(),
});

export const archResultSchema = z.object({ architecture: architectureSchema });
export type ArchResult = z.infer<typeof archResultSchema>;

export const flowsAllResultSchema = z.object({
  flows: z.array(flowSchema),
  assumed_users: z.number().int().min(0),
});
export type FlowsAllResult = z.infer<typeof flowsAllResultSchema>;

export const flowsResultSchema = z.object({ flows: z.array(flowSchema) });
export type FlowsResult = z.infer<typeof flowsResultSchema>;

export const issuesResultSchema = z.object({
  issues: z.array(issueSchema),
  dismissed: z.array(dismissedSchema),
});
export type IssuesResult = z.infer<typeof issuesResultSchema>;

export const applyResultSchema = z.object({
  summary: z.string(),
  code_changes: z.array(
    z.object({
      file: z.string(),
      start_line: z.number().int().min(1),
      end_line: z
        .number()
        .int()
        .min(0)
        .describe(
          "start_line〜end_line を new_lines に置換。追加だけなら start_line - 1",
        ),
      new_lines: z.array(z.string()),
      note: z.string(),
    }),
  ),
  architecture_after: architectureSchema,
  arch_notes: z.array(z.string()),
  future: z.array(
    z.object({
      issue_id: z.string(),
      effect: z.enum(["prevented", "reduced", "unchanged", "worse"]),
      reason: z.string(),
    }),
  ),
  new_incidents: z
    .array(z.object(incidentFields))
    .describe("この修正が原因で新しく起きる出来事。1件まで、なければ空"),
  reflection: z.string(),
});
export type ApplyResult = z.infer<typeof applyResultSchema>;

export const chatResultSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["senior", "stakeholder"]),
        name: z.string(),
        text: z.string(),
      }),
    )
    .min(1)
    .describe("1〜3件"),
  phase: z.enum(CHAT_PHASES),
  plan: z.string().optional().describe('phase が "ready" のときだけ'),
  reason: z.string().optional().describe('phase が "ready" のときだけ'),
  lesson: z.string().optional().describe('phase が "done" になるときだけ'),
});
export type ChatResult = z.infer<typeof chatResultSchema>;

export const attackScenariosResultSchema = z.object({
  scenarios: z
    .array(
      z.object({
        title: z.string(),
        path: z.string(),
        target: z.string(),
        preconditions: z.string(),
        detectable_signs: z.string(),
      }),
    )
    .min(1)
    .describe("方向性の違うものを1〜4件"),
});
export type AttackScenariosResult = z.infer<typeof attackScenariosResultSchema>;
