import { type Architecture, type Background, SIM_DAYS } from "@tka/shared";
import type { Feature, Finding } from "../scanner";
import { backgroundText, RULES, SOURCES_NOTE, tag } from "./common";

// 4 回の呼び出し (arch → flows_all ‖ issues → flows補完) で system を完全に同じ文字列にし、キャッシュを効かせる。
// 呼び出しごとに変わるもの (日時・乱数・タスクの指示) はここに入れない
export function analyzeSystem(a: {
  bg: Background;
  sources: string;
  config: string;
}): string {
  return [
    "あなたは、若手エンジニアが運用で起きる問題への判断を練習するための家庭教師です。",
    tag("rules", RULES),
    tag(
      "task",
      `次のアプリは開発が終わり、これから運用に入ります。公開日から${SIM_DAYS}日間の運用をシミュレーションする「台本」を作ります。
機械的なチェックは誤検知を含む候補（findings）を拾います。本当に問題なものが原因で、運用中のある日に問題が表に出てくる、という流れにします。
台本は何回かに分けて作ります。今回どの部分を作るかは、あとの依頼で指定します。`,
    ),
    tag("background", backgroundText(a.bg)),
    tag("config", a.config || "（なし）"),
    tag("source", `${SOURCES_NOTE}\n${a.sources}`),
  ].join("\n\n");
}

const ARCH_GUIDE = `- 背景・構成ファイル・コードから、このアプリに関わる要素をすべて nodes にする（DB、このアプリ、提携先の仕組み、社内の担当者、外部の第三者など）。数は減らさない。書かれていない要素は足さない。
- 常に動くサービス・定期バッチ・データの保存先（DB・キャッシュ・ファイル・バックアップ先）・外部サービスは、1つずつ node にし、まとめない。
- ボリュームやデータの置き場は、使うサービスや DB の node に含めて別の node にしない（バックアップの保存先は別の node にする）。マイグレーション・初期化など起動時に一度だけ動くコンテナは node にしない。
- 省かない: 外からの入口（リバースプロキシ・ロードバランサ等）、外部の認証（OAuth 等）、サービス同士をつなぐ中継役（Pub/Sub・キュー等）、ログ・監視の流れ。
- kind: internal=自社のシステム / db / partner=取引先 / person=人 / external=外部・不特定。
- edges は実際の通信・データの向きで引く。中継役を通してやり取りする場合は、直接つながず中継役を経由させる。
- direction: 片方向にしか流れないなら one、読み書きや問い合わせと応答のように両方向なら both。
- 人の edges は実際の使い方で引く。開発者・運用者のデプロイや設定変更は、自分たちのコードからビルドしているサービス（compose で build: があるもの）にだけ引く。image: だけで動かす既製品や外部サービスには引かない。開発者が動作確認で利用者と同じ経路を使うなら、その edge も引く。
- edges の label は「毎朝6時 前日分を取得」のように短く具体的に。`;

const FLOW_GUIDE = `- actor が人の場合は、その操作をする権限がコード上ある人にする。管理者・オーナー専用の操作を一般の利用者にさせない。権限が読み取れなければ、背景の関係者から無理のない人にする。
- title は「利用者がダッシュボードで活動ランキングを見る」のように、誰が何をするかを一文で。
- steps は、その場面で通る通信を順番に並べる。from→to は構成図の edges にあるもの（direction が both なら逆向きも可）だけを使う。応答（DB から読んだ値が画面に返る等）も逆向きの step として書く。label は step で流れるもの（例:「セッションを確認」「集計結果を返す」）。
- per_day: その流れが1日に起きる回数の目安。背景（利用者の数など）とコード（cron の設定など）から見積もる。毎日1回の定期バッチは 1、週に1回なら 0.14、ほとんど起きない手動作業は 0.01。`;

const part = (label: string, guide: string) =>
  `今回作るのは ${label} だけです。\n\n${tag("guide", guide)}`;

const featuresText = (features: Feature[]) =>
  features.map((f) => `- ${f.id}: ${f.name} (${f.source})`).join("\n") ||
  "（なし）";

export const archPrompt = () =>
  part("システム構成図（architecture）", ARCH_GUIDE);

