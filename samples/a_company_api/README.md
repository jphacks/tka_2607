デモ用: `TARGET_DIR=./samples/a_company_api bun run dev` で検査対象にできる。

# A社 顧客データ提供API（デモ用サンプル）

A社の顧客購買データを、提携先のB社に毎日提供するAPIです。
デモで読み込ませるための題材で、運用で問題になりやすい書き方をわざと含めています。

| エンドポイント | 使う人 | 内容 |
|---|---|---|
| `GET /api/purchases?date=` | B社（毎朝のバッチ） | 前日分の購買データ |
| `GET /api/customers/search?name=` | B社のサポート窓口 | 顧客の検索 |
| `GET /api/export` | A社の社内担当 | 全顧客データの書き出し |
| `DELETE /api/customers/<id>` | 退会処理 | 顧客の削除 |
