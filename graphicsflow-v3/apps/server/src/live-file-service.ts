import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  fileIndexJobStatusSchema,
  fileIndexRefreshResponseSchema,
  graphicFilesResponseSchema,
  type FileIndexJobStatus,
  type FileIndexRefreshResponse,
  type GraphicFileKind,
  type GraphicFileMatch,
  type GraphicFilesResponse,
} from '@graphicsflow/shared';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const MAX_DEPTH = 5;
const MAX_ENTRIES_PER_ROOT = 100_000;

const allowedExtensions: Record<GraphicFileKind, Set<string>> = {
  approval: new Set(['.pdf']),
  printCard: new Set(['.jpg', '.jpeg', '.png', '.pdf']),
};

const indexDatabase = new DatabaseSync(settingsDatabasePath);
indexDatabase.exec(`
  CREATE TABLE IF NOT EXISTS live_file_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    root TEXT NOT NULL,
    name TEXT NOT NULL,
    extension TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    relative_path TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS live_file_numbers (
    file_id INTEGER NOT NULL,
    g_number TEXT NOT NULL,
    FOREIGN KEY(file_id) REFERENCES live_file_index(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_live_file_numbers_g_number ON live_file_numbers(g_number);
  CREATE INDEX IF NOT EXISTS idx_live_file_index_kind_root ON live_file_index(kind, root);
  CREATE TABLE IF NOT EXISTS live_file_index_runs (
    root TEXT NOT NULL,
    kind TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    PRIMARY KEY(root, kind)
  );
`);

let indexJob: FileIndexJobStatus = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  result: null,
  error: null,
};
let activeIndexPromise: Promise<void> | null = null;

function normalizeNumber(value: string): string {
  return value.replace(/^0+/, '') || value;
}

function extractNumbers(fileName: string): string[] {
  return [...new Set((fileName.match(/\d+/g) ?? []).map(normalizeNumber).filter(Boolean))];
}

async function scanRoot(root: string, kind: GraphicFileKind) {
  const files: Array<GraphicFileMatch & { numbers: string[] }> = [];
  if (!root) return files;

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
      if (!allowedExtensions[kind].has(extension)) continue;

      const numbers = extractNumbers(entry.name);
      if (numbers.length === 0) continue;

      try {
        const information = await stat(fullPath);
        files.push({
          kind,
          name: entry.name,
          extension,
          size: information.size,
          modifiedAt: information.mtime.toISOString(),
          relativePath: fullPath.slice(root.length).replace(/^[/\\]+/, ''),
          numbers,
        });
      } catch {
        // Ignore files that disappear while a network folder is being indexed.
      }
    }
  }

  return files;
}

