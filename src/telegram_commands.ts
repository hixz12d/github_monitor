import type { AppConfig, Subscription } from './types.js';
import { existsSync } from 'node:fs';
import {
  answerCallbackQuery,
  deleteWebhook,
  editMessageText,
  getUpdates,
  sendMessage,
  setMyCommands,
  type InlineKeyboardMarkup,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramUpdate,
} from './telegram.js';
import { loadTelegramBotState, saveTelegramBotState } from './telegram_state.js';
import {
  loadSubscriptionsFile,
  normalizeRepo,
  parseSubscriptionInput,
  removeSubscription,
  resolveSubscriptionsPath,
  saveSubscriptionsFile,
  subscriptionKey,
  tryLoadSubscriptionsFromEnv,
  upsertSubscription,
} from './subscriptions.js';
import { checkRepo, checkRepoTags, getLatestReleaseTag, getLatestTagName } from './github.js';
import { createAIClient, translateText } from './ai.js';
import { dockerAvailable, inspectImage, listRunningContainers } from './docker_engine.js';
import { findRepoMapping, loadComposeRepoMappings } from './compose_map.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function parseGitHubRepoFromSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  // Common: https://github.com/owner/repo(.git)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      if (host !== 'github.com' && host !== 'www.github.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = parts[0]!;
      let repo = parts[1]!;
      if (repo.endsWith('.git')) repo = repo.slice(0, -4);
      return `${owner}/${repo}`;
    } catch {
      return null;
    }
  }

  return null;
}

function getImageTag(image: string): string | null {
  // e.g. org/name:v1.2.3 -> v1.2.3
  const idx = image.lastIndexOf(':');
  if (idx === -1) return null;
  const tag = image.slice(idx + 1).trim();
  return tag || null;
}

async function getRemoteLatestVersion(
  repo: string,
  githubToken: string | undefined,
): Promise<string | null> {
  const latestRelease = await getLatestReleaseTag(repo, githubToken);
  if (latestRelease) return latestRelease;
  return await getLatestTagName(repo, githubToken);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function openaiModelsPing(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; ms: number; detail?: string }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      },
      8000,
    );
    const ms = Date.now() - start;
    if (res.ok) return { ok: true, status: res.status, ms };
    const body = truncate(await res.text(), 800);
    return { ok: false, status: res.status, ms, detail: body };
  } catch (e: unknown) {
    const ms = Date.now() - start;
    return { ok: false, status: 0, ms, detail: String(e) };
  }
}

function resolveAdminChatId(config: AppConfig): string {
  return (process.env.TELEGRAM_ADMIN_CHAT_ID || config.telegramChatId).trim();
}

function isAuthorized(chat: TelegramChat, adminChatId: string): boolean {
  if (!adminChatId) return false;

  if (/^-?\d+$/.test(adminChatId)) {
    return String(chat.id) === adminChatId;
  }

  if (adminChatId.startsWith('@')) {
    if (!chat.username) return false;
    return `@${chat.username}`.toLowerCase() === adminChatId.toLowerCase();
  }

  return false;
}

function loadCurrentSubscriptions(): Subscription[] {
  const path = resolveSubscriptionsPath();
  if (existsSync(path)) return loadSubscriptionsFile(path);
  return tryLoadSubscriptionsFromEnv();
}

function saveCurrentSubscriptions(subs: Subscription[]): void {
  saveSubscriptionsFile(subs);
}

function buildSubscriptionsListMessage(
  subs: Subscription[],
): { text: string; reply_markup?: InlineKeyboardMarkup } {
  const header = `<b>Subscriptions (${subs.length})</b>`;
  const text = `${header}\n\nClick the button below to unsubscribe:`;

  const inline_keyboard = subs.map((s) => ([
    { text: s.repo, url: `https://github.com/${s.repo}` },
    { text: 'Unsubscribe', callback_data: `unsub:${subscriptionKey(s.repo)}` },
  ]));

  return { text, reply_markup: inline_keyboard.length > 0 ? { inline_keyboard } : undefined };
}

