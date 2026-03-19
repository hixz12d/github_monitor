import 'dotenv/config';
import { loadConfig, loadSubscriptions } from './config.js';
import {
  loadState,
  saveState,
  checkRepo,
  checkRepoTags,
  checkRepoCommits,
  checkRepoPrMerges,
  getCompareCommits,
  getTagCommits,
  getCommitDate,
} from './github.js';
import { createAIClient, categorizeRelease } from './ai.js';
import {
  splitMessages,
  formatCommitMessages,
  formatPrMergeMessages,
} from './formatter.js';
import { sendMessage } from './telegram.js';
import { setupLogging } from './logger.js';
import type { AppState, CategorizedRelease, Subscription, GitHubRelease } from './types.js';

// Single-run entry point for GitHub Actions (no cron loop)
setupLogging();

const config = loadConfig();
let model: ReturnType<typeof createAIClient> | null = null;

function subscriptionNeedsAi(sub: Subscription): boolean {
  return sub.mode === 'release' || sub.mode === 'tag';
}

function getModel(): ReturnType<typeof createAIClient> {
  if (!config.aiApiKey) {
    throw new Error('Missing required env: AI_API_KEY. Required for release translation/categorization.');
  }

  model ??= createAIClient(config);
  return model;
}

if (!config.githubToken) {
  console.info(
    '[Tip] GITHUB_TOKEN not set. Using unauthenticated GitHub API (60 req/hr).',
  );
}

async function processReleaseRepo(
  repo: string,
  state: AppState,
): Promise<void> {
  const aiModel = getModel();
  const result = await checkRepo(repo, config.githubToken, state);
  const now = new Date().toISOString();

  if (result.newReleases.length === 0) {
    console.log(`[${repo}] No new releases`);
    if (result.etag && result.etag !== state[repo]?.etag) {
      state[repo] = {
        lastRelease: state[repo]?.lastRelease,
        lastReleaseDate: state[repo]?.lastReleaseDate,
        etag: result.etag,
        lastCheck: now,
      };
    }
    return;
  }

  console.log(
    `[${repo}] Found ${result.newReleases.length} new release(s)`,
  );

  const categorized: CategorizedRelease[] = [];
  for (const release of result.newReleases) {
    categorized.push(
      await categorizeRelease(aiModel, release, config.timezone, config.targetLang),
    );
  }

  const messages = splitMessages(repo, categorized, config.targetLang);

  for (const msg of messages) {
    const ok = await sendMessage(
      config.telegramBotToken,
      config.telegramChatId,
      msg,
    );
    if (!ok) {
      console.error(`[${repo}] Failed to send Telegram message`);
      return;
    }
  }

  state[repo] = {
    lastRelease: result.newReleases[0].tag_name,
    lastReleaseDate: result.newReleases[0].published_at,
    etag: result.etag,
    lastCheck: now,
  };
  console.log(`[${repo}] Notified, latest: ${state[repo].lastRelease}`);
}

async function processTagRepo(
  repo: string,
  state: AppState,
): Promise<void> {
  const aiModel = getModel();
  const key = `${repo}:tag`;
  const result = await checkRepoTags(repo, config.githubToken, state);
  const now = new Date().toISOString();

  if (result.newTags.length === 0) {
    console.log(`[${repo}:tag] No new tags`);
    if (result.etag && result.etag !== state[key]?.etag) {
      state[key] = {
        lastTag: state[key]?.lastTag,
        lastTagDate: state[key]?.lastTagDate,
        etag: result.etag,
        lastCheck: now,
      };
    }
    return;
  }

  console.log(
    `[${repo}:tag] Found ${result.newTags.length} new tag(s)`,
  );

  const prevTag = state[key]?.lastTag;
  const categorized: CategorizedRelease[] = [];

  for (const tag of [...result.newTags].reverse()) {
    let commits;
    if (prevTag || categorized.length > 0) {
      const base = categorized.length > 0
        ? result.newTags[result.newTags.length - categorized.length]?.name ?? prevTag!
        : prevTag!;
      commits = await getCompareCommits(
        repo, base, tag.name, config.githubToken,
      );
    } else {
      // First run: no previous tag, fetch recent commits for this tag
      commits = await getTagCommits(repo, tag.name, config.githubToken);
    }
    const body = commits.map((c) => c.commit.message).join('\n');
    const tagDate = await getCommitDate(repo, tag.commit.sha, config.githubToken);

    const pseudoRelease: GitHubRelease = {
      tag_name: tag.name,
      name: tag.name,
      body,
      html_url: `https://github.com/${repo}/releases/tag/${tag.name}`,
      published_at: tagDate ?? now,
      draft: false,
      prerelease: false,
    };

    categorized.push(
      await categorizeRelease(aiModel, pseudoRelease, config.timezone, config.targetLang),
    );
  }

  categorized.reverse();
  const messages = splitMessages(repo, categorized, config.targetLang);

  for (const msg of messages) {
    const ok = await sendMessage(
      config.telegramBotToken,
      config.telegramChatId,
      msg,
    );
    if (!ok) {
      console.error(`[${repo}:tag] Failed to send Telegram message`);
      return;
    }
  }

  const latestTagDate = await getCommitDate(repo, result.newTags[0].commit.sha, config.githubToken);
  state[key] = {
    lastTag: result.newTags[0].name,
    lastTagDate: latestTagDate ?? now,
    etag: result.etag,
    lastCheck: now,
  };
  console.log(`[${repo}:tag] Notified, latest: ${state[key].lastTag}`);
}

