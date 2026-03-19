export type SubscribeMode = 'release' | 'tag' | 'commit' | 'pr-merge';

export interface Subscription {
  repo: string;
  mode: SubscribeMode;
}

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

export interface GitHubTag {
  name: string;
  commit: { sha: string; url: string };
}

export interface GitHubCompareCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  html_url: string;
}

export interface GitHubCommitSimple {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  html_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
}

export interface CheckResult {
  repo: string;
  newReleases: GitHubRelease[];
  etag: string | null;
}

export interface TagCheckResult {
  repo: string;
  newTags: GitHubTag[];
  etag: string | null;
}

export interface CommitCheckResult {
  repo: string;
  newCommits: GitHubCommitSimple[];
  etag: string | null;
  latestCommit?: GitHubCommitSimple | null;
}

export interface PrMergeCheckResult {
  repo: string;
  newPrs: GitHubPullRequest[];
  etag: string | null;
  latestMergedPr?: GitHubPullRequest | null;
}

export interface RepoState {
  lastRelease?: string;
  lastReleaseDate?: string;
  lastTag?: string;
  lastTagDate?: string;
  lastCommitSha?: string;
  lastCommitDate?: string;
  lastMergedPrNumber?: number;
  lastMergedPrDate?: string;
  etag: string | null;
  lastCheck: string;
}

export type AppState = Record<string, RepoState>;

export interface CategorizedRelease {
  tag: string;
  date: string;
  url: string;
  categories: CategoryGroup[];
}

export interface CategoryGroup {
  type: CategoryType;
  items: string[];
}

export type CategoryType =
  | 'feat'
  | 'fix'
  | 'perf'
  | 'refactor'
  | 'docs'
  | 'other';

export const CATEGORY_EMOJI: Record<CategoryType, string> = {
  feat: '✨',
  fix: '🐛',
  perf: '⚡',
  refactor: '♻️',
  docs: '📝',
  other: '📌',
};

const CATEGORY_LABELS: Record<string, Record<CategoryType, string>> = {
  English: {
    feat: 'Features', fix: 'Bug Fixes', perf: 'Performance',
    refactor: 'Refactoring', docs: 'Documentation', other: 'Other',
  },
  Chinese: {
    feat: '新功能', fix: '修复', perf: '优化',
    refactor: '重构', docs: '文档', other: '其他',
  },
  Japanese: {
    feat: '新機能', fix: '修正', perf: '最適化',
    refactor: 'リファクタリング', docs: 'ドキュメント', other: 'その他',
  },
};

export function getCategoryMeta(
  type: CategoryType,
  lang: string,
): { emoji: string; label: string } {
  const labels = CATEGORY_LABELS[lang] ?? CATEGORY_LABELS['English'];
  return { emoji: CATEGORY_EMOJI[type], label: labels[type] };
}

export type AIProvider = 'openai-completions' | 'openai-responses' | 'google' | 'anthropic';

export interface AppConfig {
  githubToken?: string;
  telegramBotToken: string;
  telegramChatId: string;
  aiProvider: AIProvider;
  aiBaseUrl?: string;
  aiApiKey: string;
  aiModel: string;
  cron?: string;
  timezone: string;
  targetLang: string;
}
