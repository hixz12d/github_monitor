# GitHub Subscribe Bot

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)

Subscribe to GitHub repository releases, automatically translate and categorize changelogs via AI, and push to Telegram channels/groups.

## Features

- Scheduled GitHub Release polling (with ETag caching to save API quota)
- Persistent state to avoid duplicate notifications (`data/state.json`, cached in GitHub Actions)
- Tag-based subscription for repos without releases
- AI-powered translation + categorization (Features, Bug Fixes, Performance, Refactoring, Documentation, Other)
- Multiple AI providers: OpenAI / Google Gemini / Anthropic Claude
- Configurable target language for translation (default: English)
- Auto-split Telegram messages (when exceeding 4096 characters)
- Auto-retry on send failure (up to 3 times)
- Manage subscriptions via Telegram commands (daemon mode, optional)
- Optional `/status` command: compare local Docker Compose versions with GitHub (requires Docker socket)
- Deploy via Docker Compose or GitHub Actions (zero server needed)

## Quick Start

### Prerequisites

1. **Telegram Bot** — Create via [@BotFather](https://t.me/BotFather) to get the Bot Token
2. **Telegram Chat ID** — Channel username (e.g. `@my_channel`) or group/user numeric ID
3. **AI API Key** — From any supported AI provider
4. **GitHub Token** (Optional) — [Create a Personal Access Token](https://github.com/settings/tokens) for higher API rate limits. Recommended if you subscribe to many repos or use frequent polling

### Option 1: GitHub Actions (Recommended)

No server required. Fork and configure:

1. Fork this repository (or use it as a template / create your own repo based on it)
2. Go to **Settings → Secrets and variables → Actions**
3. Add **Secrets** (encrypted):
   - `TELEGRAM_BOT_TOKEN` — Your Telegram Bot Token
   - `TELEGRAM_CHAT_ID` — Target channel/group ID
   - `AI_API_KEY` — AI service API Key
4. Add **Variables** (plaintext):
   - `SUBSCRIBE_REPOS` — Comma-separated repos, e.g. `vuejs/core,nodejs/node`
   - `AI_PROVIDER` — (Optional) AI provider, default `openai-completions`
   - `AI_MODEL` — (Optional) Model name, default `gpt-4o-mini`
   - `AI_BASE_URL` — (Optional) Custom API URL for proxy/self-hosted
   - `TIMEZONE` — (Optional) IANA timezone, default `Asia/Shanghai`
   - `TARGET_LANG` — (Optional) Translation target language, default `English`
5. Go to **Actions** tab → Enable workflows
6. Optionally trigger **Release Check** manually to test

To change the polling interval, edit the workflow schedule in `.github/workflows/check.yml`.

> GitHub Actions provides a built-in `GITHUB_TOKEN` automatically (1000 req/hr). No need to configure it separately.

### Option 2: Docker Compose

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>

cp .env.example .env
# Edit .env with your configuration (see below)

docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down
```

> This project does not expose any HTTP port. It pushes messages to Telegram via Telegram API and receives commands via Telegram long polling (when enabled).

## Configuration

All settings are configured via environment variables in the `.env` file:

| Variable             | Required | Default              | Description                                   |
| -------------------- | -------- | -------------------- | --------------------------------------------- |
| `SUBSCRIBE_REPOS`    | ⚠️       | —                    | Comma-separated repos to subscribe (e.g. `vuejs/core,nodejs/node`). Required if no subscriptions file is provided |
| `SUBSCRIPTIONS_PATH` | ❌       | `data/subscriptions.json` | Subscriptions file path (takes priority over `SUBSCRIBE_REPOS` when the file exists) |
| `TELEGRAM_BOT_TOKEN` | ✅       | —                    | Telegram Bot Token                            |
| `TELEGRAM_CHAT_ID`   | ✅       | —                    | Target channel/group/user ID                  |
| `TELEGRAM_ADMIN_CHAT_ID` | ❌   | `TELEGRAM_CHAT_ID`   | Admin chat allowed to run Telegram commands (numeric ID or `@username`) |
| `TELEGRAM_COMMANDS`  | ❌       | `1`                  | Enable Telegram command loop in daemon mode (`0`/`false` to disable) |
| `AI_API_KEY`         | ✅       | —                    | AI service API Key                            |
| `AI_MODEL`           | ❌       | `gpt-4o-mini`        | Model name                                    |
| `AI_PROVIDER`        | ❌       | `openai-completions` | AI provider (see below)                       |
| `AI_BASE_URL`        | ❌       | SDK default          | Custom API URL (proxy/self-hosted)            |
| `GITHUB_TOKEN`       | ❌       | —                    | GitHub PAT for higher rate limits (5000 req/hr vs 60 req/hr) |
| `TIMEZONE`           | ❌       | `Asia/Shanghai`      | IANA timezone for cron and message formatting |
| `CRON`               | ❌       | —                    | Cron expression (6 fields, with seconds). Required for Docker/local mode |
| `TARGET_LANG`        | ❌       | `English`            | Target language for AI translation            |
| `DOCKER_SOCKET_PATH` | ❌       | `/var/run/docker.sock` | Docker Engine socket path (only used by `/status`) |

> Configure subscriptions using **one** of the following:
> - `SUBSCRIBE_REPOS`, or
> - `data/subscriptions.json` (or set `SUBSCRIPTIONS_PATH`). If the file exists, it takes priority.

### How to get `TELEGRAM_CHAT_ID`

- If your target is a **public channel** with a username, just use `@channel_username`.
- For **private channels / groups**, you usually need a numeric chat id (often starts with `-100`).

One simple way (PowerShell):

1. Add your bot to the target group/channel and send a message.
2. Run:

```powershell
$token = '<YOUR_TELEGRAM_BOT_TOKEN>'
Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates" | ConvertTo-Json -Depth 20
```

Look for `result[].message.chat.id` (or `result[].channel_post.chat.id`), then set `TELEGRAM_CHAT_ID` to that value.

> `TARGET_LANG` controls both AI translation output and category labels (e.g. ✨ Features). Built-in label translations are available for `English`, `Chinese`, and `Japanese`. Other languages will use English labels with AI-translated content.
>
> If `TIMEZONE` is not set, the program falls back to `TZ`; if neither is set, defaults to `Asia/Shanghai`.
> `TIMEZONE` must be a valid IANA timezone (e.g. `Asia/Shanghai`, `UTC`). Formats like `UTC+8` are invalid and will cause a startup error.

### AI Providers

Supported `AI_PROVIDER` values:

| Value                | Description                                                           | AI_MODEL Example           |
| -------------------- | --------------------------------------------------------------------- | -------------------------- |
| `openai-completions` | OpenAI Chat Completions (default), compatible with all OpenAI proxies | `gpt-4o-mini`              |
| `openai-responses`   | OpenAI Responses API                                                  | `gpt-4o-mini`              |
| `google`             | Google Gemini                                                         | `gemini-2.0-flash`         |
| `anthropic`          | Anthropic Claude                                                      | `claude-sonnet-4-20250514` |

**Using a third-party proxy**: Set `AI_PROVIDER=openai-completions` and point `AI_BASE_URL` to your proxy.

`.env` example:

```env
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx  # Optional, recommended for many repos
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=@my_channel
AI_PROVIDER=openai-completions
AI_API_KEY=sk-xxxxxxxxxxxx
AI_MODEL=gpt-4o-mini
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
TARGET_LANG=English
SUBSCRIBE_REPOS=vuejs/core,nodejs/node
```

### Scheduling (Cron)

In Docker/local mode, the program uses `CRON` for internal scheduling (via the `cron` package):

```env
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
```

This means: every day 09:00–23:59, check every 10 minutes (no notifications at night).

Examples:

- Weekdays daytime every 10 min: `0 */10 9-23 * * 1-5`
- Daily at 08:30: `0 30 8 * * *`

> `CRON` uses 6-field format (second minute hour day month weekday), e.g. `0 */10 9-23 * * *`.
> In GitHub Actions mode, scheduling is handled by the workflow cron trigger — `CRON` is not needed.

## Subscription

Set the `SUBSCRIBE_REPOS` environment variable with comma-separated GitHub repos (`owner/repo` format):

```env
SUBSCRIBE_REPOS=vuejs/core,nodejs/node,microsoft/vscode
```

Each entry also accepts GitHub URLs and SSH URLs (these are normalized to `owner/repo` internally):

- `https://github.com/owner/repo`
- `git@github.com:owner/repo.git`

> First run behavior: if there is no existing `data/state.json`, the bot sends the latest release/tag once as a baseline, then only sends new ones afterwards.

### Subscriptions file (optional)

If `data/subscriptions.json` exists (or `SUBSCRIPTIONS_PATH` points to a file), it takes priority over `SUBSCRIBE_REPOS`.

Accepted formats:

```json
[
  "vuejs/core",
  "some-org/lib:tag",
  { "repo": "nodejs/node", "mode": "release" }
]
```

### Subscription Modes

Each repo can optionally specify a subscription mode with a `:mode` suffix:

| Format | Mode | Description |
|--------|------|-------------|
| `owner/repo` | `release` | Subscribe to GitHub Releases (default) |
| `owner/repo:release` | `release` | Explicitly subscribe to Releases |
| `owner/repo:tag` | `tag` | Subscribe to new Git tags (for repos without Releases) |

Example:

```env
SUBSCRIBE_REPOS=vuejs/core,some-org/lib:tag,another/tool:release
```

- `vuejs/core` — monitors Releases (default)
- `some-org/lib:tag` — monitors new Git tags, generates changelog from commits between tags
- `another/tool:release` — explicitly monitors Releases

In **tag mode**, the bot fetches commits between the previous and new tag (up to 50), feeds them to AI for categorization, and sends the result in the same format as release notifications.

For GitHub Actions, set this as a **Variable** in repository settings.
For Docker/local, add it to your `.env` file.

Restart the container after changes:

```bash
docker compose restart
```

### Manage Subscriptions via Telegram Commands (Docker/local only)

> GitHub Actions runs in single-shot mode and cannot receive Telegram commands. This works only in Docker/local daemon mode.

1. Set `TELEGRAM_ADMIN_CHAT_ID` (recommended) to the chat id allowed to control the bot (numeric ID or `@username`).
2. Send commands in that chat:
   - `/list` to show all subscriptions with Unsubscribe buttons
   - `/subscribe owner/repo` or `/subscribe https://github.com/owner/repo`
   - `/unsubscribe owner/repo` or `/unsubscribe https://github.com/owner/repo`
   - `/check` to check latest versions (minimal output)
   - `/check owner/repo` to check a specific repo
   - `/translate hello` to translate text to `TARGET_LANG` (quick AI config test)
   - `/aihealth` to ping `AI_BASE_URL` (OpenAI-compatible only)
   - `/status` to show local Docker Compose versions and compare with GitHub (requires docker sock)
   - `/status diff` to show only outdated/unknown projects

Subscriptions are persisted to `data/subscriptions.json` (override via `SUBSCRIPTIONS_PATH`). If the file exists, it takes priority over `SUBSCRIBE_REPOS`.

### Multi-user hosting note

This project is designed as a **single-tenant** bot: it pushes to one `TELEGRAM_CHAT_ID` and uses one subscription list/state.
If you want to run a public bot that many users can use simultaneously (each with their own chat/subscriptions), you’ll need additional multi-tenant logic (per-chat subscriptions + per-chat state + rate limiting).

### Optional: Compare Compose Versions

To let the bot read Docker/Compose metadata, mount the Docker socket (risky; recommended only for personal setups).

Then:

- `/status` tries to read local versions from the image OCI label `org.opencontainers.image.version` (falls back to image tag).
- If the image label `org.opencontainers.image.source` points to `https://github.com/owner/repo`, the bot can compare against the latest GitHub release/tag.
- If repo inference is not possible, add mappings in `data/compose_map.json` (by project/service/image).

## Message Format

Example Telegram message from the bot:

```
vuejs/core

2025-02-19 14:30:00  v3.5.0

✨ Features
• Added useTemplateRef API
• Support for deferred Teleport

🐛 Bug Fixes
• Fixed reactive array watch callback trigger issue

⚡ Performance
• Improved virtual DOM diff performance
```

AI automatically translates English release notes into the configured target language and groups them by category.

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your tokens and SUBSCRIBE_REPOS

npm run dev    # Dev mode (auto-restart on file changes)
npm start      # Run directly (daemon with internal cron)
npm run check  # Run once and exit (used by GitHub Actions)
npm run build  # Compile TypeScript
```

## Project Structure

```
├── src/
│   ├── index.ts       # Entry point, daemon with internal cron
│   ├── action.ts      # Single-run entry point (for GitHub Actions)
│   ├── config.ts      # Environment config loader
│   ├── subscriptions.ts # Subscriptions parsing & persistence
│   ├── types.ts       # Type definitions
│   ├── github.ts      # GitHub API client & state management
│   ├── ai.ts          # AI translation & categorization
│   ├── formatter.ts   # Telegram message formatting
│   ├── telegram.ts    # Telegram message sender (with retry)
│   ├── telegram_commands.ts # Telegram command loop (/subscribe, /list, ...)
│   ├── telegram_state.ts # Telegram offset persistence
│   ├── docker_engine.ts  # Docker Engine API client (optional)
│   ├── compose_map.ts    # Compose->repo mapping (optional)
│   └── logger.ts      # Logger utility
├── data/              # Runtime state (auto-generated)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[MIT](LICENSE)

## Attribution

This project is based on [nicepkg/github-subscribe-bot](https://github.com/nicepkg/github-subscribe-bot) (MIT License).
This repository may include additional changes and is independently maintained.