async function getLatestVersionText(
  sub: Subscription,
  githubToken: string | undefined,
): Promise<string | null> {
  try {
    if (sub.mode === 'tag') {
      return await getLatestTagName(sub.repo, githubToken);
    }
    const latestRelease = await getLatestReleaseTag(sub.repo, githubToken);
    if (latestRelease) return latestRelease;
    return await getLatestTagName(sub.repo, githubToken);
  } catch (e) {
    console.error(`[Cmd] /check failed for ${sub.repo}:${sub.mode}`, e);
    return null;
  }
}

function parseCommand(textRaw: string): { cmd: string; args: string } | null {
  const text = textRaw.trim();
  if (!text.startsWith('/')) return null;

  const [first, ...rest] = text.split(/\s+/);
  if (!first) return null;

  const cmdToken = first.slice(1).split('@')[0]?.toLowerCase();
  if (!cmdToken) return null;

  return { cmd: cmdToken, args: rest.join(' ') };
}

async function handleList(
  botToken: string,
  chatId: string,
): Promise<void> {
  const subs = loadCurrentSubscriptions();
  if (subs.length === 0) {
    await sendMessage(
      botToken,
      chatId,
      '<b>Subscriptions (0)</b>\n\nNo subscriptions.\nUse <code>/subscribe owner/repo</code> to add one.',
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }
  const payload = buildSubscriptionsListMessage(subs);

  await sendMessage(botToken, chatId, payload.text, {
    parse_mode: 'HTML',
    reply_markup: payload.reply_markup,
    disable_web_page_preview: true,
  });
}

async function handleSubscribe(
  botToken: string,
  chatId: string,
  args: string,
): Promise<void> {
  const sub = parseSubscriptionInput(args);
  if (!sub) {
    await sendMessage(
      botToken,
      chatId,
      'Usage:\n<code>/subscribe owner/repo</code>\n<code>/subscribe https://github.com/owner/repo</code>\nOptional: <code>:tag</code> or <code>:release</code>',
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const current = loadCurrentSubscriptions();
  const exists = current.some((s) => s.repo.toLowerCase() === sub.repo.toLowerCase());
  const next = upsertSubscription(current, sub);
  saveCurrentSubscriptions(next);

  const modeText = sub.mode === 'tag' ? 'tag' : 'release';
  await sendMessage(
    botToken,
    chatId,
    `${exists ? 'Updated' : 'Subscribed'}: <b>${escapeHtml(sub.repo)}</b> (<code>${modeText}</code>)`,
    { parse_mode: 'HTML', disable_web_page_preview: true },
  );
}

async function handleUnsubscribe(
  botToken: string,
  chatId: string,
  args: string,
): Promise<void> {
  const parsed = parseSubscriptionInput(args);
  const repo = parsed?.repo ?? normalizeRepo(args);
  if (!repo) {
    await sendMessage(
      botToken,
      chatId,
      'Usage:\n<code>/unsubscribe owner/repo</code>\n<code>/unsubscribe https://github.com/owner/repo</code>',
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const current = loadCurrentSubscriptions();
  const { next, removed } = removeSubscription(current, repo);
  if (!removed) {
    await sendMessage(
      botToken,
      chatId,
      `Not subscribed: <b>${escapeHtml(repo)}</b>`,
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  saveCurrentSubscriptions(next);
  await sendMessage(
    botToken,
    chatId,
    `Unsubscribed: <b>${escapeHtml(repo)}</b>`,
    { parse_mode: 'HTML', disable_web_page_preview: true },
  );
}

async function handleCheck(
  botToken: string,
  chatId: string,
  githubToken: string | undefined,
  args: string,
): Promise<void> {
  const trimmedArgs = args.trim();
  if (trimmedArgs) {
    const requested = parseSubscriptionInput(trimmedArgs);
    if (!requested) {
      await sendMessage(
        botToken,
        chatId,
        'Usage:\n<code>/check</code>\n<code>/check owner/repo</code>\n<code>/check https://github.com/owner/repo</code>',
        { parse_mode: 'HTML', disable_web_page_preview: true },
      );
      return;
    }

    const subs = loadCurrentSubscriptions();
    const existing = subs.find((s) => s.repo.toLowerCase() === requested.repo.toLowerCase());
    const sub: Subscription = existing ?? requested;
    const latest = await getLatestVersionText(sub, githubToken);
    await sendMessage(
      botToken,
      chatId,
      escapeHtml(latest ?? 'none'),
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const subs = loadCurrentSubscriptions();
  if (subs.length === 0) {
    await sendMessage(
      botToken,
      chatId,
      'No subscriptions.',
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const lines: string[] = [];
  for (const sub of subs) {
    const latest = await getLatestVersionText(sub, githubToken);
    lines.push(`${escapeHtml(sub.repo)}: ${escapeHtml(latest ?? 'none')}`);
  }

  const text = lines.join('\n');
  await sendMessage(
    botToken,
    chatId,
    text,
    { parse_mode: 'HTML', disable_web_page_preview: true },
  );
}

async function handleTranslate(
  config: AppConfig,
  chatId: string,
  args: string,
): Promise<void> {
  const input = args.trim();
  if (!input) {
    await sendMessage(
      config.telegramBotToken,
      chatId,
      'Usage:\n<code>/translate your text</code>\nTranslates to TARGET_LANG.',
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const model = createAIClient(config);
  let out = '';
  try {
    out = await translateText(model, input, config.targetLang);
  } catch (e: unknown) {
    const base = config.aiBaseUrl || '(sdk default)';
    const msg = [
      '<b>AI error</b>',
      `provider: <code>${escapeHtml(config.aiProvider)}</code>`,
      `model: <code>${escapeHtml(config.aiModel)}</code>`,
      `base: <code>${escapeHtml(base)}</code>`,
      '',
      `<code>${escapeHtml(truncate(String(e), 900))}</code>`,
      '',
      'Tip: check container logs for the full stack trace.',
      '<code>docker compose logs -f</code>',
    ].join('\n');
    await sendMessage(
      config.telegramBotToken,
      chatId,
      msg,
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }
  await sendMessage(
    config.telegramBotToken,
    chatId,
    escapeHtml(out || ''),
    { parse_mode: 'HTML', disable_web_page_preview: true },
  );
}

async function handleAiHealth(
  config: AppConfig,
  chatId: string,
  args: string,
): Promise<void> {
  const verbose = args.trim().toLowerCase() === 'verbose';

  const provider = config.aiProvider;
  const baseUrl = config.aiBaseUrl || '';
  const apiKey = config.aiApiKey;

  // Minimal default output, but still useful for debugging.
  if (!baseUrl) {
    const text = verbose
      ? `<b>AI Health</b>\nprovider: <code>${escapeHtml(provider)}</code>\nmodel: <code>${escapeHtml(config.aiModel)}</code>\nbase: <code>(sdk default)</code>`
      : 'base url not set';
    await sendMessage(config.telegramBotToken, chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    return;
  }

  if (provider !== 'openai-completions' && provider !== 'openai-responses') {
    const text = verbose
      ? `<b>AI Health</b>\nprovider: <code>${escapeHtml(provider)}</code>\nmodel: <code>${escapeHtml(config.aiModel)}</code>\nbase: <code>${escapeHtml(baseUrl)}</code>\n\nPing is only implemented for OpenAI-compatible base URLs.\nUse <code>/translate</code> to validate the configured provider.`
      : 'unsupported provider';
    await sendMessage(config.telegramBotToken, chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    return;
  }

  const result = await openaiModelsPing(baseUrl, apiKey);
  if (result.ok) {
    const text = verbose
      ? `<b>AI Health</b>\nprovider: <code>${escapeHtml(provider)}</code>\nmodel: <code>${escapeHtml(config.aiModel)}</code>\nbase: <code>${escapeHtml(baseUrl)}</code>\n\nok (${result.status}, ${result.ms}ms)`
      : `ok (${result.status}, ${result.ms}ms)`;
    await sendMessage(config.telegramBotToken, chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
    return;
  }

  const detail = result.detail ? `\n\n<code>${escapeHtml(truncate(result.detail, 900))}</code>` : '';
  const text = verbose
    ? `<b>AI Health</b>\nprovider: <code>${escapeHtml(provider)}</code>\nmodel: <code>${escapeHtml(config.aiModel)}</code>\nbase: <code>${escapeHtml(baseUrl)}</code>\n\nfail (${result.status || 'error'}, ${result.ms}ms)${detail}`
    : `fail (${result.status || 'error'}, ${result.ms}ms)`;
  await sendMessage(config.telegramBotToken, chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
}

async function handleStatusCmd(
  config: AppConfig,
  chatId: string,
  args: string,
): Promise<void> {
  const tokens = args
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const verbose = tokens.includes('verbose');
  const diffOnly = tokens.includes('diff') || tokens.includes('outdated');

  if (!await dockerAvailable()) {
    await sendMessage(
      config.telegramBotToken,
      chatId,
      [
        '<b>Status</b>',
        '',
        'Docker API is not available inside this container.',
        '',
        'Tip: mount the Docker socket to enable this feature:',
        '<code>/var/run/docker.sock:/var/run/docker.sock</code>',
      ].join('\n'),
      { parse_mode: 'HTML', disable_web_page_preview: true },
    );
    return;
  }

  const mappings = loadComposeRepoMappings();

  const containers = await listRunningContainers();
  const byProject = new Map<string, typeof containers>();
  for (const c of containers) {
    const project = c.labels['com.docker.compose.project'] || 'non-compose';
    const arr = byProject.get(project) || [];
    arr.push(c);
    byProject.set(project, arr);
  }

  const lines: string[] = [];
  for (const [project, list] of [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Pick one "app-like" service if possible.
    const candidates = list
      .filter((c) => (c.labels['com.docker.compose.service'] || '').length > 0)
      .filter((c) => !/^(postgres|redis|mongo|mysql)/i.test(c.image));
    const selected = (candidates[0] || list[0])!;

    const service = selected.labels['com.docker.compose.service'] || '';

    let localVersion: string | null = null;
    let repo: string | null = null;
    try {
      const img = await inspectImage(selected.imageId || selected.image);
      const labels = img.Config?.Labels || undefined;
      if (labels) {
        localVersion = labels['org.opencontainers.image.version'] || null;
        const source = labels['org.opencontainers.image.source'];
        if (source) repo = parseGitHubRepoFromSource(source);
      }
    } catch (e) {
      console.warn(`[Status] Failed to inspect image for ${selected.image}:`, e);
    }

    if (!repo) {
      repo = findRepoMapping(mappings, project === 'non-compose' ? null : project, service || null, selected.image || null);
    }

    if (!localVersion) {
      localVersion = getImageTag(selected.image) || 'unknown';
    }

    let remote: string | null = null;
    if (repo) {
      try {
        remote = await getRemoteLatestVersion(repo, config.githubToken);
      } catch (e) {
        console.warn(`[Status] Failed to fetch remote version for ${repo}:`, e);
      }
    }

    if (diffOnly) {
      if (!remote) continue;
      const norm = (v: string) => v.trim().replace(/^v/i, '');
      if (localVersion && localVersion !== 'unknown' && norm(localVersion) === norm(remote)) {
        continue;
      }
    }

    if (verbose) {
      const repoText = repo ? ` repo=${repo}` : '';
      const remoteText = remote ? ` remote=${remote}` : ' remote=?';
      const svcText = service ? ` service=${service}` : '';
      lines.push(`${project}:${svcText} local=${localVersion}${remoteText}${repoText}`);
    } else {
      if (remote) {
        lines.push(`${project}${service ? `/${service}` : ''}: ${localVersion} -> ${remote}`);
      } else {
        lines.push(`${project}${service ? `/${service}` : ''}: ${localVersion}`);
      }
    }
  }

  const maxLines = 60;
  const clipped = lines.length > maxLines;
  const body = (clipped ? lines.slice(0, maxLines) : lines).join('\n') || 'No containers.';
  const text = clipped ? `${body}\n... (${lines.length - maxLines} more)` : body;

  await sendMessage(
    config.telegramBotToken,
    chatId,
    escapeHtml(text),
    { parse_mode: 'HTML', disable_web_page_preview: true },
  );
}

async function handleCallbackUnsubscribe(
  query: TelegramCallbackQuery,
  botToken: string,
): Promise<void> {
  const msg = query.message;
  const data = query.data;
  if (!msg || !data) return;

  const prefix = 'unsub:';
  if (!data.startsWith(prefix)) return;
  const key = data.slice(prefix.length);

  const current = loadCurrentSubscriptions();
  const target = current.find((s) => subscriptionKey(s.repo) === key);
  if (!target) {
    await answerCallbackQuery(botToken, query.id, 'Not found');
    return;
  }

  const { next } = removeSubscription(current, target.repo);
  saveCurrentSubscriptions(next);

  await answerCallbackQuery(botToken, query.id, `Unsubscribed: ${target.repo}`);

  const payload = buildSubscriptionsListMessage(next);
  await editMessageText(
    botToken,
    String(msg.chat.id),
    msg.message_id,
    payload.text,
    { parse_mode: 'HTML', reply_markup: payload.reply_markup, disable_web_page_preview: true },
  );
}

async function handleUpdate(
  update: TelegramUpdate,
  config: AppConfig,
): Promise<void> {
  const adminChatId = resolveAdminChatId(config);

  if (update.callback_query) {
    const query = update.callback_query;
    const chat = query.message?.chat;
    if (!chat) return;
    if (!isAuthorized(chat, adminChatId)) return;

    if (query.data?.startsWith('unsub:')) {
      await handleCallbackUnsubscribe(query, config.telegramBotToken);
      return;
    }

    await answerCallbackQuery(config.telegramBotToken, query.id);
    return;
  }

  const msg = update.message || update.channel_post;
  if (!msg?.text) return;
  if (!isAuthorized(msg.chat, adminChatId)) return;

  const parsed = parseCommand(msg.text);
  if (!parsed) return;

  const chatId = String(msg.chat.id);
  switch (parsed.cmd) {
    case 'list':
      await handleList(config.telegramBotToken, chatId);
      return;
    case 'subscribe':
      await handleSubscribe(config.telegramBotToken, chatId, parsed.args);
      return;
    case 'unsubscribe':
      await handleUnsubscribe(config.telegramBotToken, chatId, parsed.args);
      return;
    case 'check':
      await handleCheck(config.telegramBotToken, chatId, config.githubToken, parsed.args);
      return;
    case 'translate':
      await handleTranslate(config, chatId, parsed.args);
      return;
    case 'aihealth':
      await handleAiHealth(config, chatId, parsed.args);
      return;
    case 'status':
      await handleStatusCmd(config, chatId, parsed.args);
      return;
    case 'start':
    case 'help':
      await sendMessage(
        config.telegramBotToken,
        chatId,
        '<b>Commands</b>\n<code>/list</code>\n<code>/subscribe owner/repo</code>\n<code>/unsubscribe owner/repo</code>\n<code>/check</code>\n<code>/translate text</code>\n<code>/aihealth</code>\n<code>/status</code>',
        { parse_mode: 'HTML', disable_web_page_preview: true },
      );
      return;
    default:
      return;
  }
}

export async function runTelegramCommandLoop(
  config: AppConfig,
  isRunning: () => boolean,
): Promise<void> {
  const enabled = (process.env.TELEGRAM_COMMANDS || '1').trim();
  if (enabled === '0' || enabled.toLowerCase() === 'false') {
    console.log('[TG] Commands disabled (TELEGRAM_COMMANDS=0)');
    return;
  }

  const botToken = config.telegramBotToken;
  const state = loadTelegramBotState();
  let offset = state.updateOffset;

  // getUpdates only works when webhook is disabled.
  await deleteWebhook(botToken, false);

  await setMyCommands(botToken, [
    { command: 'list', description: 'List subscriptions' },
    { command: 'subscribe', description: 'Subscribe repo (owner/repo or URL)' },
    { command: 'unsubscribe', description: 'Unsubscribe repo' },
    { command: 'check', description: 'Show latest versions' },
    { command: 'translate', description: 'Translate text to TARGET_LANG' },
    { command: 'aihealth', description: 'Ping AI_BASE_URL (OpenAI compatible)' },
    { command: 'status', description: 'Compare local compose vs GitHub' },
    { command: 'help', description: 'Show help' },
  ]);

  console.log('[TG] Command loop started');

  while (isRunning()) {
    const updates = await getUpdates(botToken, offset, 30);
    if (updates.length === 0) {
      await sleep(250);
      continue;
    }

    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      await handleUpdate(u, config);
    }

    saveTelegramBotState({ updateOffset: offset });
  }

  saveTelegramBotState({ updateOffset: offset });
  console.log('[TG] Command loop stopped');
}
