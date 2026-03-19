import {
  getCategoryMeta,
  type CategorizedRelease,
  type GitHubCommitSimple,
  type GitHubPullRequest,
} from './types.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatOneRelease(release: CategorizedRelease, targetLang: string): string {
  const lines: string[] = [];
  const tag = escapeHtml(release.tag);

  lines.push(
    `${release.date}  <a href="${release.url}">${tag}</a>`,
  );

  for (const cat of release.categories) {
    const meta = getCategoryMeta(cat.type, targetLang);
    lines.push('');
    lines.push(`${meta.emoji} <b>${meta.label}</b>`);
    for (const item of cat.items) {
      lines.push(`• ${escapeHtml(item)}`);
    }
  }

  return lines.join('\n');
}

export function formatMessage(
  repo: string,
  releases: CategorizedRelease[],
  targetLang: string,
): string {
  const parts: string[] = [];

  parts.push(`<b>${escapeHtml(repo)}</b>`);

  for (let i = 0; i < releases.length; i++) {
    if (i > 0) parts.push('\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄');
    parts.push('');
    parts.push(formatOneRelease(releases[i], targetLang));
  }

  return parts.join('\n');
}

const TG_MAX_LENGTH = 4096;
const HTML_TAG_PATTERN = /<\/?(b|i|a|code|pre)\b[^>]*>/gi;

function repairHtmlTruncation(text: string): string {
  let repaired = text.replace(/<[^>]*$/, '');
  const openTags: string[] = [];
  let match: RegExpExecArray | null;
  HTML_TAG_PATTERN.lastIndex = 0;

  while ((match = HTML_TAG_PATTERN.exec(repaired)) !== null) {
    const fullTag = match[0];
    const tagName = match[1]!.toLowerCase();
    if (fullTag.startsWith('</')) {
      const idx = openTags.lastIndexOf(tagName);
      if (idx !== -1) {
        openTags.splice(idx, 1);
      }
      continue;
    }
    openTags.push(tagName);
  }

  for (let i = openTags.length - 1; i >= 0; i--) {
    repaired += `</${openTags[i]}>`;
  }

  return repaired;
}

function safeTelegramHtmlSlice(text: string, maxLength: number): string {
  let sliced = text.slice(0, maxLength);
  let repaired = repairHtmlTruncation(sliced);
  while (repaired.length > maxLength && sliced.length > 0) {
    sliced = sliced.slice(0, -1);
    repaired = repairHtmlTruncation(sliced);
  }
  return repaired;
}

export function splitMessages(
  repo: string,
  releases: CategorizedRelease[],
  targetLang: string,
): string[] {
  const full = formatMessage(repo, releases, targetLang);
  if (full.length <= TG_MAX_LENGTH) return [full];

  const messages: string[] = [];
  const header = `<b>${escapeHtml(repo)}</b>`;

  for (const release of releases) {
    const body = formatOneRelease(release, targetLang);
    const msg = `${header}\n\n${body}`;

    if (msg.length <= TG_MAX_LENGTH) {
      messages.push(msg);
    } else {
      messages.push(safeTelegramHtmlSlice(msg, TG_MAX_LENGTH));
    }
  }

  return messages;
}

function splitSimpleLines(
  header: string,
  lines: string[],
): string[] {
  const messages: string[] = [];
  let current = header;

  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length <= TG_MAX_LENGTH) {
      current = next;
      continue;
    }

    if (current !== header) {
      messages.push(current);
      current = `${header}\n${line}`;
      continue;
    }

    messages.push(safeTelegramHtmlSlice(next, TG_MAX_LENGTH));
    current = header;
  }

  if (current !== header || messages.length === 0) {
    messages.push(current);
  }

  return messages;
}

export function formatCommitMessages(
  repo: string,
  commits: GitHubCommitSimple[],
): string[] {
  const header = `<b>${escapeHtml(repo)}</b>\n\nNew Commits`;
  const lines = commits.map((commit) => {
    const title = commit.commit.message.split(/\r?\n/, 1)[0]?.trim() || '(no message)';
    return `• <a href="${commit.html_url}">${escapeHtml(commit.sha.slice(0, 7))}</a> ${escapeHtml(title)}`;
  });
  return splitSimpleLines(header, lines);
}

export function formatPrMergeMessages(
  repo: string,
  prs: GitHubPullRequest[],
): string[] {
  const header = `<b>${escapeHtml(repo)}</b>\n\nMerged PRs`;
  const lines = prs.map((pr) => {
    const author = pr.user?.login ? ` (@${pr.user.login})` : '';
    return `• <a href="${pr.html_url}">#${pr.number}</a> ${escapeHtml(pr.title)}${escapeHtml(author)}`;
  });
  return splitSimpleLines(header, lines);
}
