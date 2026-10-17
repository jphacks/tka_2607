import type {
  Architecture,
  AttackScenariosResult,
  Background,
  CHAT_PHASES,
} from "@tka/shared";
import {
  backgroundText,
  type Evidence,
  evidenceText,
  type IssueView,
  incidentText,
  RULES,
  tag,
} from "./common";

type ChatPhase = (typeof CHAT_PHASES)[number];

export type ChatTurn = {
  role: "user" | "senior" | "stakeholder" | "system";
  name?: string;
  text: string;
};

const HISTORY_LIMIT = 16;

const CHAT_RULES = `- 1人の発言は1〜3文。
- 先輩は質問を1回に1つだけする。
- 関係者の name は「B社 サポート担当」「チームリーダー」のように役割で書く。実在の人名は使わない。
- 若手が間違った読み方をしていたら、否定せず、根拠のどこを見ればいいかがわかる質問をする。合っていたら、短く受け止めて次に進む。
- コードを指すときは「app.py の58行目」のようにファイル名と行番号で言う。F1 のような内部の id は本人に見えていないので使わない。`;

const EXAMPLES = `先輩の問いかけの例:
- 良い: 「ログの2行目、何て書いてある？」「app.py の58行目、利用者の入力はどこに入ってる？」「この連絡、B社はいつから困ってそう？」
- 悪い（答えを言っている）: 「これはSQLインジェクションだね。プレースホルダにするのが正解だよ」
- 悪い（質問が複数）: 「原因は何で、誰に影響して、どう直す？」`;

function archText(arch: Architecture): string {
  const label = new Map(arch.nodes.map((n) => [n.id, n.label]));
  const name = (id: string) => label.get(id) ?? id;
  return (
    arch.edges
      .map((e) => `- ${name(e.from)} → ${name(e.to)}: ${e.label}`)
      .join("\n") || "（構成図なし）"
  );
}

// 出来事ごとに変わらない部分。同じ引数なら同じ文字列になる (キャッシュのため、会話履歴は入れない)
export function chatSystem(a: {
  bg: Background;
  issue: IssueView;
  evidence: Evidence[];
  arch: Architecture;
  attack?: AttackScenariosResult["scenarios"];
  fix?: { summary: string; chosen_summary: string };
}): string {
  const parts = [
    `あなたは、若手エンジニアが運用で起きた問題に対応する練習の相手役です。会話の中で、次の2種類の人物を演じます。

- 先輩（role: senior, name: "先輩"）: 同じチームの先輩エンジニア。くだけた口調で短く話す。若手が自分で根拠（ログ・コード・構成図）を見て考え、自分で決められるように問いかける。
- 関係者（role: stakeholder）: 背景に出てくる取引先の担当者・上司・社内の担当など。現場らしい問い合わせ・催促・制約（契約、締め切り、人手）を持ち込む。数回のやり取りに1回くらい、自然なときだけ出てくる。`,
    tag("rules", RULES),
    tag("chat_rules", CHAT_RULES),
    tag("examples", EXAMPLES),
    "incident・logs・architecture・evidence・fix は若手本人も画面で見ている。cause と attack_paths は先輩だけが知っていて、本人がたどり着くまで言わない。",
    tag("background", backgroundText(a.bg)),
    tag("incident", incidentText(a.issue)),
    tag("logs", JSON.stringify(a.issue.signals)),
    tag("architecture", archText(a.arch)),
    tag("evidence", evidenceText(a.evidence)),
    tag(
      "cause",
      `${a.issue.title}\n${a.issue.what_happens}\n影響を受ける人: ${a.issue.who_is_affected}`,
    ),
  ];
  if (a.attack?.length) {
    parts.push(
      tag(
        "attack_paths",
        `この弱点を悪用されたときの筋道。手順は話さない。若手が影響の大きさを考えるときの問いかけに使ってよい。\n${JSON.stringify(
          a.attack.map(({ title, target, detectable_signs }) => ({
            title,
            target,
            detectable_signs,
          })),
        )}`,
      ),
    );
  }
  if (a.fix) {
    parts.push(
      tag("fix", `${a.fix.summary}\n決めた方針: ${a.fix.chosen_summary}`),
    );
  }
  return parts.join("\n\n");
}

