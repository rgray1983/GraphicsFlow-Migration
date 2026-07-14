import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GraphicFileKind } from '@graphicsflow/shared';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const MAX_DEPTH = 5;
const MAX_TARGETED_ENTRIES = 25_000;
const WATCH_DEBOUNCE_MS = 500;
const NEGATIVE_REPAIR_COOLDOWN_MS = 60_000;

const allowedExtensions: Record<GraphicFileKind, Set<string>> = {
  approval: new Set(['.pdf']),
  printCard: new Set(['.jpg', '.jpeg', '.png', '.pdf']),
};

const database = new DatabaseSync(settingsDatabasePath);
database.exec('PRAGMA foreign_keys = ON;');

const watchers = new Map<GraphicFileKind, FSWatcher>();
const pendingChanges = new Map<string, NodeJS.Timeout>();
const recentRepairs = new Map<string, number>();
const activeRepairs = new Map<string, Promise<number>>();

let syncStatus = {
  active: false,
  approvalWatcher: false,
  printCardWatcher: false,
  lastEventAt: null as string | null,
  lastRepairAt: null as string | null,
  message: 'Live synchronization has not started.',
};

function normalizeNumber(value: string): string {
  return value.replace(/^0+/, '') || value;
}

function extractNumbers(fileName: string): string[] {
  return [...new Set((fileName.match(/\d+/g) ?? []).map(normalizeNumber).filter(Boolean))];
}

function matchesNumber(fileName: string, gNumber: string): boolean {
  return extractNumbers(fileName).includes(gNumber);
}

function removeIndexedFile(kind: GraphicFileKind, root: string, relativePath: string): void {
  database.prepare('DELETE FROM live_file_index WHERE kind = ? AND root = ? AND relative_path = ?').run(kind, root, relativePath);
  database.prepare('DELETE FROM preview_cache WHERE kind = ? AND root = ? AND relative_path = ?').run(kind, root, relativePath);
}

