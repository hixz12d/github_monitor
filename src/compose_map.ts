import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ComposeRepoMappingEntry {
  project?: string;
  service?: string;
  image?: string;
  repo: string; // owner/repo
}

export interface ComposeRepoMappingsFile {
  mappings: ComposeRepoMappingEntry[];
}

const MAP_PATH = resolve(import.meta.dirname, '..', 'data', 'compose_map.json');

export function loadComposeRepoMappings(): ComposeRepoMappingEntry[] {
  try {
    const raw = readFileSync(MAP_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ComposeRepoMappingsFile>;
    const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
    return mappings.filter((m): m is ComposeRepoMappingEntry => Boolean(m && typeof m.repo === 'string' && m.repo.includes('/')));
  } catch {
    return [];
  }
}

export function findRepoMapping(
  mappings: ComposeRepoMappingEntry[],
  project: string | null,
  service: string | null,
  image: string | null,
): string | null {
  const p = project?.trim() || '';
  const s = service?.trim() || '';
  const img = image?.trim() || '';

  // Prefer exact project+service match, then project-only, then image match.
  for (const m of mappings) {
    if (!m.project || !m.service) continue;
    if (m.project === p && m.service === s) return m.repo;
  }
  for (const m of mappings) {
    if (!m.project || m.service) continue;
    if (m.project === p) return m.repo;
  }
  for (const m of mappings) {
    if (!m.image) continue;
    if (m.image === img) return m.repo;
  }
  return null;
}

