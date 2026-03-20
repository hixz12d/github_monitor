import type {
  GitHubRelease,
  GitHubTag,
  GitHubCompareCommit,
  GitHubCommitSimple,
  GitHubPullRequest,
  AppState,
  CheckResult,
  TagCheckResult,
  CommitCheckResult,
  PrMergeCheckResult,
  Subscription,
} from './types.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_PATH = resolve(import.meta.dirname, '..', 'data', 'state.json');
const API_BASE = 'https://api.github.com';
const MAX_TAG_COMMITS = 50;

export function stateKey(sub: Subscription): string {
  switch (sub.mode) {
    case 'release':
      return sub.repo;
    case 'tag':
    case 'commit':
    case 'pr-merge':
      return `${sub.repo}:${sub.mode}`;
  }
}

function buildHeaders(
  token: string | undefined,
  etag: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (etag) headers['If-None-Match'] = etag;
  return headers;
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; status: number; data: T; etag: string | null } | { ok: false; status: number; etag: string | null }> {
  const res = await fetch(url, { headers });
  if (res.status === 403) {
    const resetAt = res.headers.get('x-ratelimit-reset');
    if (resetAt) {
      const waitMs = Number(resetAt) * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[GitHub] Rate limited, reset in ${Math.ceil(waitMs / 1000)}s`,
        );
      }
    }
    return { ok: false, status: 403, etag: res.headers.get('etag') };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, etag: res.headers.get('etag') };
  }

  const etag = res.headers.get('etag');
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, data, etag };
}

export function loadState(): AppState {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    console.log(`[State] Loaded ${Object.keys(state).length} repo(s)`);
    return state;
  } catch {
    console.log('[State] No existing state, starting fresh');
    return {};
  }
}

export function saveState(state: AppState): void {
  mkdirSync(resolve(STATE_PATH, '..'), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`[State] Saved ${Object.keys(state).length} repo(s)`);
}

export async function checkRepo(
  repo: string,
  token: string | undefined,
  state: AppState,
): Promise<CheckResult> {
  const repoState = state[repo];
  const headers = buildHeaders(token, repoState?.etag);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/releases?per_page=30`,
    { headers },
  );

  if (res.status === 304) {
    return { repo, newReleases: [], etag: repoState?.etag ?? null };
  }

  if (res.status === 403) {
    const resetAt = res.headers.get('x-ratelimit-reset');
    if (resetAt) {
      const waitMs = Number(resetAt) * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[${repo}] Rate limited, reset in ${Math.ceil(waitMs / 1000)}s`,
        );
      }
    }
    return { repo, newReleases: [], etag: repoState?.etag ?? null };
  }

  if (!res.ok) {
    console.error(`[${repo}] GitHub API error: ${res.status}`);
    return { repo, newReleases: [], etag: repoState?.etag ?? null };
  }

  const etag = res.headers.get('etag');
  const releases = (await res.json()) as GitHubRelease[];

  const published = releases.filter((r) => !r.draft);

  if (!repoState?.lastRelease) {
    // First run: silently initialize baseline without notifying.
    const latest = published[0];
    if (latest) {
      const now = new Date().toISOString();
      state[repo] = {
        lastRelease: latest.tag_name,
        lastReleaseDate: latest.published_at,
        etag,
        lastCheck: now,
      };
      console.log(
        `[${repo}] Baseline initialized at ${latest.tag_name}`,
      );
    }
    return { repo, newReleases: [], etag };
  }

  const newReleases: GitHubRelease[] = [];
  let sentinelFound = false;
  for (const r of published) {
    if (r.tag_name === repoState.lastRelease) {
      sentinelFound = true;
      break;
    }
    newReleases.push(r);
  }

  // Sentinel missing (deleted release): filter by time
  if (!sentinelFound && newReleases.length > 0) {
    const cutoff = repoState.lastReleaseDate ?? repoState.lastCheck;
    console.warn(
      `[${repo}] Last release "${repoState.lastRelease}" not found in API response, using time cutoff: ${cutoff}`,
    );
    const filtered = newReleases.filter(
      (r) => new Date(r.published_at) > new Date(cutoff),
    );
    return { repo, newReleases: filtered, etag };
  }
  return { repo, newReleases, etag };
}

export async function checkRepoTags(
  repo: string,
  token: string | undefined,
  state: AppState,
): Promise<TagCheckResult> {
  const key = `${repo}:tag`;
  const repoState = state[key];
  const headers = buildHeaders(token, repoState?.etag);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/tags?per_page=30`,
    { headers },
  );

  if (res.status === 304) {
    return { repo, newTags: [], etag: repoState?.etag ?? null };
  }

  if (res.status === 403) {
    const resetAt = res.headers.get('x-ratelimit-reset');
    if (resetAt) {
      const waitMs = Number(resetAt) * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[${repo}] Rate limited, reset in ${Math.ceil(waitMs / 1000)}s`,
        );
      }
    }
    return { repo, newTags: [], etag: repoState?.etag ?? null };
  }

  if (!res.ok) {
    console.error(`[${repo}] GitHub API error: ${res.status}`);
    return { repo, newTags: [], etag: repoState?.etag ?? null };
  }

  const etag = res.headers.get('etag');
  const tags = (await res.json()) as GitHubTag[];

  if (!repoState?.lastTag) {
    // First run: silently initialize baseline without notifying.
    const latest = tags[0];
    if (latest) {
      const tagDate = await getCommitDate(repo, latest.commit.sha, token);
      const now = new Date().toISOString();
      state[key] = {
        lastTag: latest.name,
        lastTagDate: tagDate ?? now,
        etag,
        lastCheck: now,
      };
      console.log(
        `[${repo}:tag] Baseline initialized at ${latest.name}`,
      );
    }
    return { repo, newTags: [], etag };
  }

  const newTags: GitHubTag[] = [];
  let sentinelFound = false;
  for (const t of tags) {
    if (t.name === repoState.lastTag) {
      sentinelFound = true;
      break;
    }
    newTags.push(t);
  }

  // Sentinel missing (deleted tag): filter by commit date
  if (!sentinelFound && newTags.length > 0) {
    const cutoff = repoState.lastTagDate ?? repoState.lastCheck;
    console.warn(
      `[${repo}] Last tag "${repoState.lastTag}" not found in API response, using time cutoff: ${cutoff}`,
    );
    const cutoffTime = new Date(cutoff).getTime();
    const filtered: GitHubTag[] = [];
    for (const t of newTags) {
      const dateStr = await getCommitDate(repo, t.commit.sha, token);
      if (!dateStr) continue;
      if (new Date(dateStr).getTime() <= cutoffTime) break;
      filtered.push(t);
    }
    return { repo, newTags: filtered, etag };
  }
  return { repo, newTags, etag };
}

export async function checkRepoCommits(
  repo: string,
  token: string | undefined,
  state: AppState,
): Promise<CommitCheckResult> {
  const key = `${repo}:commit`;
  const repoState = state[key];
  const headers = buildHeaders(token, repoState?.etag);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/commits?per_page=30`,
    { headers },
  );

  if (res.status === 304) {
    return {
      repo,
      newCommits: [],
      etag: repoState?.etag ?? null,
      latestCommit: null,
    };
  }

  if (res.status === 403) {
    const resetAt = res.headers.get('x-ratelimit-reset');
    if (resetAt) {
      const waitMs = Number(resetAt) * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[${repo}] Rate limited, reset in ${Math.ceil(waitMs / 1000)}s`,
        );
      }
    }
    return {
      repo,
      newCommits: [],
      etag: repoState?.etag ?? null,
      latestCommit: null,
    };
  }

  if (!res.ok) {
    console.error(`[${repo}] GitHub API error: ${res.status}`);
    return {
      repo,
      newCommits: [],
      etag: repoState?.etag ?? null,
      latestCommit: null,
    };
  }

  const etag = res.headers.get('etag');
  const commits = (await res.json()) as GitHubCommitSimple[];
  const latestCommit = commits[0] ?? null;

  if (!repoState?.lastCommitSha) {
    if (latestCommit) {
      const now = new Date().toISOString();
      state[key] = {
        lastCommitSha: latestCommit.sha,
        lastCommitDate: latestCommit.commit.author?.date ?? now,
        etag,
        lastCheck: now,
      };
      console.log(
        `[${repo}:commit] Baseline initialized at ${latestCommit.sha.slice(0, 7)}`,
      );
    }
    return { repo, newCommits: [], etag, latestCommit };
  }

  const newCommits: GitHubCommitSimple[] = [];
  let sentinelFound = false;
  for (const commit of commits) {
    if (commit.sha === repoState.lastCommitSha) {
      sentinelFound = true;
      break;
    }
    newCommits.push(commit);
  }

  if (!sentinelFound && newCommits.length > 0) {
    const cutoff = repoState.lastCommitDate ?? repoState.lastCheck;
    console.warn(
      `[${repo}] Last commit "${repoState.lastCommitSha}" not found in API response, using time cutoff: ${cutoff}`,
    );
    const cutoffTime = new Date(cutoff).getTime();
    const filtered = newCommits.filter((commit) => {
      const date = commit.commit.author?.date;
      return date ? new Date(date).getTime() > cutoffTime : false;
    });
    return { repo, newCommits: filtered, etag, latestCommit };
  }

  return { repo, newCommits, etag, latestCommit };
}

export async function checkRepoPrMerges(
  repo: string,
  token: string | undefined,
  state: AppState,
): Promise<PrMergeCheckResult> {
  const key = `${repo}:pr-merge`;
  const repoState = state[key];
  const headers = buildHeaders(token, repoState?.etag);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    { headers },
  );

  if (res.status === 304) {
    return {
      repo,
      newPrs: [],
      etag: repoState?.etag ?? null,
      latestMergedPr: null,
    };
  }

  if (res.status === 403) {
    const resetAt = res.headers.get('x-ratelimit-reset');
    if (resetAt) {
      const waitMs = Number(resetAt) * 1000 - Date.now();
      if (waitMs > 0) {
        console.warn(
          `[${repo}] Rate limited, reset in ${Math.ceil(waitMs / 1000)}s`,
        );
      }
    }
    return {
      repo,
      newPrs: [],
      etag: repoState?.etag ?? null,
      latestMergedPr: null,
    };
  }

  if (!res.ok) {
    console.error(`[${repo}] GitHub API error: ${res.status}`);
    return {
      repo,
      newPrs: [],
      etag: repoState?.etag ?? null,
      latestMergedPr: null,
    };
  }

  const etag = res.headers.get('etag');
  const pulls = (await res.json()) as GitHubPullRequest[];
  const mergedPrs = pulls
    .filter((pr) => pr.merged_at)
    .sort((a, b) => {
      const aTime = new Date(a.merged_at ?? 0).getTime();
      const bTime = new Date(b.merged_at ?? 0).getTime();
      return bTime - aTime;
    });
  const latestMergedPr = mergedPrs[0] ?? null;

  if (repoState?.lastMergedPrNumber == null) {
    if (latestMergedPr) {
      const now = new Date().toISOString();
      state[key] = {
        lastMergedPrNumber: latestMergedPr.number,
        lastMergedPrDate: latestMergedPr.merged_at ?? now,
        etag,
        lastCheck: now,
      };
      console.log(
        `[${repo}:pr-merge] Baseline initialized at #${latestMergedPr.number}`,
      );
    }
    return { repo, newPrs: [], etag, latestMergedPr };
  }

  const newPrs: GitHubPullRequest[] = [];
  let sentinelFound = false;
  for (const pr of mergedPrs) {
    if (pr.number === repoState.lastMergedPrNumber) {
      sentinelFound = true;
      break;
    }
    const mergedAt = pr.merged_at ? new Date(pr.merged_at).getTime() : 0;
    const lastMergedAt = repoState.lastMergedPrDate
      ? new Date(repoState.lastMergedPrDate).getTime()
      : 0;
    const isNewerMerge = mergedAt > lastMergedAt
      || (mergedAt === lastMergedAt && pr.number > repoState.lastMergedPrNumber);
    if (isNewerMerge) {
      newPrs.push(pr);
    }
  }

  if (!sentinelFound && mergedPrs.length > 0) {
    const cutoff = repoState.lastMergedPrDate ?? repoState.lastCheck;
    console.warn(
      `[${repo}] Last merged PR "#${repoState.lastMergedPrNumber}" not found in API response, using time cutoff: ${cutoff}`,
    );
    const cutoffTime = new Date(cutoff).getTime();
    const filtered = mergedPrs.filter((pr) => {
      const mergedAt = pr.merged_at;
      return mergedAt ? new Date(mergedAt).getTime() > cutoffTime : false;
    });
    return { repo, newPrs: filtered, etag, latestMergedPr };
  }

  return { repo, newPrs, etag, latestMergedPr };
}

export async function getLatestReleaseTag(
  repo: string,
  token: string | undefined,
): Promise<string | null> {
  const headers = buildHeaders(token, undefined);
  const url = `${API_BASE}/repos/${repo}/releases/latest`;
  const res = await fetchJson<GitHubRelease>(url, headers);

  if (!res.ok) {
    // 404 means "no releases".
    if (res.status === 404) return null;
    console.error(`[${repo}] Latest release API error: ${res.status}`);
    return null;
  }

  // "latest" ignores prerelease/draft.
  return res.data.tag_name || null;
}

export async function getLatestTagName(
  repo: string,
  token: string | undefined,
): Promise<string | null> {
  const headers = buildHeaders(token, undefined);
  const url = `${API_BASE}/repos/${repo}/tags?per_page=1`;
  const res = await fetchJson<GitHubTag[]>(url, headers);

  if (!res.ok) {
    console.error(`[${repo}] Latest tag API error: ${res.status}`);
    return null;
  }

  return res.data[0]?.name ?? null;
}

export async function getCompareCommits(
  repo: string,
  base: string,
  head: string,
  token: string | undefined,
): Promise<GitHubCompareCommit[]> {
  const headers = buildHeaders(token, undefined);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/compare/${base}...${head}`,
    { headers },
  );

  if (!res.ok) {
    console.error(`[${repo}] Compare API error: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as { commits: GitHubCompareCommit[] };
  return data.commits.slice(-MAX_TAG_COMMITS);
}

export async function getTagCommits(
  repo: string,
  tag: string,
  token: string | undefined,
): Promise<GitHubCompareCommit[]> {
  const headers = buildHeaders(token, undefined);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/commits?sha=${encodeURIComponent(tag)}&per_page=${MAX_TAG_COMMITS}`,
    { headers },
  );

  if (!res.ok) {
    console.error(`[${repo}] Commits API error: ${res.status}`);
    return [];
  }

  return (await res.json()) as GitHubCompareCommit[];
}

export async function getCommitDate(
  repo: string,
  sha: string,
  token: string | undefined,
): Promise<string | null> {
  const headers = buildHeaders(token, undefined);

  const res = await fetch(
    `${API_BASE}/repos/${repo}/commits/${sha}`,
    { headers },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as GitHubCompareCommit;
  return data.commit.author?.date ?? null;
}
