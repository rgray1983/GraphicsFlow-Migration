import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { settingsDatabasePath } from './settings-store.js';

const root = resolve(dirname(settingsDatabasePath), 'generated-documents', 'approvals', 'revision-artwork');
const markerPrefix = 'managed-revision-artwork/';

function safePath(path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function safeName(value: string): string {
  const cleaned = basename(value || 'artwork.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

export function storeApprovalRevisionArtwork(
  graphicId: number,
  revisionId: number,
  fileName: string,
  base64: string,
): { artworkName: string; artworkRelativePath: string } {
  const data = Buffer.from(base64, 'base64');
  if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The uploaded Approval artwork is not a valid PDF.');
  }

  const directory = resolve(root, String(graphicId), String(revisionId));
  if (!safePath(directory)) throw new Error('The managed Approval artwork path is invalid.');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const name = safeName(fileName);
  const path = resolve(directory, name);
  if (!safePath(path)) throw new Error('The managed Approval artwork path is invalid.');
  writeFileSync(path, data);

  return {
    artworkName: name,
    artworkRelativePath: `${markerPrefix}${graphicId}/${revisionId}/${name}`,
  };
}

export function readApprovalRevisionArtwork(relativePath: string): Buffer | null {
  if (!relativePath.startsWith(markerPrefix)) return null;
  const local = relativePath.slice(markerPrefix.length);
  const path = resolve(root, local);
  if (!safePath(path)) return null;
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}
