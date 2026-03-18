# GitHub Subscribe Bot

[English](README.md) | 简体中文 | [日本語](README.ja.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)

订阅 GitHub 仓库的 Release，通过 AI 自动将更新日志翻译并分类，推送到 Telegram 频道/群组。

## 功能特性

- 定时轮询 GitHub Release（支持 ETag 缓存，节省 API 配额）
- 持久化运行状态，避免重复推送（`data/state.json`，GitHub Actions 会缓存）
- 支持 Tag 订阅模式（适用于没有 Release 的项目）
- AI 自动翻译 + 分类（新功能、修复、优化、重构、文档、其他）
- 支持多种 AI 提供商：OpenAI / Google Gemini / Anthropic Claude
- 翻译目标语言可配置（默认英文）
- Telegram 消息自动分割（超过 4096 字符时拆分发送）
- 发送失败自动重试（最多 3 次）
- 支持 Telegram 指令管理订阅（守护进程模式，可选）
- 可选 `/status` 指令：对比本机 Docker Compose 版本与 GitHub 最新版本（需要 Docker socket）
- 支持 Docker Compose 或 GitHub Actions 部署（无需服务器）

## 快速开始

### 前置准备

1. **Telegram Bot** — 通过 [@BotFather](https://t.me/BotFather) 创建 Bot，获取 Token
2. **Telegram Chat ID** — 频道用户名（如 `@my_channel`）或群组/个人数字 ID
3. **AI API Key** — 任选一个 AI 提供商的 API Key
4. **GitHub Token**（可选）— [创建 Personal Access Token](https://github.com/settings/tokens)，可提高 API 频率限制。订阅仓库多或轮询频率高时建议配置

### 方式一：GitHub Actions（推荐）

无需服务器，Fork 后配置即可：

1. Fork 本仓库（或用 Template / 基于本项目新建你自己的仓库）
2. 进入 **Settings → Secrets and variables → Actions**
3. 添加 **Secrets**（加密）：
   - `TELEGRAM_BOT_TOKEN` — Telegram Bot Token
   - `TELEGRAM_CHAT_ID` — 目标频道/群组 ID
   - `AI_API_KEY` — AI 服务 API Key
4. 添加 **Variables**（明文）：
   - `SUBSCRIBE_REPOS` — 逗号分隔的仓库列表，如 `vuejs/core,nodejs/node`
   - `AI_PROVIDER` —（可选）AI 提供商，默认 `openai-completions`
   - `AI_MODEL` —（可选）模型名称，默认 `gpt-4o-mini`
   - `AI_BASE_URL` —（可选）自定义 API 地址（代理/自部署）
   - `TIMEZONE` —（可选）IANA 时区，默认 `Asia/Shanghai`
   - `TARGET_LANG` —（可选）翻译目标语言，默认 `English`
5. 进入 **Actions** 页面 → 启用 workflows
6. 可手动触发 **Release Check** 测试

如需修改轮询频率，请编辑 `.github/workflows/check.yml` 里的 schedule cron。

> GitHub Actions 自动提供内置 `GITHUB_TOKEN`（1000 次/小时），无需额外配置。

### 方式二：Docker Compose

```bash
git clone https://github.com/<你的用户名>/<你的仓库>.git
cd <你的仓库>

cp .env.example .env
# 编辑 .env 填入你的配置（见下方配置说明）

docker compose up -d --build

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

> 本项目不提供 HTTP 服务，不需要对外暴露端口。运行后会通过 Telegram API 主动推送消息，并使用 Telegram 的 long polling 接收指令（如启用）。

## 配置说明

所有配置通过环境变量设置，在 `.env` 文件中填写：

| 变量                 | 必填 | 默认值               | 说明                                             |
| -------------------- | ---- | -------------------- | ------------------------------------------------ |
| `SUBSCRIBE_REPOS`    | ⚠️   | —                    | 逗号分隔的订阅仓库列表（如 `vuejs/core,nodejs/node`）。如果没有订阅文件则必填 |
| `SUBSCRIPTIONS_PATH` | ❌   | `data/subscriptions.json` | 订阅文件路径（文件存在时优先级高于 `SUBSCRIBE_REPOS`） |
| `TELEGRAM_BOT_TOKEN` | ✅   | —                    | Telegram Bot Token                               |
| `TELEGRAM_CHAT_ID`   | ✅   | —                    | 目标频道/群组/用户 ID                            |
| `TELEGRAM_ADMIN_CHAT_ID` | ❌ | `TELEGRAM_CHAT_ID`   | 允许控制机器人的 admin chat（数字 ID 或 `@username`） |
| `TELEGRAM_COMMANDS`  | ❌   | `1`                  | 守护进程模式下是否启用 Telegram 指令循环（`0`/`false` 关闭） |
| `AI_API_KEY`         | ✅   | —                    | AI 服务 API Key                                  |
| `AI_MODEL`           | ❌   | `gpt-4o-mini`        | 模型名称                                         |
| `AI_PROVIDER`        | ❌   | `openai-completions` | AI 提供商（见下方）                              |
| `AI_BASE_URL`        | ❌   | 各 SDK 默认值        | 自定义 API 地址（代理/自部署）                   |
| `GITHUB_TOKEN`       | ❌   | —                    | GitHub PAT，提高 API 频率限制（5000 次/小时 vs 60 次/小时） |
| `TIMEZONE`           | ❌   | `Asia/Shanghai`      | 全局时区（IANA），用于 cron 调度和消息时间格式化 |
| `CRON`               | ❌   | —                    | Cron 表达式（6 字段，含秒）。Docker/本地模式必填 |
| `TARGET_LANG`        | ❌   | `English`            | AI 翻译目标语言                                  |
| `DOCKER_SOCKET_PATH` | ❌   | `/var/run/docker.sock` | Docker Engine socket 路径（仅 `/status` 使用） |

> 订阅配置二选一：
> - 用 `SUBSCRIBE_REPOS`，或
> - 使用 `data/subscriptions.json`（或设置 `SUBSCRIPTIONS_PATH`）。若该文件存在，会优先使用文件订阅。

### 如何获取 `TELEGRAM_CHAT_ID`

- 如果推送目标是**公开频道**且有 username，直接用 `@channel_username` 即可。
- 如果是**私有频道/群组**，通常需要数字 chat id（经常以 `-100` 开头）。

现在有两种获取方式：

1. 至少配置 `TELEGRAM_BOT_TOKEN` 启动 bot，进入 **onboarding 模式**。
2. 在私聊里给 bot 发送 `/start`，或者把 bot 加到群组/频道后触发一次更新。
3. 从以下位置读取发现到的 chat id：
   - `/start` 的返回消息
   - `data/discovered_chats.json`
   - 容器日志里的 `[TG] Discovered chat ...`
4. 如果你想直接拿到可复制的配置行，在当前 chat 发送 `/bind`。

一种简单方法（PowerShell）：

1. 把 Bot 拉进目标群/频道，并发送一条消息。
2. 运行：

```powershell
$token = '<你的 TELEGRAM_BOT_TOKEN>'
Invoke-RestMethod "https://api.telegram.org/bot$token/getUpdates" | ConvertTo-Json -Depth 20
```

在输出里找到 `result[].message.chat.id`（或 `result[].channel_post.chat.id`），然后把该数字填到 `TELEGRAM_CHAT_ID`。

> 如果缺少 `CRON`、`AI_API_KEY` 或 `TELEGRAM_CHAT_ID`，守护进程现在会退化为 **命令/onboarding 模式**，而不是启动即退出。在这个模式下不会执行 Release 监控，但 Telegram 指令轮询仍可工作，你可以先用 `/start` 和 `/bind` 完成首次接入。

> `TARGET_LANG` 同时控制 AI 翻译输出和分类标签（如 ✨ 新功能）。内置标签翻译支持`English`、`Chinese`和`Japanese`，其他语言将使用英文标签配合 AI 翻译内容。
>
> 若未设置 `TIMEZONE`，程序会回退读取 `TZ`；两者都未设置时默认 `Asia/Shanghai`。
> `TIMEZONE` 必须是 IANA 时区（例如 `Asia/Shanghai`、`UTC`），`UTC+8` 这类写法会在启动时报错。

### AI 提供商配置

`AI_PROVIDER` 支持以下值：

| 值                   | 说明                                                  | AI_MODEL 示例              |
| -------------------- | ----------------------------------------------------- | -------------------------- |
| `openai-completions` | OpenAI Chat Completions（默认），兼容所有 OpenAI 代理 | `gpt-4o-mini`              |
| `openai-responses`   | OpenAI Responses API                                  | `gpt-4o-mini`              |
| `google`             | Google Gemini                                         | `gemini-2.0-flash`         |
| `anthropic`          | Anthropic Claude                                      | `claude-sonnet-4-20250514` |

**使用第三方代理**：设置 `AI_PROVIDER=openai-completions`，将 `AI_BASE_URL` 指向代理地址即可。

`.env` 配置示例：

```env
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx  # 可选，仓库多时建议配置
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=@my_channel
AI_PROVIDER=openai-completions
AI_API_KEY=sk-xxxxxxxxxxxx
AI_MODEL=gpt-4o-mini
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
TARGET_LANG=Chinese
```

### 定时调度（Cron）

Docker/本地模式下，程序使用 `CRON` 进行内部调度（基于 `cron` 包）：

```env
TIMEZONE=Asia/Shanghai
CRON=0 */10 9-23 * * *
```

含义：每天 09:00-23:59，每 10 分钟检查一次（夜间不通知）。

常用示例：

- 工作日白天每 10 分钟：`0 */10 9-23 * * 1-5`
- 每天 08:30：`0 30 8 * * *`

> `CRON` 使用 6 字段格式（秒 分 时 日 月 周），例如 `0 */10 9-23 * * *`。
> GitHub Actions 模式下，调度由 workflow cron 触发器处理，无需配置 `CRON`。

## 订阅仓库

通过 `SUBSCRIBE_REPOS` 环境变量设置订阅的 GitHub 仓库（`owner/repo` 格式，逗号分隔）：

```env
SUBSCRIBE_REPOS=vuejs/core,nodejs/node,microsoft/vscode
```

每一项也支持 GitHub URL / SSH URL（内部会自动标准化为 `owner/repo`）：

- `https://github.com/owner/repo`
- `git@github.com:owner/repo.git`

> 首次运行说明：如果没有历史 `data/state.json`，Bot 会先推送“当前最新”的 release/tag 作为基线，然后后续只推送新增内容。

### 订阅文件（可选）

如果 `data/subscriptions.json` 存在（或 `SUBSCRIPTIONS_PATH` 指向某个文件），会优先使用文件订阅，而不是 `SUBSCRIBE_REPOS`。

支持的格式示例：

```json
[
  "vuejs/core",
  "some-org/lib:tag",
  { "repo": "nodejs/node", "mode": "release" }
]
```

### 订阅模式

每个仓库可通过 `:mode` 后缀指定订阅模式：

| 格式 | 模式 | 说明 |
|------|------|------|
| `owner/repo` | `release` | 订阅 GitHub Release（默认） |
| `owner/repo:release` | `release` | 显式订阅 Release |
| `owner/repo:tag` | `tag` | 订阅新 Git Tag（适用于没有 Release 的项目） |

示例：

```env
SUBSCRIBE_REPOS=vuejs/core,some-org/lib:tag,another/tool:release
```

- `vuejs/core` — 监听 Release（默认）
- `some-org/lib:tag` — 监听新 Git Tag，根据两个 Tag 之间的 commits 生成更新日志
- `another/tool:release` — 显式监听 Release

**Tag 模式**下，Bot 会获取前后两个 Tag 之间的 commits（最多 50 条），交给 AI 分类翻译，推送格式与 Release 通知一致。

GitHub Actions 模式下，在仓库 Settings 中设置为 **Variable**。
Docker/本地模式下，添加到 `.env` 文件中。

修改后重启容器生效：

```bash
docker compose restart
```

### 通过 Telegram 指令管理订阅（Docker/本地模式）

> GitHub Actions 模式是“单次运行”，无法接收 Telegram 指令；该功能仅在 Docker/本地守护进程模式生效。

1. 设置 `TELEGRAM_ADMIN_CHAT_ID`（推荐）为你要控制机器人的 chat id（数字 ID 或 `@username`）。
2. 运行后，在该 chat 中发送指令：
   - `/start`：显示当前 chat 信息，并给出首次接入提示
   - `/bind`：输出当前 chat 可直接复制的 `TELEGRAM_CHAT_ID` / `TELEGRAM_ADMIN_CHAT_ID` 配置行
   - `/list`：列出所有订阅，并提供 Unsubscribe 按钮
   - `/subscribe owner/repo` 或 `/subscribe https://github.com/owner/repo`
   - `/unsubscribe owner/repo` 或 `/unsubscribe https://github.com/owner/repo`
   - `/check`：检查订阅仓库最新版本（尽量简短输出）
   - `/check owner/repo`：检查指定仓库最新版本
   - `/translate 你好`：翻译文本（翻译到 `TARGET_LANG`，用于快速验证 AI 配置是否可用）
   - `/aihealth`：检测 AI_BASE_URL 连通性（仅对 OpenAI 兼容地址有效）
   - `/status`：列出本机 Docker Compose 项目版本，并尽量对比 GitHub 最新版本（需要挂载 docker sock）
   - `/status diff`：只显示落后/未知的项目

订阅会写入 `data/subscriptions.json`（可通过 `SUBSCRIPTIONS_PATH` 自定义路径）。若该文件存在，会优先使用文件订阅；否则回退使用 `SUBSCRIBE_REPOS`。

### 多人共用说明

当前项目更偏向 **单租户**：只会推送到一个 `TELEGRAM_CHAT_ID`，并共用一份订阅列表/状态。
如果你想把它做成“任何人都能用”的公共 Bot（每个用户/群组都有自己的订阅与状态），需要额外实现多租户能力（按 chat 维度存订阅与 state，并做限流/权限控制）。

这也意味着 `/start` 和 `/bind` 目前只能帮助你“发现 id + 引导配置”，并不能自动把机器人升级成真正的多用户公共 Bot，更不会为每个 chat 自动维护独立订阅。

### Docker Compose 项目版本对比（可选）

如果你愿意让 Bot 读取本机 Docker 容器信息（Compose project、image labels 等），可以挂载 Docker socket（有安全风险，只建议在自用环境）：

```bash
docker compose up -d --build
```

挂载方式（示例，按你自己的 compose 文件修改）：

- `- /var/run/docker.sock:/var/run/docker.sock`

然后：

- 用 `/status` 查看本机项目版本（尽量从 OCI label `org.opencontainers.image.version` 获取本地版本；否则回退到镜像 tag）。
- 如果镜像 label 里有 `org.opencontainers.image.source=https://github.com/owner/repo`，会自动推断远端仓库并对比远端最新 release/tag。
- 如果推断不到 repo，可以写 `data/compose_map.json` 进行映射（按 project/service/image 指定 repo）。

## 消息格式

Bot 推送的 Telegram 消息示例：

```
vuejs/core

2025-02-19 14:30:00  v3.5.0

✨ 新功能
• 新增 useTemplateRef API
• 支持延迟 Teleport

🐛 修复
• 修复响应式数组 watch 回调触发异常

⚡ 优化
• 提升虚拟 DOM diff 性能
```

AI 会将英文 Release Notes 自动翻译为配置的目标语言，并按类别分组。

## 本地开发

```bash
npm install
cp .env.example .env
# 编辑 .env 填入你的 Token 和 SUBSCRIBE_REPOS

npm run dev    # 开发模式（文件变更自动重启）
npm start      # 直接运行（守护进程，内部 cron 调度）
npm run check  # 单次运行后退出（GitHub Actions 使用）
npm run build  # 编译 TypeScript
```

## 项目结构

```
├── src/
│   ├── index.ts       # 入口，守护进程与内部 cron 调度
│   ├── action.ts      # 单次运行入口（GitHub Actions 用）
│   ├── config.ts      # 环境变量加载与校验
│   ├── subscriptions.ts # 订阅解析与持久化
│   ├── types.ts       # 类型定义
│   ├── github.ts      # GitHub API 交互与状态管理
│   ├── ai.ts          # AI 翻译与分类
│   ├── formatter.ts   # Telegram 消息格式化
│   ├── telegram.ts    # Telegram 消息发送（含重试）
│   ├── telegram_commands.ts # Telegram 指令循环（/subscribe、/list 等）
│   ├── telegram_state.ts # Telegram offset 持久化
│   ├── docker_engine.ts  # Docker Engine API（可选）
│   ├── compose_map.ts    # Compose->repo 映射（可选）
│   └── logger.ts      # 日志工具
├── data/              # 运行时状态（自动生成）
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 贡献指南

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

## 致谢与来源

本项目基于 [tbphp/github-subscribe-bot](https://github.com/tbphp/github-subscribe-bot)（MIT License）进行二次开发。
当前仓库可能包含额外修改，并由本仓库维护者独立维护。
