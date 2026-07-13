import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getGraphicById } from './graphics-repository.js';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const database = new DatabaseSync(settingsDatabasePath);

type IndexedApproval = {
  root: string;
  relative_path: string;
  name: string;
  size: number;
  modified_at: string;
  extension: string;
};

export type ApprovalDocument = {
  fileName: string;
  size: number;
  modifiedAt: string;
  absolutePath: string;
};

function normalizeNumber(value: string): string {
  const digits = value.match(/\d+/g)?.join('') ?? '';
  return digits.replace(/^0+/, '') || digits;
}

function findLatestIndexedApproval(graphicId: number): IndexedApproval | null {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;
  const settings = getCompanySettings();
  const gNumber = normalizeNumber(graphic.gNumber);

  const row = database.prepare(`
    SELECT i.root, i.relative_path, i.name, i.size, i.modified_at, i.extension
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = 'approval' AND i.root = ? AND n.g_number = ?
    ORDER BY i.modified_at DESC
    LIMIT 1
  `).get(settings.storage.approvalsRoot, gNumber) as IndexedApproval | undefined;

  return row ?? null;
}

export async function resolveApprovalDocument(graphicId: number): Promise<ApprovalDocument | null> {
  const indexed = findLatestIndexedApproval(graphicId);
  if (!indexed || indexed.extension.toLowerCase() !== '.pdf') return null;

  const rootPath = await realpath(indexed.root);
  const candidatePath = await realpath(resolve(indexed.root, indexed.relative_path));
  const allowedPrefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`;

  if (candidatePath !== rootPath && !candidatePath.startsWith(allowedPrefix)) {
    throw new Error('Resolved approval path is outside the configured approval root.');
  }

  const information = await stat(candidatePath);
  if (!information.isFile()) return null;

  return {
    fileName: basename(indexed.name),
    size: information.size,
    modifiedAt: information.mtime.toISOString(),
    absolutePath: candidatePath,
  };
}

export function streamApprovalDocument(document: ApprovalDocument) {
  return createReadStream(document.absolutePath);
}