async function processCommitRepo(
  repo: string,
  state: AppState,
): Promise<void> {
  const key = `${repo}:commit`;
  const result = await checkRepoCommits(repo, config.githubToken, state);
  const now = new Date().toISOString();

  if (result.newCommits.length === 0) {
    console.log(`[${repo}:commit] No new commits`);
    if (result.etag && result.etag !== state[key]?.etag) {
      state[key] = {
        lastCommitSha: state[key]?.lastCommitSha,
        lastCommitDate: state[key]?.lastCommitDate,
        etag: result.etag,
        lastCheck: now,
      };
    }
    return;
  }

  console.log(
    `[${repo}:commit] Found ${result.newCommits.length} new commit(s)`,
  );

  const messages = formatCommitMessages(repo, result.newCommits);
  for (const msg of messages) {
    const ok = await sendMessage(
      config.telegramBotToken,
      config.telegramChatId,
      msg,
    );
    if (!ok) {
      console.error(`[${repo}:commit] Failed to send Telegram message`);
      return;
    }
  }

  const latest = result.newCommits[0] ?? result.latestCommit;
  if (!latest) return;

  state[key] = {
    lastCommitSha: latest.sha,
    lastCommitDate: latest.commit.author?.date ?? now,
    etag: result.etag,
    lastCheck: now,
  };
  console.log(`[${repo}:commit] Notified, latest: ${latest.sha.slice(0, 7)}`);
}

async function processPrMergeRepo(
  repo: string,
  state: AppState,
): Promise<void> {
  const key = `${repo}:pr-merge`;
  const result = await checkRepoPrMerges(repo, config.githubToken, state);
  const now = new Date().toISOString();

  if (result.newPrs.length === 0) {
    console.log(`[${repo}:pr-merge] No new merged PRs`);
    if (result.etag && result.etag !== state[key]?.etag) {
      state[key] = {
        lastMergedPrNumber: state[key]?.lastMergedPrNumber,
        lastMergedPrDate: state[key]?.lastMergedPrDate,
        etag: result.etag,
        lastCheck: now,
      };
    }
    return;
  }

  console.log(
    `[${repo}:pr-merge] Found ${result.newPrs.length} new merged PR(s)`,
  );

  const messages = formatPrMergeMessages(repo, result.newPrs);
  for (const msg of messages) {
    const ok = await sendMessage(
      config.telegramBotToken,
      config.telegramChatId,
      msg,
    );
    if (!ok) {
      console.error(`[${repo}:pr-merge] Failed to send Telegram message`);
      return;
    }
  }

  const latest = result.newPrs[0] ?? result.latestMergedPr;
  if (!latest) return;

  state[key] = {
    lastMergedPrNumber: latest.number,
    lastMergedPrDate: latest.merged_at ?? now,
    etag: result.etag,
    lastCheck: now,
  };
  console.log(`[${repo}:pr-merge] Notified, latest: #${latest.number}`);
}

async function processRepo(
  sub: Subscription,
  state: AppState,
): Promise<void> {
  switch (sub.mode) {
    case 'tag':
      await processTagRepo(sub.repo, state);
      return;
    case 'commit':
      await processCommitRepo(sub.repo, state);
      return;
    case 'pr-merge':
      await processPrMergeRepo(sub.repo, state);
      return;
    default:
      await processReleaseRepo(sub.repo, state);
      return;
  }
}

async function run(): Promise<void> {
  const subs = loadSubscriptions();
  if (subs.some(subscriptionNeedsAi) && !config.aiApiKey) {
    throw new Error('Missing required env: AI_API_KEY. Required for release/tag monitoring.');
  }
  console.log(
    `[Check] ${new Date().toISOString()} — ${subs.length} subscription(s)`,
  );

  const start = Date.now();
  const state = loadState();
  let failed = 0;

  for (const sub of subs) {
    try {
      await processRepo(sub, state);
    } catch (e) {
      console.error(`[${sub.repo}:${sub.mode}] Unexpected error:`, e);
      failed++;
    }
  }

  saveState(state);
  console.log(
    `[Check] Done in ${Date.now() - start}ms. Subscriptions: ${subs.length}, failed: ${failed}`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

run();