async function upsertIndexedFile(kind: GraphicFileKind, root: string, relativePath: string): Promise<boolean> {
  const fullPath = join(root, relativePath);
  const extension = extname(relativePath).toLowerCase();
  if (!allowedExtensions[kind].has(extension)) return false;
  let information;
  try {
    information = await stat(fullPath);
  } catch {
    removeIndexedFile(kind, root, relativePath);
    return false;
  }
  if (!information.isFile()) return false;
  const name = relativePath.split(/[/\\]/).at(-1) ?? relativePath;
  const numbers = extractNumbers(name);
  if (numbers.length === 0) return false;
  database.exec('BEGIN');
  try {
    removeIndexedFile(kind, root, relativePath);
    const result = database.prepare(`
      INSERT INTO live_file_index (kind, root, name, extension, size, modified_at, relative_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(kind, root, name, extension, information.size, information.mtime.toISOString(), relativePath);
    const fileId = Number(result.lastInsertRowid);
    const insertNumber = database.prepare('INSERT INTO live_file_numbers (file_id, g_number) VALUES (?, ?)');
    for (const number of numbers) insertNumber.run(fileId, number);
    database.exec('COMMIT');
    return true;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function targetedScan(root: string, kind: GraphicFileKind, gNumber: string): Promise<number> {
  if (!root || !existsSync(root)) return 0;
  const queue: Array<{ path: string; relative: string; depth: number }> = [{ path: root, relative: '', depth: 0 }];
  let inspected = 0;
  let repaired = 0;
  while (queue.length > 0 && inspected < MAX_TARGETED_ENTRIES) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_TARGETED_ENTRIES) break;
      const relativePath = current.relative ? join(current.relative, entry.name) : entry.name;
      const fullPath = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH) queue.push({ path: fullPath, relative: relativePath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(entry.name).toLowerCase();
      if (!allowedExtensions[kind].has(extension) || !matchesNumber(entry.name, gNumber)) continue;
      if (await upsertIndexedFile(kind, root, relativePath)) repaired += 1;
    }
  }
  return repaired;
}

function scheduleWatcherUpdate(kind: GraphicFileKind, root: string, fileName: string | Buffer | null): void {
  if (!fileName) return;
  const relativePath = fileName.toString();
  const key = `${kind}|${relativePath}`;
  const existing = pendingChanges.get(key);
  if (existing) clearTimeout(existing);
  pendingChanges.set(key, setTimeout(() => {
    pendingChanges.delete(key);
    void upsertIndexedFile(kind, root, relativePath)
      .then(() => {
        recentRepairs.clear();
        syncStatus = { ...syncStatus, lastEventAt: new Date().toISOString() };
      })
      .catch(() => {});
  }, WATCH_DEBOUNCE_MS));
}

function startWatcher(kind: GraphicFileKind, root: string): boolean {
  watchers.get(kind)?.close();
  watchers.delete(kind);
  if (!root || !existsSync(root)) return false;
  try {
    const watcher = watch(root, { recursive: true }, (_eventType, fileName) => scheduleWatcherUpdate(kind, root, fileName));
    watcher.on('error', () => {
      watchers.delete(kind);
      syncStatus = {
        ...syncStatus,
        active: watchers.size > 0,
        approvalWatcher: watchers.has('approval'),
        printCardWatcher: watchers.has('printCard'),
        message: 'A network folder watcher stopped. Targeted repair remains active.',
      };
    });
    watchers.set(kind, watcher);
    return true;
  } catch {
    return false;
  }
}

export function initializeLiveFileSync(): void {
  const settings = getCompanySettings();
  const approvalWatcher = startWatcher('approval', settings.storage.approvalsRoot);
  const printCardWatcher = startWatcher('printCard', settings.storage.printCardsRoot);
  recentRepairs.clear();
  syncStatus = {
    ...syncStatus,
    active: approvalWatcher || printCardWatcher,
    approvalWatcher,
    printCardWatcher,
    message: approvalWatcher || printCardWatcher
      ? 'Live folder monitoring is active. Targeted miss repair is always available.'
      : 'Folder monitoring is unavailable on this server. Targeted miss repair remains active.',
  };
}

export function restartLiveFileSync(): void {
  setImmediate(() => initializeLiveFileSync());
}

async function repairKind(gNumber: string, kind: GraphicFileKind, force = false): Promise<number> {
  const key = `${kind}|${gNumber}`;
  const existing = activeRepairs.get(key);
  if (existing) return existing;
  const lastRepair = recentRepairs.get(key) ?? 0;
  if (!force && Date.now() - lastRepair < NEGATIVE_REPAIR_COOLDOWN_MS) return 0;
  recentRepairs.set(key, Date.now());
  const settings = getCompanySettings();
  const root = kind === 'approval' ? settings.storage.approvalsRoot : settings.storage.printCardsRoot;
  const job = targetedScan(root, kind, gNumber)
    .then((repaired) => {
      if (repaired > 0) recentRepairs.delete(key);
      syncStatus = { ...syncStatus, lastRepairAt: new Date().toISOString() };
      return repaired;
    })
    .finally(() => activeRepairs.delete(key));
  activeRepairs.set(key, job);
  return job;
}

function normalizeGraphicNumber(gNumberValue: string): string {
  return normalizeNumber(gNumberValue.match(/\d+/g)?.join('') ?? '');
}

export function scheduleGraphicFileMissRepair(gNumberValue: string, kinds: GraphicFileKind[]): void {
  const gNumber = normalizeGraphicNumber(gNumberValue);
  if (!gNumber || kinds.length === 0) return;
  for (const kind of kinds) void repairKind(gNumber, kind);
}

export async function refreshGraphicFilesNow(gNumberValue: string, kinds: GraphicFileKind[]): Promise<number> {
  const gNumber = normalizeGraphicNumber(gNumberValue);
  if (!gNumber || kinds.length === 0) return 0;
  const results = await Promise.all(kinds.map((kind) => repairKind(gNumber, kind, true)));
  return results.reduce((total, count) => total + count, 0);
}

export function getLiveFileSyncStatus() {
  return { ...syncStatus };
}
