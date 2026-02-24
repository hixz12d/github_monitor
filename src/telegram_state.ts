import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TelegramBotState {
  updateOffset: number;
}

const STATE_PATH = resolve(import.meta.dirname, '..', 'data', 'telegram.json');

export function loadTelegramBotState(): TelegramBotState {
  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TelegramBotState>;
    const updateOffset = typeof parsed.updateOffset === 'number' ? parsed.updateOffset : 0;
    return { updateOffset };
  } catch {
    return { updateOffset: 0 };
  }
}

export function saveTelegramBotState(state: TelegramBotState): void {
  mkdirSync(resolve(STATE_PATH, '..'), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

