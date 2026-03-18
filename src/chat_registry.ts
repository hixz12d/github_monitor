import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TelegramChat } from './telegram.js';

export interface DiscoveredChat {
  id: string;
  type: string;
  username?: string;
  title?: string;
  firstName?: string;
  lastName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sources: string[];
  lastCommand?: string;
  lastStartPayload?: string;
}

const DISCOVERED_CHATS_PATH = resolve(
  import.meta.dirname,
  '..',
  'data',
  'discovered_chats.json',
);

function loadDiscoveredChats(): DiscoveredChat[] {
  try {
    const raw = readFileSync(DISCOVERED_CHATS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as DiscoveredChat[] : [];
  } catch {
    return [];
  }
}

function saveDiscoveredChats(chats: DiscoveredChat[]): void {
  mkdirSync(resolve(DISCOVERED_CHATS_PATH, '..'), { recursive: true });
  const tmpPath = `${DISCOVERED_CHATS_PATH}.tmp`;
  const payload = JSON.stringify(chats, null, 2);
  writeFileSync(tmpPath, `${payload}\n`);
  renameSync(tmpPath, DISCOVERED_CHATS_PATH);
}

export function rememberChat(
  chat: TelegramChat,
  source: string,
  command?: string,
  startPayload?: string,
): DiscoveredChat {
  const chats = loadDiscoveredChats();
  const id = String(chat.id);
  const now = new Date().toISOString();
  const index = chats.findIndex((entry) => entry.id === id);
  const existing = index >= 0 ? chats[index] : undefined;

  const next: DiscoveredChat = {
    id,
    type: chat.type,
    username: chat.username || existing?.username,
    title: chat.title || existing?.title,
    firstName: chat.first_name || existing?.firstName,
    lastName: chat.last_name || existing?.lastName,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    sources: [...new Set([...(existing?.sources || []), source])].sort(),
    lastCommand: command || existing?.lastCommand,
    lastStartPayload: startPayload || existing?.lastStartPayload,
  };

  if (index >= 0) {
    chats[index] = next;
  } else {
    chats.push(next);
    console.log(`[TG] Discovered chat ${id} (${chat.type}) via ${source}`);
  }

  chats.sort((a, b) => a.id.localeCompare(b.id));
  saveDiscoveredChats(chats);
  return next;
}
