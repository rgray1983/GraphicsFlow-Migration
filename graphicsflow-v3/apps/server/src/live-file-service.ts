import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  graphicFilesResponseSchema,
  type GraphicFileKind,
  type GraphicFileMatch,
  type GraphicFilesResponse,
} from '@graphicsflow/shared';
import { getCompanySettings } from './settings-store.js';

const MAX_DEPTH = 5;
const MAX_ENTRIES_PER_ROOT = 5000;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { expiresAt: number; value: GraphicFilesResponse }>();

const allowedExtensions: Record<GraphicFileKind, Set<string>> = {
  approval: new Set(['.pdf']),
  printCard: new Set(['.jpg', '.jpeg', '.png', '.pdf']),
};

function normalizeGNumber(value: string): string {
  const digits = value.match(/\d+/g)?.join('') ?? '';
  return digits.replace(/^0+/, '') || digits;
}

function matchesGNumber(fileName: string, gNumber: string): boolean {
  const escaped = gNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9])0*${escaped}([^0-9]|$)`, 'i').test(fileName);
}

async function scanRoot(root: string, gNumber: string, kind: GraphicFileKind): Promise<GraphicFileMatch[]> {
  if (!root) return [];

  const matches: GraphicFileMatch[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let inspectedEntries = 0;

  while (queue.length > 0 && inspectedEntries < MAX_ENTRIES_PER_ROOT) {
    const current = queue.shift()!;
    let entries;

    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      inspectedEntries += 1;
      if (inspectedEntries > MAX_ENTRIES_PER_ROOT) break;

      const fullPath = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH) queue.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!allowedExtensions[kind].has(extension) || !matchesGNumber(entry.name, gNumber)) continue;

      try {
        const information = await stat(fullPath);
        matches.push({
          kind,
          name: basename(fullPath),
          extension,
          size: information.size,
          modifiedAt: information.mtime.toISOString(),
          relativePath: fullPath.slice(root.length).replace(/^[/\\]+/, ''),
        });
      } catch {
        // A file may disappear while a network folder is being scanned. Ignore that entry.
      }
    }
  }

  return matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function resolveGraphicFiles(gNumberValue: string): Promise<GraphicFilesResponse> {
  const gNumber = normalizeGNumber(gNumberValue);
  const settings = getCompanySettings();
  const cacheKey = `${gNumber}|${settings.storage.approvalsRoot}|${settings.storage.printCardsRoot}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [approvals, printCards] = await Promise.all([
    scanRoot(settings.storage.approvalsRoot, gNumber, 'approval'),
    scanRoot(settings.storage.printCardsRoot, gNumber, 'printCard'),
  ]);

  const value = graphicFilesResponseSchema.parse({
    gNumber: gNumberValue,
    approval: { latest: approvals[0] ?? null, matches: approvals },
    printCard: { latest: printCards[0] ?? null, matches: printCards },
    checkedAt: new Date().toISOString(),
  });

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
