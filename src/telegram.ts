const TG_API = 'https://api.telegram.org';
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type TelegramParseMode = 'HTML' | 'MarkdownV2';

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  parse_mode?: TelegramParseMode;
  disable_web_page_preview?: boolean;
  reply_markup?: InlineKeyboardMarkup;
}

export interface TelegramChat {
  id: number;
  type: string;
  username?: string;
  title?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  date?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramChatMember {
  status?: string;
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  old_chat_member?: TelegramChatMember;
  new_chat_member?: TelegramChatMember;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
}

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string };

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramApiResponse<T> | null> {
  const url = `${TG_API}/bot${botToken}/${method}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let data: TelegramApiResponse<T> | null = null;
      try {
        data = JSON.parse(text) as TelegramApiResponse<T>;
      } catch {
        data = null;
      }

      if (res.ok && data) return data;

      const description = data && 'description' in data ? data.description : text;
      console.error(
        `[TG] ${method} attempt ${attempt}/${MAX_RETRIES} failed: ${res.status} ${description}`,
      );
    } catch (e) {
      console.error(`[TG] ${method} attempt ${attempt}/${MAX_RETRIES} error:`, e);
    }

    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY);
  }

  return null;
}

export async function sendMessage(
  botToken: string,
  chatId: string,
  html: string,
  options: SendMessageOptions = {},
): Promise<boolean> {
  const parseMode = options.parse_mode || 'HTML';
  const disablePreview = options.disable_web_page_preview ?? true;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: parseMode,
    disable_web_page_preview: disablePreview,
  };
  if (options.reply_markup) payload.reply_markup = options.reply_markup;

  const res = await callTelegramApi<TelegramMessage>(botToken, 'sendMessage', payload);
  return Boolean(res?.ok);
}

export async function editMessageText(
  botToken: string,
  chatId: string,
  messageId: number,
  html: string,
  options: SendMessageOptions = {},
): Promise<boolean> {
  const parseMode = options.parse_mode || 'HTML';
  const disablePreview = options.disable_web_page_preview ?? true;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: parseMode,
    disable_web_page_preview: disablePreview,
  };
  if (options.reply_markup) payload.reply_markup = options.reply_markup;

  const res = await callTelegramApi<TelegramMessage>(botToken, 'editMessageText', payload);
  return Boolean(res?.ok);
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
  };
  if (text) payload.text = text;
  if (showAlert) payload.show_alert = true;

  const res = await callTelegramApi<boolean>(botToken, 'answerCallbackQuery', payload);
  return Boolean(res?.ok);
}

export async function getUpdates(
  botToken: string,
  offset: number,
  timeoutSec: number,
): Promise<TelegramUpdate[]> {
  const payload: Record<string, unknown> = {
    offset,
    timeout: timeoutSec,
    allowed_updates: ['message', 'channel_post', 'callback_query', 'my_chat_member'],
  };

  const res = await callTelegramApi<TelegramUpdate[]>(botToken, 'getUpdates', payload);
  if (!res) return [];
  if (!res.ok) {
    console.error(`[TG] getUpdates error: ${res.error_code} ${res.description}`);
    return [];
  }
  return res.result;
}

export async function deleteWebhook(
  botToken: string,
  dropPendingUpdates = false,
): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (dropPendingUpdates) payload.drop_pending_updates = true;

  const res = await callTelegramApi<boolean>(botToken, 'deleteWebhook', payload);
  return Boolean(res?.ok);
}

export interface BotCommand {
  command: string;
  description: string;
}

export async function setMyCommands(
  botToken: string,
  commands: BotCommand[],
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    commands,
  };
  const res = await callTelegramApi<boolean>(botToken, 'setMyCommands', payload);
  return Boolean(res?.ok);
}

export async function getMe(
  botToken: string,
): Promise<TelegramApiResponse<TelegramUser> | null> {
  return await callTelegramApi<TelegramUser>(botToken, 'getMe', {});
}