const PHASE_GUIDE: Record<ChatPhase, string> = {
  investigate: `「何が起きているか・なぜ起きたか」を若手が自分でつかむ段階。
- ログ・コード・構成図のどこに根拠があるかを考えさせる。原因の名前（例: SQLインジェクション）を先に言わない。
- 若手が原因と影響（誰に何が起きるか）をおおむね言えたら phase を "decide" にして、「じゃあ、どうする？」に進む。`,
  decide: `「どう対応するか」を若手が自分で決める段階。
- すぐ止めること・根本の直し方・関係者への連絡など、何をどの順でやるかを考えさせる。
- 背景（契約・取引先・チームの体制・今後の予定）に結びつけて、見落としている点を1つずつ問いかける。関係者が制約を持ち込んでもよい。
- 若手が「何を・どう変えるか」を具体的に言えたら phase を "ready" にする。plan は若手が言った直し方を1〜2文でまとめる（本人が言っていないことは足さない）。reason は若手が挙げた理由を短くまとめる。先輩の発言は「その方針で直してみようか。下の確認を押せば反映するよ」のように、評価せずに確認を促す。`,
  ready: `方針は決まっていて、若手が確認ボタンを押すのを待っている段階。
- 方針について聞かれたら短く答え、確認を促す。phase は "ready" のまま。`,
  reflect: `修正はもう反映されている。振り返りの段階。
- 修正のあとに残ること・入れたあとの運用・関係者への伝え方について、1回に1つ問いかける。
- 1〜3往復したら、「次にアプリを作るとき、最初から気をつけたいことは？」と聞く。
- 若手がそれに答えたら、その言葉をほぼそのまま lesson にして phase を "done" にし、先輩が一言でしめる。
- 聞く前に若手が自分から「次は〜する」「〜を決まりにする」と言った場合も、その言葉を lesson にして "done" にしてよい。同じ質問を繰り返さない。
- 振り返りでの若手の発言が4回を超えたら、次の発言で締めに向かう。`,
  done: `振り返りは終わっている。若手が話しかけてきたら短く答える。phase は "done" のまま。`,
};

const HINT = `若手が「ヒント」を押した。先輩として、考える手がかりを2〜3個、短く挙げる（例: 見るべきログの行、考える観点、取りうる方向性の種類）。最後に「どれから考える？」のように本人に返す。`;

function historyText(history: ChatTurn[]): string {
  // shortcut: 古い履歴は捨てる(要約なし), 長い会話で文脈が欠けたら要約を足す
  return history
    .slice(-HISTORY_LIMIT)
    .map((m) => {
      const who =
        m.role === "user"
          ? "若手（本人）"
          : (m.name ?? (m.role === "senior" ? "先輩" : "システム"));
      return `${who}: ${m.text}`;
    })
    .join("\n");
}

// history は最後の発言まで入れて渡す。毎回変わる部分だけ (固定の文脈は chatSystem)
export function chatPrompt(a: {
  history: ChatTurn[];
  phase: ChatPhase;
  hint?: boolean;
}): string {
  return [
    "会話の続きを作ってください。",
    tag("history", historyText(a.history)),
    tag("phase", `いまの段階: ${a.phase}\n${PHASE_GUIDE[a.phase]}`),
    ...(a.hint ? [tag("hint", HINT)] : []),
    tag(
      "output",
      `- messages: ふつうは先輩1件。関係者が割り込むときは関係者→先輩の順。
- phase: 会話のあとの段階。戻さない。
- plan と reason は phase を "ready" にするときだけ、lesson は "done" にするときだけ書く。それ以外のターンでは出さない。`,
    ),
  ].join("\n\n");
}
