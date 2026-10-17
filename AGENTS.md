# AGENTS.md

コーディングエージェントと開発者向けの、このリポジトリの作業ルール。

## 構成（Bun workspaces + Turborepo）

| パス | 内容 |
|---|---|
| `apps/frontend` | TanStack Start（SPA モード）+ React 19 + Tailwind v4 + Starwind UI |
| `apps/backend` | Hono + Drizzle ORM（`bun:sqlite`） |
| `packages/shared` | zod スキーマ。フロント・バックで共有する |

- パッケージマネージャーとランタイムは Bun。pnpm / npm / yarn は使わない。
- パッケージ名は `@tka/frontend`、`@tka/backend`、`@tka/shared`。

## コマンド

```sh
bun install
bun run dev          # frontend :3000 / backend :3001
bun run build
bun run typecheck
bun run test
bun run check        # Biome の検査のみ
bun run format       # Biome の自動修正
```

変更後は `bun run check`、`bun run typecheck`、`bun run test` が通ることを確認する。

## lint / format

- lint と format は両方 Biome（`biome.json`）。インデントはスペース2つ（タブ禁止）、引用符はダブルクォート。
- `bun lint` / `bun fmt` は Bun の stable（1.4.3）にまだ無いため使わない。
- VS Code は `.vscode/settings.json` で保存時に Biome の format・自動修正・import 整理が走り、インデントもスペース2に固定される。拡張機能 `biomejs.biome` が必要。
- 対象外: `routeTree.gen.ts`、`components/starwind/`、`.vscode/`。

## 設計ルール

- スキーマ（API の入出力など）は `packages/shared` に zod で定義し、フロント・バックの両方から import する。
- Drizzle のテーブル定義は `apps/backend/src/db/schema.ts` に閉じ込め、フロントとは共有しない。
- バックエンドのルートは `apps/backend/src/app.ts` でメソッドチェーンで繋ぐ。`AppType` を経由して、フロントの `hc<AppType>`（`apps/frontend/src/lib/api.ts`）に型が渡る。
- バックエンドは `127.0.0.1` のみで待ち受ける（ローカル専用ツール）。外部に公開しない。
- API のパスは `/api` 配下。開発時は Vite の proxy（`apps/frontend/vite.config.ts`）でバックエンドへ流す。
- 秘密情報は環境変数で渡し、コードに書かない。`.env` はコミットしない（`.env.example` のみ）。

## フロントエンド

- TanStack Start は SPA モード（`spa: { enabled: true }`）。SSR は使わない。ビルド結果は `apps/frontend/dist/client/_shell.html`。
- ルートは `apps/frontend/src/routes/` のファイルベース。`src/routeTree.gen.ts` は生成物だがコミットする（型チェックに必要）。`bun run typecheck` が `tsr generate` を先に実行する。
- UI は Starwind UI。コンポーネントは `apps/frontend/src/components/starwind/` にコピーされる（CLI で追加）。
- パスエイリアスは `#/*` と `@/*`（どちらも `src/*`）。

### Starwind コンポーネントを追加する

Starwind の CLI は依存の追加に `npm install` を呼ぶため、`workspace:*` を使うこのリポジトリでは失敗する。`npm install` を `bun add` に置き換えるラッパーを PATH の先頭に置いて実行する。

```sh
mkdir -p /tmp/npm-shim && cat > /tmp/npm-shim/npm <<'SH'
#!/bin/sh
if [ "$1" = "install" ] || [ "$1" = "i" ]; then shift; [ "$1" = "--" ] && shift; exec bun add "$@"; fi
exec /opt/homebrew/bin/npm "$@"
SH
chmod +x /tmp/npm-shim/npm

cd apps/frontend
PATH=/tmp/npm-shim:$PATH bunx --bun starwind@latest add button -y
```

## バックエンド

- DB は SQLite。ファイルは `DATABASE_URL`（既定 `<DATA_DIR>/app.db`、つまり `data/app.db`）。起動時にマイグレーション（`apps/backend/drizzle`）を自動で流す。`*.db` はコミットしない。
- マイグレーション: `bun run db:generate` → `bun run db:migrate`（`apps/backend` で実行）。
- テストは `bun test`（`apps/backend/test/` 配下。`src/` の構成を写す。環境変数は `test/setup.ts` で固定）。`bunfig.toml` の preload（`src/test-setup.ts`）が `DATABASE_URL=:memory:`・一時の `DATA_DIR`・`TARGET_DIR=samples/a_company_api` を設定する。AI は `setAI` で偽物に差し替え、実際の `claude` は呼ばない。
- 検査対象は `TARGET_DIR`（既定はこのリポジトリの親フォルダ）。登録時に `DATA_DIR/projects/<id>/src` へスナップショットし、修正は `current/` にだけ入れる（元のファイルは変えない）。
- デモ用の題材は `samples/`。`TARGET_DIR=./samples/a_company_api bun run dev` で検査対象にできる。
