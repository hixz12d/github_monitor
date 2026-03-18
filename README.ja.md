# GitHub Subscribe Bot

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)

GitHub リポジトリの Release を購読し、AI で自動的に変更履歴を翻訳・分類して Telegram チャンネル/グループに配信します。

## 機能

- GitHub Release の定期ポーリング（ETag キャッシュで API クォータを節約）
- 実行状態を永続化して重複通知を防止（`data/state.json`、GitHub Actions ではキャッシュ）
- Tag ベースの購読モード（Release のないリポジトリに対応）
- AI による自動翻訳 + 分類（新機能、修正、最適化、リファクタリング、ドキュメント、その他）
- 複数の AI プロバイダー対応：OpenAI / Google Gemini / Anthropic Claude
- 翻訳先言語を設定可能（デフォルト：英語）
- Telegram メッセージの自動分割（4096 文字超過時）
- 送信失敗時の自動リトライ（最大 3 回）
- Telegram コマンドで購読を管理（デーモンモード、任意）
- 任意 `/status` コマンド：ローカル Docker Compose と GitHub の最新版を比較（Docker ソケットが必要）
- Docker Compose または GitHub Actions でデプロイ（サーバー不要）

## クイックスタート

### 前提条件

1. **Telegram Bot** — [@BotFather](https://t.me/BotFather) で Bot を作成し Token を取得
2. **Telegram Chat ID** — チャンネルユーザー名（例：`@my_channel`）またはグループ/ユーザーの数値 ID
3. **AI API Key** — 対応する AI プロバイダーの API Key
4. **GitHub Token**（任意）— [Personal Access Token を作成](https://github.com/settings/tokens)。API レート制限を引き上げます。多数のリポジトリを購読する場合や高頻度ポーリング時に推奨

### 方法 1：GitHub Actions（推奨）

サーバー不要。Fork して設定するだけ：

1. このリポジトリを Fork（または Template として利用 / ベースにして自分のリポジトリを作成）
2. **Settings → Secrets and variables → Actions** に移動
3. **Secrets**（暗号化）を追加：
   - `TELEGRAM_BOT_TOKEN` — Telegram Bot Token
   - `TELEGRAM_CHAT_ID` — 配信先チャンネル/グループ ID
   - `AI_API_KEY` — AI サービス API Key
4. **Variables**（平文）を追加：
   - `SUBSCRIBE_REPOS` — カンマ区切りのリポジトリ、例：`vuejs/core,nodejs/node`
   - `AI_PROVIDER` —（任意）AI プロバイダー、デフォルト `openai-completions`
   - `AI_MODEL` —（任意）モデル名、デフォルト `gpt-4o-mini`
   - `AI_BASE_URL` —（任意）カスタム API URL（プロキシ/セルフホスト）
   - `TIMEZONE` —（任意）IANA タイムゾーン、デフォルト `Asia/Shanghai`
   - `TARGET_LANG` —（任意）翻訳対象言語、デフォルト `English`
5. **Actions** タブ → ワークフローを有効化
6. 必要に応じて **Release Check** を手動トリガーしてテスト

ポーリング間隔を変更したい場合は、`.github/workflows/check.yml` の schedule cron を編集してください。

> GitHub Actions は内蔵 `GITHUB_TOKEN` を自動提供（1000 リクエスト/時）。追加設定は不要です。

### 方法 2：Docker Compose

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>

cp .env.example .env
# .env を編集して設定を入力（下記参照）

docker compose up -d --build

# ログを確認
docker compose logs -f

# 停止
docker compose down
```

## 設定

すべての設定は `.env` ファイルの環境変数で行います：

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `SUBSCRIBE_REPOS` | ⚠️ | — | カンマ区切りの購読リポジトリ（例：`vuejs/core,nodejs/node`）。購読ファイルがない場合は必須 |
| `SUBSCRIPTIONS_PATH` | ❌ | `data/subscriptions.json` | 購読ファイルのパス（ファイルが存在する場合は `SUBSCRIBE_REPOS` より優先） |
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | ✅ | — | 配信先チャンネル/グループ/ユーザー ID |
| `TELEGRAM_ADMIN_CHAT_ID` | ❌ | `TELEGRAM_CHAT_ID` | Telegram コマンドを実行できる admin chat（数値 ID または `@username`） |
| `TELEGRAM_COMMANDS` | ❌ | `1` | デーモンモードの Telegram コマンドループ（`0`/`false` で無効化） |
| `AI_API_KEY` | ✅ | — | AI サービス API Key |
| `AI_MODEL` | ❌ | `gpt-4o-mini` | モデル名 |
| `AI_PROVIDER` | ❌ | `openai-completions` | AI プロバイダー（下記参照） |
| `AI_BASE_URL` | ❌ | SDK デフォルト | カスタム API URL（プロキシ/セルフホスト） |
| `GITHUB_TOKEN` | ❌ | — | GitHub PAT（5000 リクエスト/時 vs 60 リクエスト/時） |
| `TIMEZONE` | ❌ | `Asia/Shanghai` | IANA タイムゾーン（cron とメッセージ時刻に使用） |
| `CRON` | ❌ | — | Cron 式（6 フィールド、秒を含む）。Docker/ローカルモードで必須 |
| `TARGET_LANG` | ❌ | `English` | AI 翻訳の対象言語 |
| `DOCKER_SOCKET_PATH` | ❌ | `/var/run/docker.sock` | Docker Engine ソケットのパス（`/status` のみ使用） |

> 購読の設定は次のどちらか 1 つで行います：
> - `SUBSCRIBE_REPOS`、または
> - `data/subscriptions.json`（または `SUBSCRIPTIONS_PATH`）。ファイルが存在する場合はファイル設定が優先されます。

### `TELEGRAM_CHAT_ID` の取得方法

- **公開チャンネル**で username がある場合は、`@channel_username` をそのまま指定できます。
- **非公開チャンネル / グループ**の場合は、数値の chat id（`-100` で始まることが多い）が必要になります。

取得方法は 2 つあります：

1. 少なくとも `TELEGRAM_BOT_TOKEN` を設定して bot を **onboarding モード** で起動します。
2. Bot との private chat で `/start` を送るか、group/channel に追加して更新を 1 回発生させます。
3. 発見した chat id は次のいずれかで確認できます：
   - `/start` の返信
   - `data/discovered_chats.json`
   - コンテナログの `[TG] Discovered chat ...`
4. すぐ使える `.env` 行が必要なら、現在の chat で `/bind` を送信します。

簡単な方法（PowerShell）：

1. Bot を対象のグループ/チャンネルに追加して、メッセージを 1 回送信します。
2. 次を実行します：

```powershell
$token = '<YOUR_TELEGRAM_BOT_TOKEN>'
Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates" | ConvertTo-Json -Depth 20
```

出力の `result[].message.chat.id`（または `result[].channel_post.chat.id`）を見つけて、`TELEGRAM_CHAT_ID` に設定してください。

> `CRON`、`AI_API_KEY`、`TELEGRAM_CHAT_ID` のいずれかが不足している場合、デーモンは即終了せず **command/onboarding モード** にフォールバックします。このモードでは Release 監視は無効ですが、Telegram コマンドポーリングは動作するため、`/start` と `/bind` で初期設定を進められます。

> `TARGET_LANG` は AI 翻訳出力とカテゴリラベル（例：✨ 新機能）の両方を制御します。`English`、`Chinese`、`Japanese`のラベル翻訳が組み込まれています。その他の言語では英語ラベルと AI 翻訳コンテンツが使用されます。
>
> `TIMEZONE` 未設定の場合は `TZ` にフォールバックし、両方未設定の場合は `Asia/Shanghai` がデフォルトになります。
> `TIMEZONE` は有効な IANA タイムゾーン（例：`Asia/Shanghai`、`UTC`）である必要があります。`UTC+8` のような形式は無効で、起動時にエラーになります。

### AI プロバイダー

`AI_PROVIDER` の対応値：

| 値 | 説明 | AI_MODEL 例 |
|----|------|-------------|
| `openai-completions` | OpenAI Chat Completions（デフォルト）、すべての OpenAI プロキシと互換 | `gpt-4o-mini` |
| `openai-responses` | OpenAI Responses API | `gpt-4o-mini` |
| `google` | Google Gemini | `gemini-2.0-flash` |
| `anthropic` | Anthropic Claude | `claude-sonnet-4-20250514` |

**サードパーティプロキシの使用**：`AI_PROVIDER=openai-completions` に設定し、`AI_BASE_URL` をプロキシに向けてください。

`.env` の例：

```env
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx  # 任意、多数リポジトリ時に推奨
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=@my_channel
AI_PROVIDER=openai-completions
AI_API_KEY=sk-xxxxxxxxxxxx
AI_MODEL=gpt-4o-mini
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
TARGET_LANG=Japanese
SUBSCRIBE_REPOS=vuejs/core,nodejs/node
```

### スケジューリング（Cron）

Docker/ローカルモードでは、`CRON` で内部スケジューリングを行います（`cron` パッケージ使用）：

```env
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
```

意味：毎日 09:00〜23:59、10 分ごとにチェック（夜間は通知なし）。

例：
- 平日の日中 10 分ごと：`0 */10 9-23 * * 1-5`
- 毎日 08:30：`0 30 8 * * *`

> `CRON` は 6 フィールド形式（秒 分 時 日 月 曜日）を使用します。例：`0 */10 9-23 * * *`
> GitHub Actions モードでは、ワークフローの cron トリガーがスケジューリングを処理するため、`CRON` の設定は不要です。

## 購読設定

`SUBSCRIBE_REPOS` 環境変数でカンマ区切りの GitHub リポジトリを設定します（`owner/repo` 形式）：

```env
SUBSCRIBE_REPOS=vuejs/core,nodejs/node,microsoft/vscode
```

各エントリは GitHub URL / SSH URL も受け付けます（内部で `owner/repo` に正規化されます）：

- `https://github.com/owner/repo`
- `git@github.com:owner/repo.git`

> 初回実行の挙動：`data/state.json` が存在しない場合、最新の release/tag を 1 回だけベースラインとして通知し、その後は新規分のみ通知します。

### 購読ファイル（任意）

`data/subscriptions.json` が存在する場合（または `SUBSCRIPTIONS_PATH` がファイルを指す場合）、`SUBSCRIBE_REPOS` より優先されます。

受け付ける形式の例：

```json
[
  "vuejs/core",
  "some-org/lib:tag",
  { "repo": "nodejs/node", "mode": "release" }
]
```

### 購読モード

各リポジトリに `:mode` サフィックスで購読モードを指定できます：

| 形式 | モード | 説明 |
|------|--------|------|
| `owner/repo` | `release` | GitHub Release を購読（デフォルト） |
| `owner/repo:release` | `release` | Release を明示的に購読 |
| `owner/repo:tag` | `tag` | 新しい Git Tag を購読（Release のないリポジトリ向け） |

例：

```env
SUBSCRIBE_REPOS=vuejs/core,some-org/lib:tag,another/tool:release
```

- `vuejs/core` — Release を監視（デフォルト）
- `some-org/lib:tag` — 新しい Git Tag を監視し、Tag 間のコミットから変更履歴を生成
- `another/tool:release` — Release を明示的に監視

**Tag モード**では、Bot は前後の Tag 間のコミット（最大 50 件）を取得し、AI で分類・翻訳して Release 通知と同じ形式で配信します。

GitHub Actions モードでは、リポジトリの Settings で **Variable** として設定します。
Docker/ローカルモードでは、`.env` ファイルに追加します。

変更後にコンテナを再起動：

```bash
docker compose restart
```

## メッセージ形式

Bot が配信する Telegram メッセージの例：

```
vuejs/core

2025-02-19 14:30:00  v3.5.0

✨ 新機能
• useTemplateRef API を追加
• 遅延 Teleport をサポート

🐛 修正
• リアクティブ配列の watch コールバック発火の問題を修正

⚡ 最適化
• 仮想 DOM diff のパフォーマンスを改善
```

AI が英語の Release Notes を設定された対象言語に自動翻訳し、カテゴリ別にグループ化します。

### 複数ユーザーでの利用について

このプロジェクトは基本的に **単一利用（single-tenant）** を想定しています：`TELEGRAM_CHAT_ID` は 1 つで、購読リスト/状態も 1 つです。
不特定多数が使える公開 Bot（ユーザー/グループごとに購読と状態を分離）にする場合は、多租戸（per-chat の購読 + per-chat state + レート制限）を追加実装する必要があります。

このため、`/start` と `/bind` は id の発見と設定ガイドには使えますが、Bot を自動的に完全なマルチユーザー運用へ切り替えたり、chat ごとの購読を自動管理したりはしません。

## ローカル開発

```bash
npm install
cp .env.example .env
# .env にトークンと SUBSCRIBE_REPOS を設定

npm run dev    # 開発モード（ファイル変更時に自動再起動）
npm start      # 直接実行（デーモン、内部 cron スケジューリング）
npm run check  # 単回実行して終了（GitHub Actions 用）
npm run build  # TypeScript コンパイル
```

## プロジェクト構成

```
├── src/
│   ├── index.ts       # エントリーポイント、デーモンと内部 cron
│   ├── action.ts      # 単回実行エントリーポイント（GitHub Actions 用）
│   ├── config.ts      # 環境変数の読み込み
│   ├── subscriptions.ts # 購読の解析と永続化
│   ├── types.ts       # 型定義
│   ├── github.ts      # GitHub API クライアントと状態管理
│   ├── ai.ts          # AI 翻訳と分類
│   ├── formatter.ts   # Telegram メッセージフォーマット
│   ├── telegram.ts    # Telegram メッセージ送信（リトライ付き）
│   ├── telegram_commands.ts # Telegram コマンドループ（/subscribe、/list など）
│   ├── telegram_state.ts # Telegram offset 永続化
│   ├── docker_engine.ts  # Docker Engine API（任意）
│   ├── compose_map.ts    # Compose->repo マッピング（任意）
│   └── logger.ts      # ロガーユーティリティ
├── data/              # ランタイム状態（自動生成）
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](LICENSE)

## クレジット / 由来

本プロジェクトは [nicepkg/github-subscribe-bot](https://github.com/nicepkg/github-subscribe-bot)（MIT License）をベースにしています。
このリポジトリには追加の変更が含まれる場合があり、独自にメンテナンスされています。
