import { validateCronExpression } from 'cron';
import type { AIProvider, AppConfig, Subscription } from './types.js';
import { existsSync } from 'node:fs';
import { loadSubscriptionsFile, resolveSubscriptionsPath, tryLoadSubscriptionsFromEnv } from './subscriptions.js';
const VALID_PROVIDERS = new Set<AIProvider>(['openai-completions', 'openai-responses', 'google', 'anthropic']);

function requiredEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env: ${key}`);
  return val;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(
      `Invalid TIMEZONE: ${timezone}. Use IANA timezone names like Asia/Shanghai, UTC, America/New_York`,
    );
  }
}

export function loadConfig(): AppConfig {
  const provider = (process.env.AI_PROVIDER || 'openai-completions') as AIProvider;
  const timezone = process.env.TIMEZONE || process.env.TZ || 'Asia/Shanghai';
  const cron = process.env.CRON;
  const aiModel = process.env.AI_MODEL || 'gpt-4o-mini';

  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(
      `Invalid AI_PROVIDER: ${provider}. Must be one of: openai-completions, openai-responses, google, anthropic`,
    );
  }

  validateTimezone(timezone);

  if (cron) {
    const cronValidation = validateCronExpression(cron);
    if (!cronValidation.valid) {
      throw new Error(`Invalid CRON: ${cron}. ${cronValidation.error}`);
    }
  }

  return {
    githubToken: process.env.GITHUB_TOKEN || undefined,
    telegramBotToken: requiredEnv('TELEGRAM_BOT_TOKEN'),
    telegramChatId: requiredEnv('TELEGRAM_CHAT_ID'),
    aiProvider: provider,
    aiBaseUrl: process.env.AI_BASE_URL || undefined,
    aiApiKey: requiredEnv('AI_API_KEY'),
    aiModel,
    cron,
    timezone,
    targetLang: process.env.TARGET_LANG || 'English',
  };
}

export function loadSubscriptions(): Subscription[] {
  const path = resolveSubscriptionsPath();
  if (existsSync(path)) {
    return loadSubscriptionsFile(path);
  }

  const subs = tryLoadSubscriptionsFromEnv();
  if (subs.length === 0) {
    const msg = 'No subscriptions configured. Use SUBSCRIBE_REPOS or create data/subscriptions.json (or set SUBSCRIPTIONS_PATH).';
    if ((process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true') {
      throw new Error(`[Subs] ${msg}`);
    }
    console.warn(`[Subs] ${msg}`);
  }
  return subs;
}
