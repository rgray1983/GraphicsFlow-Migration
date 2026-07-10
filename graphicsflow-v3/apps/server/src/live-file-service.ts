import { mkdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  fileIndexJobStatusSchema,
  fileIndexRefreshResponseSchema,
  graphicFilesResponseSchema,
  type FileIndexJobStatus,
  type FileIndexProgress,
  type FileIndexRefreshResponse,
  type GraphicFileKind,
  type GraphicFileMatch,
  type GraphicFilesResponse,
} from '@graphicsflow/shared';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const MAX_DEPTH = 5;
const MAX_ENTRIES_PER_ROOT = 100_000;
const PROGRESS_UPDATE_INTERVAL = 100;

const allowedExtensions: Record<GraphicFileKind, Set<string>> = {
  approval: new Set(['.pdf']),
  printCard: new Set(['.jpg', '.jpeg', '.png', '.pdf']),
};

const indexDatabase = new DatabaseSync(settingsDatabasePath);
const previewCacheRoot = resolve(dirname(settingsDatabasePath), 'preview-cache');
mkdirSync(previewCacheRoot, { recursive: true });

indexDatabase.exec(`
  PRAGMA foreign_keys = ON;
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
  CREATE TABLE IF NOT EXISTS preview_cache (
    source_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    root TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    source_modified_at TEXT NOT NULL,
    source_size INTEGER NOT NULL,
    cache_relative_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_preview_cache_source ON preview_cache(kind, root, relative_path);
`);

let indexJob: FileIndexJobStatus = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  progress: null,
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

function previousFileCount(root: string, kind: GraphicFileKind): number | null {
  if (!root) return null;
  const row = indexDatabase
    .prepare('SELECT file_count FROM live_file_index_runs WHERE root = ? AND kind = ?')
    .get(root, kind) as { file_count: number } | undefined;
  return row ? Number(row.file_count) : null;
}

function updateProgress(progress: FileIndexProgress): void {
  if (indexJob.status !== 'running') return;
  indexJob = { ...indexJob, progress };
}

function buildProgress(
  phase: FileIndexProgress['phase'],
  currentKind: GraphicFileKind | null,
  scannedEntries: number,
  discoveredFiles: number,
  estimatedTotalFiles: number | null,
  startedAtMs: number,
): FileIndexProgress {
  const elapsedMs = Date.now() - startedAtMs;
  const rawPercent = estimatedTotalFiles && estimatedTotalFiles > 0
    ? Math.min(99, (discoveredFiles / estimatedTotalFiles) * 100)
    : null;
  const estimatedRemainingMs = rawPercent && rawPercent > 0
    ? Math.max(0, Math.round(elapsedMs * ((100 - rawPercent) / rawPercent)))
    : null;

  return {
    phase,
    currentKind,
    scannedEntries,
    discoveredFiles,
    estimatedTotalFiles,
    progressPercent: rawPercent,
    elapsedMs,
    estimatedRemainingMs,
  };
}

type ScanProgress = {
  scannedEntries: number;
  discoveredFiles: number;
};

async function scanRoot(
  root: string,
  kind: GraphicFileKind,
  onProgress: (progress: ScanProgress) => void,
) {
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
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (allowedExtensions[kind].has(extension)) {
          const numbers = extractNumbers(entry.name);
          if (numbers.length > 0) {
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
      }

      if (inspectedEntries % PROGRESS_UPDATE_INTERVAL === 0) {
        onProgress({ scannedEntries: inspectedEntries, discoveredFiles: files.length });
      }
    }
  }

  onProgress({ scannedEntries: inspectedEntries, discoveredFiles: files.length });
  return files;
}

function invalidateStalePreviewCache(root: string, kind: GraphicFileKind): void {
  indexDatabase.prepare(`
    DELETE FROM preview_cache
    WHERE kind = ? AND root = ?
      AND NOT EXISTS (
        SELECT 1 FROM live_file_index i
        WHERE i.kind = preview_cache.kind
          AND i.root = preview_cache.root
          AND i.relative_path = preview_cache.relative_path
          AND i.modified_at = preview_cache.source_modified_at
          AND i.size = preview_cache.source_size
      )
  `).run(kind, root);
}

