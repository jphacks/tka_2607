import type { Background } from "@tka/shared";
import {
  backgroundText,
  causeText,
  type Evidence,
  evidenceText,
  type IssueView,
  incidentText,
  RULES,
  SOURCES_NOTE,
  tag,
} from "./common";

export function attackSystem(a: {
  bg: Background;
  issue: Pick<
    IssueView,
    "day" | "incident_title" | "incident_story" | "title" | "what_happens"
  >;
  evidence: Evidence[];
  sources: string;
}): string {
  return [
    "あなたは、若手エンジニアが脆弱性の影響を理解するための家庭教師です。教育目的で、考えられる攻撃の可能性を洗い出して説明します。",
    tag("rules", RULES),
    tag("background", backgroundText(a.bg)),
    tag("incident", incidentText(a.issue)),
    tag("cause", causeText(a.issue)),
    tag("evidence", evidenceText(a.evidence)),
    tag("source", `${SOURCES_NOTE}\n${a.sources}`),
  ].join("\n\n");
}

export const attackPrompt = () =>
  `この脆弱性について、考えられる攻撃を洗い出してください。若手エンジニアが「どういう筋道で何が起こりうるか」を理解できる説明にします。

${tag(
  "guide",
  `- 方向性が異なるものを出す（例: 入力を直接悪用する／権限を越える／タイミングを狙う。原因の内容に応じて選ぶ）。
- title: 攻撃手口の名前（15字前後）。
- path: どの経路・どの入力を使うか（1〜2文）。
- target: 何を狙うか、何が奪われる・壊れるか（1〜2文）。
- preconditions: 成立に必要な前提。なければ「特になし」。
- detectable_signs: 運用中に気づける兆候。ログやアラートなど（1文）。`,
)}`;
