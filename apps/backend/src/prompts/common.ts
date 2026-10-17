import type { Background, Signal } from "@tka/shared";
import type { Finding } from "../scanner";

export const tag = (name: string, body: string) =>
  `<${name}>\n${body}\n</${name}>`;

const LABELS: [keyof Background, string][] = [
  ["title", "アプリ名"],
  ["stakeholders", "関係者"],
  ["data_flow", "データの流れ"],
  ["data_types", "扱うデータ"],
  ["constraints", "契約・制約"],
  ["team", "チームの体制"],
  ["notes", "その他"],
];

export const backgroundText = (bg: Background) =>
  LABELS.map(([k, label]) => `- ${label}: ${bg[k] || "（未記入）"}`).join("\n");

// 「答えを言わない」「推測で埋めない」などの共通ルールはここだけに書く
export const RULES = `- 平易な日本語で短く書く。専門用語には一言で説明を添える。
- 事実として言えることだけを書く。背景・構成ファイル・コードに書かれていないことは推測で埋めず、「背景からはわからない」と書く。
- どの修正案が良いか、どれを選ぶべきかは言わない。優劣・順位・良し悪しの評価もつけない。判断するのは若手エンジニア本人。
- 褒めすぎたり、大げさな言い回しをしたりしない。
- 攻撃の手順や、そのまま使える攻撃コード・コマンドは書かない。`;

export const SOURCES_NOTE =
  "大きいファイルは指摘の前後だけ（抜粋）、入りきらないファイルはフォルダごとのファイル名だけ載せている（機能の全体像はここから読み取る）。載っていない中身は推測しない。";

// 呼び出し側 (ルート) が DB の行から組み立てやすいよう、使うプロパティだけの型にする
export type IssueView = {
  day: number;
  incident_title: string;
  incident_story: string;
  signals: Signal[];
  title: string;
  what_happens: string;
  who_is_affected: string;
};

export type Evidence = Pick<Finding, "file" | "line" | "title" | "snippet">;

export const incidentText = (
  i: Pick<IssueView, "day" | "incident_title" | "incident_story">,
) => `運用${i.day}日目\n${i.incident_title}\n${i.incident_story}`;

export const causeText = (i: Pick<IssueView, "title" | "what_happens">) =>
  `${i.title}\n${i.what_happens}`;

// 内部の id (F1 など) は AI に見せない。見せると本人への発言に混ざる
export const evidenceText = (evidence: Evidence[]) =>
  JSON.stringify(
    evidence.map(({ file, line, title, snippet }) => ({
      file,
      line,
      title,
      snippet,
    })),
    null,
    1,
  );