async function rebuildRoot(
  root: string,
  kind: GraphicFileKind,
  onProgress: (progress: ScanProgress) => void,
): Promise<number> {
  if (!root) return 0;
  const files = await scanRoot(root, kind, onProgress);
  const insertFile = indexDatabase.prepare(`
    INSERT INTO live_file_index (kind, root, name, extension, size, modified_at, relative_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNumber = indexDatabase.prepare('INSERT INTO live_file_numbers (file_id, g_number) VALUES (?, ?)');
  const indexedAt = new Date().toISOString();

  indexDatabase.exec('BEGIN');
  try {
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
    invalidateStalePreviewCache(root, kind);
    indexDatabase.exec('COMMIT');
  } catch (error) {
    indexDatabase.exec('ROLLBACK');
    throw error;
  }

  return files.length;
}

export async function refreshLiveFileIndex(): Promise<FileIndexRefreshResponse> {
  const startedAtMs = Date.now();
  const settings = getCompanySettings();
  const previousApprovalCount = previousFileCount(settings.storage.approvalsRoot, 'approval');
  const previousPrintCardCount = previousFileCount(settings.storage.printCardsRoot, 'printCard');
  const estimatedTotal = previousApprovalCount !== null || previousPrintCardCount !== null
    ? (previousApprovalCount ?? 0) + (previousPrintCardCount ?? 0)
    : null;

  updateProgress(buildProgress('preparing', null, 0, 0, estimatedTotal, startedAtMs));

  let approvalScanned = 0;
  let approvalDiscovered = 0;
  const approvalCount = await rebuildRoot(settings.storage.approvalsRoot, 'approval', (progress) => {
    approvalScanned = progress.scannedEntries;
    approvalDiscovered = progress.discoveredFiles;
    updateProgress(buildProgress(
      'approvals',
      'approval',
      approvalScanned,
      approvalDiscovered,
      estimatedTotal,
      startedAtMs,
    ));
  });

  let printScanned = 0;
  let printDiscovered = 0;
  const printCardCount = await rebuildRoot(settings.storage.printCardsRoot, 'printCard', (progress) => {
    printScanned = progress.scannedEntries;
    printDiscovered = progress.discoveredFiles;
    updateProgress(buildProgress(
      'printCards',
      'printCard',
      approvalScanned + printScanned,
      approvalCount + printDiscovered,
      estimatedTotal,
      startedAtMs,
    ));
  });

  updateProgress(buildProgress(
    'finalizing',
    null,
    approvalScanned + printScanned,
    approvalCount + printCardCount,
    estimatedTotal,
    startedAtMs,
  ));

  return fileIndexRefreshResponseSchema.parse({
    approvalCount,
    printCardCount,
    totalCount: approvalCount + printCardCount,
    durationMs: Date.now() - startedAtMs,
    indexedAt: new Date().toISOString(),
  });
}

export function getFileIndexJobStatus(): FileIndexJobStatus {
  if (indexJob.status === 'running' && indexJob.progress) {
    indexJob = {
      ...indexJob,
      progress: {
        ...indexJob.progress,
        elapsedMs: indexJob.startedAt ? Date.now() - new Date(indexJob.startedAt).getTime() : indexJob.progress.elapsedMs,
      },
    };
  }
  return fileIndexJobStatusSchema.parse(indexJob);
}

export function startLiveFileIndexJob(): FileIndexJobStatus {
  if (activeIndexPromise) return getFileIndexJobStatus();

  indexJob = {
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    progress: {
      phase: 'preparing',
      currentKind: null,
      scannedEntries: 0,
      discoveredFiles: 0,
      estimatedTotalFiles: null,
      progressPercent: null,
      elapsedMs: 0,
      estimatedRemainingMs: null,
    },
    result: null,
    error: null,
  };

  activeIndexPromise = refreshLiveFileIndex()
    .then((result) => {
      indexJob = {
        status: 'completed',
        startedAt: indexJob.startedAt,
        completedAt: new Date().toISOString(),
        progress: {
          phase: 'finalizing',
          currentKind: null,
          scannedEntries: indexJob.progress?.scannedEntries ?? 0,
          discoveredFiles: result.totalCount,
          estimatedTotalFiles: result.totalCount,
          progressPercent: 100,
          elapsedMs: result.durationMs,
          estimatedRemainingMs: 0,
        },
        result,
        error: null,
      };
    })
    .catch((error: unknown) => {
      indexJob = {
        status: 'failed',
        startedAt: indexJob.startedAt,
        completedAt: new Date().toISOString(),
        progress: indexJob.progress,
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

export { previewCacheRoot };
