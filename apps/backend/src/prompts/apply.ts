import { type Architecture, type Background, SIM_DAYS } from "@tka/shared";
import {
  backgroundText,
  causeText,
  type IssueView,
  RULES,
  SOURCES_NOTE,
  tag,
} from "./common";

// sources は行番号つき。選んだ方針・今後の出来事 (毎回変わる) は applyPrompt に入れる
export function applySystem(a: {
  bg: Background;
  sources: string;
  arch: Architecture;
}): string {
  return [
    "あなたは、若手エンジニアが選んだ修正を、実際にアプリへ反映した結果を作る家庭教師です。",
    tag("rules", RULES),
    tag("background", backgroundText(a.bg)),
    tag("architecture", JSON.stringify(a.arch)),
    tag("source", `${SOURCES_NOTE}\n行番号つきで載せている。\n${a.sources}`),
  ].join("\n\n");
}

export function applyPrompt(a: {
  issue: Pick<IssueView, "day" | "incident_title" | "title" | "what_happens">;
  // 選んだ案。effects などの余分なプロパティも含めてそのまま渡す
  chosen: { label: string; change_summary: string };
  reason: string;
  future: { id: string; day: number; title: string; what_happens: string }[];
}): string {
  const future = a.future.map((f) => ({
    issue_id: f.id,
    day: f.day,
    title: f.title,
    what_happens: f.what_happens,
  }));
  return [
    "若手エンジニアが修正案を選びました。この修正を反映した結果を作ってください。",
    tag(
      "incident",
      `運用${a.issue.day}日目\n${a.issue.incident_title}\n原因: ${causeText(a.issue)}`,
    ),
    tag("chosen", `${JSON.stringify(a.chosen)}\n選んだ理由: ${a.reason}`),
    tag(
      "future",
      `この先に起きる予定の出来事（本人にはまだ見えていない）\n${JSON.stringify(future, null, 1)}`,
    ),
    tag(
      "guide",
      `- code_changes: 選んだ案をそのまま実装する。案に書かれていないことはしない。行番号は source の番号。インデントを含めて、そのまま動くコードで、変更は最小限にする。抜粋のファイルは、載っている行の範囲だけを変更する。案がコードの変更でない場合（設定・運用・連絡など）は空の配列。
- architecture_after: 変わらない部分は id を今のまま使う。止めた通信は edges から外す。新しく置いたもの（例: IP制限、秘密情報の保管場所）は node を足す。
- arch_notes: 構成で変わった点を短く。変化がなければ空。
- future: 上の出来事それぞれについて、この修正で prevented / reduced / unchanged / worse のどれかと理由を一文で。修正が直接その原因を取り除く場合だけ prevented にする。
- new_incidents: この修正が原因で新しく起きる出来事があれば1件だけ。案の effects に書かれた副作用（取引先の業務が止まる、手順が増える等）が現実に表に出る場面にする。day は ${Math.min(a.issue.day + 3, SIM_DAYS)}〜${SIM_DAYS} の間。書き方は最初の台本の出来事と同じ。
- reflection: 修正を入れた直後に、先輩エンジニアが若手にかける言葉（2〜3文、くだけた口調）。この修正で何が止まり、何がまだ残るかを事実として一言で伝え、最後に「入れたあとのこと」について考えさせる質問を1つだけする。この先の出来事の中身は明かさない。`,
    ),
  ].join("\n\n");
}
