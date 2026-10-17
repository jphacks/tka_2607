# サンプル（プロダクト名）

[![IMAGE ALT TEXT HERE](https://jphacks.com/wp-content/uploads/2026/07/IMG_5316.png)](https://www.youtube.com/watch?v=piaNsc6ilBI)

## 製品概要
### 背景(製品開発のきっかけ、課題等）
### 製品説明（具体的な製品の説明）
### 特長
#### 1. 特長1
#### 2. 特長2
#### 3. 特長3

### 解決出来ること
### 今後の展望
### 注力したこと（こだわり等）
* 
* 

## 開発技術
### 活用した技術
#### API・データ
* 
* 

#### フレームワーク・ライブラリ・モジュール
* フロントエンド: TanStack Start（SPA モード）/ React 19 / Tailwind CSS v4 / Starwind UI
* バックエンド: Hono / Drizzle ORM（SQLite）
* 共通: zod（フロント・バックで共有するスキーマ）/ Bun / Turborepo / Biome

#### デバイス
* 
* 

### 独自技術
#### ハッカソンで開発した独自機能・技術
* 独自で開発したものの内容をこちらに記載してください
* 特に力を入れた部分をファイルリンク、またはcommit_idを記載してください。

## 開発者向けセットアップ
### 構成
```
apps/frontend    TanStack Start (SPA) + React + Starwind UI   http://localhost:3000
apps/backend     Hono + Drizzle (bun:sqlite)                  http://127.0.0.1:3001
packages/shared  zod スキーマ（フロント・バック共有）
```

### 必要なもの
* [Bun](https://bun.com/) 1.4 以上（Node.js / pnpm は不要）

### コマンド
```sh
bun install          # 依存関係のインストール
bun run dev          # frontend と backend を同時に起動
bun run build        # ビルド
bun run typecheck    # 型チェック
bun run test         # テスト
bun run check        # lint と format の検査（Biome）
bun run format       # lint と format の自動修正（Biome）
```

* 開発時、フロントの `/api` はバックエンドへプロキシされる。
* バックエンドの環境変数は `apps/backend/.env.example` を参照（`PORT`、`DATABASE_URL`）。
* 検査対象は環境変数 `TARGET_DIR`（既定はこのリポジトリの親フォルダ）。検査対象のプロダクトの中にこのリポジトリを置いて使う。
* デモ用の題材が `samples/` にある。`TARGET_DIR=./samples/a_company_api bun run dev` で試せる。
* 修正は検査対象のコピー（`data/projects/<id>/current`）にだけ入り、元のファイルは変わらない。
* VS Code では拡張機能「Biome」（`biomejs.biome`）を入れると、保存時に lint と format が自動で走る。

詳しい開発ルールは [AGENTS.md](./AGENTS.md) を参照。