async function rebuildRoot(root: string, kind: GraphicFileKind): Promise<number> {
  if (!root) return 0;
  const files = await scanRoot(root, kind);
  const insertFile = indexDatabase.prepare(`
    INSERT INTO live_file_index (kind, root, name, extension, size, modified_at, relative_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNumber = indexDatabase.prepare('INSERT INTO live_file_numbers (file_id, g_number) VALUES (?, ?)');
  const indexedAt = new Date().toISOString();

  indexDatabase.exec('BEGIN');
  try {
    const existingIds = indexDatabase.prepare('SELECT id FROM live_file_index WHERE kind = ? AND root = ?').all(kind, root) as Array<{ id: number }>;
    for (const row of existingIds) indexDatabase.prepare('DELETE FROM live_file_numbers WHERE file_id = ?').run(row.id);
    indexDatabase.prepare('DELETE FROM live_file_index WHERE kind = ? AND root = ?').run(kind, root);

    for (const file of files) {
      const result = insertFile.run(kind, root, file.name, file.extension, file.size, file.modifiedAt, file.relativePath);
      const fileId = Number(result.lastInsertRowid);
      for (const number of file.numbers) insertNumber.run(fileId, number);
    }

    indexDatabase.prepare(`
      INSERT INTO live_file_index_runs (root, kind, indexed_at, file_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(root, kind) DO UPDATE SET indexed_at = excluded.indexed_at, file_count = excluded.file_count
    `).run(root, kind, indexedAt, files.length);
    indexDatabase.exec('COMMIT');
  } catch (error) {
    indexDatabase.exec('ROLLBACK');
    throw error;
  }

  return files.length;
}

export async function refreshLiveFileIndex(): Promise<FileIndexRefreshResponse> {
  const startedAt = Date.now();
  const settings = getCompanySettings();
  const approvalCount = await rebuildRoot(settings.storage.approvalsRoot, 'approval');
  const printCardCount = await rebuildRoot(settings.storage.printCardsRoot, 'printCard');

  return fileIndexRefreshResponseSchema.parse({
    approvalCount,
    printCardCount,
    totalCount: approvalCount + printCardCount,
    durationMs: Date.now() - startedAt,
    indexedAt: new Date().toISOString(),
  });
}

export function getFileIndexJobStatus(): FileIndexJobStatus {
  return fileIndexJobStatusSchema.parse(indexJob);
}

export function startLiveFileIndexJob(): FileIndexJobStatus {
  if (activeIndexPromise) return getFileIndexJobStatus();

  indexJob = {
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null,
  };

  activeIndexPromise = refreshLiveFileIndex()
    .then((result) => {
      indexJob = {
        status: 'completed',
        startedAt: indexJob.startedAt,
        completedAt: new Date().toISOString(),
        result,
        error: null,
      };
    })
    .catch((error: unknown) => {
      indexJob = {
        status: 'failed',
        startedAt: indexJob.startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        error: error instanceof Error ? error.message : 'Live file indexing failed.',
      };
    })
    .finally(() => {
      activeIndexPromise = null;
    });

  return getFileIndexJobStatus();
}

function readMatches(root: string, kind: GraphicFileKind, gNumber: string): GraphicFileMatch[] {
  if (!root) return [];
  const rows = indexDatabase.prepare(`
    SELECT i.kind, i.name, i.extension, i.size, i.modified_at, i.relative_path
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = ? AND i.root = ? AND n.g_number = ?
    ORDER BY i.modified_at DESC
  `).all(kind, root, gNumber) as Array<{
    kind: GraphicFileKind;
    name: string;
    extension: string;
    size: number;
    modified_at: string;
    relative_path: string;
  }>;

  return rows.map((row) => ({
    kind: row.kind,
    name: row.name,
    extension: row.extension,
    size: row.size,
    modifiedAt: row.modified_at,
    relativePath: row.relative_path,
  }));
}

function readIndexState(root: string, kind: GraphicFileKind) {
  if (!root) return null;
  return indexDatabase.prepare('SELECT indexed_at FROM live_file_index_runs WHERE root = ? AND kind = ?')
    .get(root, kind) as { indexed_at: string } | undefined;
}

export async function resolveGraphicFiles(gNumberValue: string): Promise<GraphicFilesResponse> {
  const gNumber = normalizeNumber(gNumberValue.match(/\d+/g)?.join('') ?? '');
  const settings = getCompanySettings();
  const approvalRun = readIndexState(settings.storage.approvalsRoot, 'approval');
  const printCardRun = readIndexState(settings.storage.printCardsRoot, 'printCard');
  const approvals = readMatches(settings.storage.approvalsRoot, 'approval', gNumber);
  const printCards = readMatches(settings.storage.printCardsRoot, 'printCard', gNumber);
  const indexedDates = [approvalRun?.indexed_at, printCardRun?.indexed_at].filter(Boolean) as string[];

  return graphicFilesResponseSchema.parse({
    gNumber: gNumberValue,
    approval: { latest: approvals[0] ?? null, matches: approvals },
    printCard: { latest: printCards[0] ?? null, matches: printCards },
    indexReady: Boolean(approvalRun || printCardRun),
    indexedAt: indexedDates.sort().at(-1) ?? null,
    checkedAt: new Date().toISOString(),
  });
}
