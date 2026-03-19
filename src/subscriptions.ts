import type { SubscribeMode, Subscription } from './types.js';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_SUBSCRIPTIONS_PATH = resolve(
  import.meta.dirname,
  '..',
  'data',
  'subscriptions.json',
);

const VALID_MODES = new Set<SubscribeMode>(['release', 'tag', 'commit', 'pr-merge']);
const REPO_PART_RE = /^[A-Za-z0-9_.-]+$/;

export function subscriptionKey(repo: string): string {
  // Telegram callback_data max is 64 bytes, so keep this short and deterministic.
  return createHash('sha256')
    .update(repo.toLowerCase())
    .digest('hex')
    .slice(0, 12);
}

export function resolveSubscriptionsPath(): string {
  return process.env.SUBSCRIPTIONS_PATH || DEFAULT_SUBSCRIPTIONS_PATH;
}

export function parseSubscriptionsEnv(envRepos: string): Subscription[] {
  const entries = envRepos
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    console.info('[Subs] SUBSCRIBE_REPOS is empty. No default subscriptions loaded from env.');
    return [];
  }

  const subs: Subscription[] = [];
  for (const entry of entries) {
    const sub = parseSubscriptionInput(entry);
    if (!sub) {
      console.warn(`[Subs] Ignored invalid repo entry in SUBSCRIBE_REPOS: ${entry}`);
      continue;
    }
    subs.push(sub);
  }

  if (subs.length === 0) {
    throw new Error('SUBSCRIBE_REPOS has no valid repos. Fix the entries and try again.');
  }

  return dedupeAndSort(subs);
}

export function tryLoadSubscriptionsFromEnv(): Subscription[] {
  const envRepos = process.env.SUBSCRIBE_REPOS;
  if (envRepos == null) return [];
  return parseSubscriptionsEnv(envRepos);
}

export function parseSubscriptionInput(inputRaw: string): Subscription | null {
  const input = inputRaw.trim();
  if (!input) return null;

  // Allow: git@github.com:owner/repo(.git)
  if (input.startsWith('git@github.com:')) {
    const rest = input.slice('git@github.com:'.length);
    const repo = rest.endsWith('.git') ? rest.slice(0, -4) : rest;
    const normalized = normalizeRepo(repo);
    if (!normalized) return null;
    return { repo: normalized, mode: 'release' };
  }

  // Allow: https://github.com/owner/repo(/...)
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const url = new URL(input);
      const host = url.hostname.toLowerCase();
      if (host !== 'github.com' && host !== 'www.github.com') return null;

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const owner = parts[0]!;
      let repo = parts[1]!;
      if (repo.endsWith('.git')) repo = repo.slice(0, -4);
      const normalized = normalizeRepo(`${owner}/${repo}`);
      if (!normalized) return null;
      return { repo: normalized, mode: 'release' };
    } catch {
      return null;
    }
  }

  // Allow: owner/repo[:mode]
  const colonIdx = input.lastIndexOf(':');
  if (colonIdx !== -1) {
    const maybeRepo = input.slice(0, colonIdx);
    const maybeMode = input.slice(colonIdx + 1);
    if (VALID_MODES.has(maybeMode as SubscribeMode)) {
      const normalized = normalizeRepo(maybeRepo);
      if (!normalized) return null;
      return { repo: normalized, mode: maybeMode as SubscribeMode };
    }
  }

  const normalized = normalizeRepo(input);
  if (!normalized) return null;
  return { repo: normalized, mode: 'release' };
}

export function normalizeRepo(repoRaw: string): string | null {
  const repo = repoRaw.trim().replace(/^\/+|\/+$/g, '');
  if (!repo) return null;

  const parts = repo.split('/');
  if (parts.length !== 2) return null;

  const owner = parts[0]!.trim();
  const name = parts[1]!.trim();
  if (!owner || !name) return null;
  if (!REPO_PART_RE.test(owner) || !REPO_PART_RE.test(name)) return null;

  return `${owner}/${name}`;
}

function sanitizeSubscription(candidate: unknown): Subscription | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const maybe = candidate as Partial<Subscription>;
  if (typeof maybe.repo !== 'string') return null;
  const repo = normalizeRepo(maybe.repo);
  if (!repo) return null;
  const mode = (maybe.mode || 'release') as SubscribeMode;
  if (!VALID_MODES.has(mode)) return null;
  return { repo, mode };
}

export function loadSubscriptionsFile(
  path = resolveSubscriptionsPath(),
): Subscription[] {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    // Accept: ["owner/repo", "owner/repo:tag"] or [{repo,mode}]
    if (Array.isArray(parsed)) {
      const subs: Subscription[] = [];
      for (const entry of parsed) {
        if (typeof entry === 'string') {
          const sub = parseSubscriptionInput(entry);
          if (sub) subs.push(sub);
          continue;
        }
        const sub = sanitizeSubscription(entry);
        if (sub) subs.push(sub);
      }
      return dedupeAndSort(subs);
    }

    // Accept: { subscriptions: [...] } or { repos: [...] }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const maybe = obj.subscriptions ?? obj.repos;
      if (Array.isArray(maybe)) {
        const subs: Subscription[] = [];
        for (const entry of maybe) {
          if (typeof entry === 'string') {
            const sub = parseSubscriptionInput(entry);
            if (sub) subs.push(sub);
            continue;
          }
          const sub = sanitizeSubscription(entry);
          if (sub) subs.push(sub);
        }
        return dedupeAndSort(subs);
      }
    }

    console.warn(`[Subs] Invalid subscriptions file format: ${path}`);
    return [];
  } catch (e) {
    // Missing file is fine; other errors should not crash the daemon.
    if ((e as { code?: string } | null)?.code !== 'ENOENT') {
      console.warn(`[Subs] Failed to read subscriptions file: ${path}`, e);
    }
    return [];
  }
}

export function saveSubscriptionsFile(
  subs: Subscription[],
  path = resolveSubscriptionsPath(),
): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const payload = JSON.stringify(dedupeAndSort(subs), null, 2);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, `${payload}\n`);
  renameSync(tmpPath, path);
}

export function upsertSubscription(
  subs: Subscription[],
  sub: Subscription,
): Subscription[] {
  const next = subs.filter((s) => s.repo.toLowerCase() !== sub.repo.toLowerCase());
  next.push(sub);
  return dedupeAndSort(next);
}

export function removeSubscription(
  subs: Subscription[],
  repoRaw: string,
): { next: Subscription[]; removed: boolean } {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return { next: subs, removed: false };
  const before = subs.length;
  const next = subs.filter((s) => s.repo.toLowerCase() !== repo.toLowerCase());
  return { next: dedupeAndSort(next), removed: next.length !== before };
}

export function dedupeAndSort(subs: Subscription[]): Subscription[] {
  const map = new Map<string, Subscription>();
  for (const sub of subs) {
    map.set(sub.repo.toLowerCase(), sub);
  }
  return [...map.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}