export function flowsAllPrompt(a: {
  arch: Architecture;
  features: Feature[];
}): string {
  return [
    part(
      "使われ方（flows）と想定利用者数（assumed_users）",
      `${FLOW_GUIDE}
- person の node はそれぞれ1つ以上の flow を持つ。
- アプリの主な機能（コードのモジュール・パッケージ・コマンド・画面など）を、それぞれ1つ以上の flow にする。運用作業（バックアップ・監視など）に偏らせず、利用者が日常的に使う機能を中心にする。数は減らさない。
- 人の操作に加えて、定期実行のバッチなど人以外が起点の流れも入れる（actor はその node）。
- 機能一覧のすべての機能が、どれかの flow の feature_ids に入るようにする。1つの flow が複数機能を含んでよい。
- 背景に利用者数がなければ「利用者30人規模」と仮定して per_day を見積もり、仮定した人数を assumed_users で返す（背景に人数があればその数）。`,
    ),
    tag("architecture", JSON.stringify(a.arch)),
    tag("features", featuresText(a.features)),
  ].join("\n\n");
}

export function issuesPrompt(a: {
  findings: Finding[];
  arch: Architecture;
}): string {
  return [
    part(
      "運用中に起きる出来事（issues）と dismissed",
      `dismissed（問題にしない findings）:
- findings は機械的に拾った候補で、誤検知を含む。ソースと背景を見て、運用で実害につながらないものは issues にせず dismissed に入れる。reason は実害にならない理由を一文で。
- 例: テスト・サンプル・ドキュメント用のダミー値、本番では動かないコード、環境変数から読んだ値を代入しているだけの行、すでに対策されている箇所。
- 迷うものは issues に残す。
- すべての findings を issues か dismissed のどちらかに必ず入れる。

issues（運用中に起きる出来事）:
- 1つの原因につき1件。同じ原因の findings はまとめてよい。finding_ids には根拠にした findings の id を入れる。findings にない問題は足さない。dismissed に入れたものは使わない。
- day は現実に起きそうな順番とタイミングにして、ばらけさせる。day の早い順に並べる。
- incident_title: その日に「観測されること」を一文で（例:「B社サポート窓口から『検索結果がおかしい』と連絡が来た」）。原因の名前（SQLインジェクション等）はここでは書かない。
- incident_story: 2〜3文。気づいた人、時刻、状況を具体的に。
- signals: 3〜6件。アクセスログ・エラーログ・監視アラート・取引先からの連絡など。time は "06:12:03" 形式、source は "api.log" "監視" "B社から" など。ログはそれらしい1行にする。
- view: 原因がコードの書き方なら code、構成・権限・運用体制なら infra。
- affected_nodes: 構成図の node の id だけを使う。
- title: 原因を一文で（20字前後）。what_happens: 原因と、放っておくと運用で何が起きるか（2〜3文）。
- who_is_affected: 背景に出てくる名前を使う。background_link: この問題に関係する背景の情報。なければ空文字。
- severity: 背景をふまえた影響の大きさ。
- if_ignored: 本人がこの出来事を「今回は対応しない」と見送った場合。
  - impact: 被害が広がる・より大きな形で表に出るなら escalate。テスト用ファイル・使われていないコード・影響が社内で小さく閉じるものなど、運用への影響が小さいなら none。reason は理由を一文で。
  - escalate: after_days は 7〜90。incident_title・incident_story・signals は最初より深刻になった場面（書き方は上と同じ。原因の名前は書かない）。
  - none: after_days は 0、incident_title・incident_story は空文字、signals は空の配列。`,
    ),
    tag("findings", JSON.stringify(a.findings, null, 1)),
    tag("architecture", JSON.stringify(a.arch)),
  ].join("\n\n");
}

export function flowsMissingPrompt(a: {
  arch: Architecture;
  missing: Feature[];
}): string {
  return [
    `次の機能が、まだどの flow にも入っていません。これらの機能を使う flow だけを追加してください（すでにある flow は書かない）。\n\n${tag(
      "guide",
      `${FLOW_GUIDE}
- すべての機能が、追加する flow の feature_ids に入るようにする。1つの flow が複数機能を含んでよい。
- 構成図の上でどうしても表現できない機能は、flow を作らず省く。
- 背景に利用者数がなければ「利用者30人規模」と仮定して per_day を見積もる。`,
    )}`,
    tag("architecture", JSON.stringify(a.arch)),
    tag("missing_features", featuresText(a.missing)),
  ].join("\n\n");
}
