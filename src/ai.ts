import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  AppConfig,
  GitHubRelease,
  CategorizedRelease,
  CategoryGroup,
  CategoryType,
} from "./types.js";

const VALID_TYPES = new Set<CategoryType>([
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "other",
]);

function inferTypeFromText(text: string): CategoryType {
  const content = text.toLowerCase();
  if (/(^|\b)(feat|feature|新增|新功能|支持)($|\b)/i.test(content))
    return "feat";
  if (/(^|\b)(fix|bug|修复|纠正)($|\b)/i.test(content)) return "fix";
  if (/(^|\b)(perf|optimi[sz]e|性能|优化|提速)($|\b)/i.test(content))
    return "perf";
  if (/(^|\b)(refactor|重构)($|\b)/i.test(content)) return "refactor";
  if (/(^|\b)(docs?|readme|文档)($|\b)/i.test(content)) return "docs";
  return "other";
}

function fallbackCategoriesFromBody(body: string): CategoryGroup[] {
  const groups = new Map<CategoryType, string[]>();
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith("*") || line.startsWith("-") || line.startsWith("•"),
    )
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const type = inferTypeFromText(line);
    const existing = groups.get(type) ?? [];
    existing.push(line);
    groups.set(type, existing);
  }

  if (groups.size === 0) {
    return [{ type: "other", items: [body.slice(0, 500)] }];
  }

  return Array.from(groups.entries()).map(([type, items]) => ({ type, items }));
}

function formatDate(iso: string, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function extractJsonFromText(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0].trim();

  return null;
}

function parseCategories(text: string): CategoryGroup[] | null {
  const json = extractJsonFromText(text);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as { categories?: unknown[] };
    const cats = parsed.categories;
    if (!Array.isArray(cats)) return null;

    const valid = cats
      .filter(
        (cat): cat is { type: string; items: string[] } =>
          typeof cat === "object" &&
          cat !== null &&
          typeof (cat as { type?: unknown }).type === "string" &&
          VALID_TYPES.has((cat as { type: string }).type as CategoryType) &&
          Array.isArray((cat as { items?: unknown }).items),
      )
      .map((cat) => ({
        type: cat.type as CategoryType,
        items: cat.items.filter(
          (item: string) => typeof item === "string" && item.trim().length > 0,
        ),
      }))
      .filter((cat) => cat.items.length > 0);

    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function buildSystemPrompt(targetLang: string): string {
  return `You are a GitHub Release Notes translator and categorizer.

Your task:
1. Translate all content to ${targetLang}
2. Categorize each change into exactly ONE type:
   - feat: New features, capabilities, or functionality
   - fix: Bug fixes, error corrections
   - perf: Performance improvements, optimizations
   - refactor: Code restructuring without behavior change
   - docs: Documentation updates
   - other: Everything else (breaking changes, deprecations, etc.)

Rules:
- Each item must be a concise one-line description in ${targetLang}
- Merge duplicate or very similar items
- Skip CI/build/dependency-only changes unless significant
- If input is empty or meaningless, return empty categories array
- NEVER return markdown code fences
- ONLY return valid JSON matching the schema

Note: The following examples are for reference only. You MUST output in ${targetLang}.

Examples:

Input:
## What's Changed
* Add dark mode support by @user1
* Fix crash on startup by @user2
* Update README.md by @user3

Output:
{
  "categories": [
    {
      "type": "feat",
      "items": ["新增深色模式支持"]
    },
    {
      "type": "fix",
      "items": ["修复启动时崩溃问题"]
    },
    {
      "type": "docs",
      "items": ["更新 README 文档"]
    }
  ]
}

Input:
### Features
- Implement user authentication with JWT
- Add export to CSV functionality

### Bug Fixes
- Resolve memory leak in background worker
- Fix incorrect date formatting

Output:
{
  "categories": [
    {
      "type": "feat",
      "items": ["实现 JWT 用户认证", "新增导出为 CSV 功能"]
    },
    {
      "type": "fix",
      "items": ["解决后台工作进程内存泄漏", "修复日期格式错误"]
    }
  ]
}

Input:
🚀 Performance improvements in database queries
⚡ Optimize image loading speed
📝 Refactor authentication module

Output:
{
  "categories": [
    {
      "type": "perf",
      "items": ["优化数据库查询性能", "提升图片加载速度"]
    },
    {
      "type": "refactor",
      "items": ["重构认证模块"]
    }
  ]
}

Input:
Breaking: Remove deprecated API endpoints
Deprecate old configuration format

Output:
{
  "categories": [
    {
      "type": "other",
      "items": ["移除已弃用的 API 端点", "弃用旧配置格式"]
    }
  ]
}

Input:


Output:
{
  "categories": []
}`;
}

export function createAIClient(config: AppConfig): LanguageModelV3 {
  const opts = {
    ...(config.aiBaseUrl && { baseURL: config.aiBaseUrl }),
    apiKey: config.aiApiKey,
  };

  switch (config.aiProvider) {
    case "google":
      return createGoogleGenerativeAI(opts)(config.aiModel);
    case "anthropic":
      return createAnthropic(opts)(config.aiModel);
    case "openai-responses":
      return createOpenAI(opts).responses(config.aiModel);
    default:
      return createOpenAI(opts).chat(config.aiModel);
  }
}

export async function categorizeRelease(
  model: LanguageModelV3,
  release: GitHubRelease,
  timeZone: string,
  targetLang: string,
): Promise<CategorizedRelease> {
  const base: CategorizedRelease = {
    tag: release.tag_name,
    date: formatDate(release.published_at, timeZone),
    url: release.html_url,
    categories: [],
  };

  if (!release.body?.trim()) return base;

  const start = Date.now();
  try {
    const { text } = await generateText({
      model,
      system: buildSystemPrompt(targetLang),
      prompt: release.body,
    });

    const elapsed = Date.now() - start;
    const validCategories = parseCategories(text);

    if (!validCategories) {
      console.warn(
        `[AI] Failed to parse response for ${release.tag_name}, using fallback`,
      );
      base.categories = fallbackCategoriesFromBody(release.body);
    } else {
      console.log(
        `[AI] Categorized ${release.tag_name} in ${elapsed}ms (${validCategories.length} categories)`,
      );
      base.categories = validCategories;
    }
  } catch (e: unknown) {
    const elapsed = Date.now() - start;
    console.error(`[AI] Failed for ${release.tag_name} after ${elapsed}ms:`, e);
    base.categories = fallbackCategoriesFromBody(release.body);
  }

  return base;
}

export async function translateText(
  model: LanguageModelV3,
  input: string,
  targetLang: string,
): Promise<string> {
  const text = input.trim();
  if (!text) return '';

  const system = `You are a translator.\n\nRules:\n- Translate the user's message to ${targetLang}\n- Preserve the original meaning\n- Keep it concise\n- Output ONLY the translated text\n- Do NOT wrap in quotes or code fences`;

  const start = Date.now();
  try {
    const res = await generateText({
      model,
      system,
      prompt: text,
    });
    const out = res.text.trim();
    const elapsed = Date.now() - start;
    console.log(`[AI] Translated in ${elapsed}ms`);
    return out;
  } catch (e: unknown) {
    const elapsed = Date.now() - start;
    console.error(`[AI] Translate failed after ${elapsed}ms:`, e);
    throw e;
  }
}
