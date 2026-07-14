import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { getGraphicById } from './graphics-repository.js';
import { resolveGraphicFiles } from './live-file-service.js';
import { readManagedPrintCard } from './print-card-managed-production-service.js';
import { getCompanySettings } from './settings-store.js';

type PrintCardDocument = { data: Buffer; fileName: string; contentType: 'image/jpeg' | 'image/png'; source: 'graphicsflow' | 'live' };
export type LivePrintCardMatch = { fileName: string; relativePath: string; extension: string; modifiedAt: string; size: number };

function imageContentType(extension: string): PrintCardDocument['contentType'] | null {
  const normalized = extension.toLowerCase();
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.png') return 'image/png';
  return null;
}
function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root); const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}
function normalizeLookup(value: unknown): string { return String(value ?? '').match(/\d+/g)?.join('').replace(/^0+/, '') ?? ''; }
function fileStemNumber(name: string): string { return normalizeLookup(basename(name, extname(name))); }

export async function findLivePrintCardBySpecification(specificationNumber: string): Promise<LivePrintCardMatch | null> {
  const target = normalizeLookup(specificationNumber); const root = getCompanySettings().storage.printCardsRoot;
  if (!target || !root) return null;
  const indexed = await resolveGraphicFiles(target);
  const indexedMatch = indexed.printCard.matches.find((match) => imageContentType(match.extension) && fileStemNumber(match.name) === target);
  if (indexedMatch) return { fileName: indexedMatch.name, relativePath: indexedMatch.relativePath, extension: indexedMatch.extension, modifiedAt: indexedMatch.modifiedAt, size: indexedMatch.size };
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!; let entries;
    try { entries = await readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const fullPath = join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 5) queue.push({ directory: fullPath, depth: current.depth + 1 });
      if (!entry.isFile() || fileStemNumber(entry.name) !== target || !imageContentType(extname(entry.name))) continue;
      try { const information = await stat(fullPath); return { fileName: entry.name, relativePath: fullPath.slice(root.length).replace(/^[/\\]+/, ''), extension: extname(entry.name).toLowerCase(), modifiedAt: information.mtime.toISOString(), size: information.size }; }
      catch { /* continue */ }
    }
  }
  return null;
}

async function readLiveImage(root: string, fullPath: string): Promise<PrintCardDocument | null> {
  if (!isInsideRoot(root, fullPath)) return null; const contentType = imageContentType(extname(fullPath)); if (!contentType) return null;
  try { return { data: await readFile(fullPath), fileName: basename(fullPath), contentType, source: 'live' }; } catch { return null; }
}

export async function readCurrentPrintCard(graphicId: number, requestedSpecificationNumber = ''): Promise<PrintCardDocument | null> {
  const managed = await readManagedPrintCard(graphicId); if (managed) return { ...managed, contentType: 'image/jpeg', source: 'graphicsflow' };
  const graphic = getGraphicById(graphicId); if (!graphic) return null;
  const lookupNumbers = [requestedSpecificationNumber, graphic.specificationNumber, graphic.gNumber].map(normalizeLookup).filter((value, index, values) => value && values.indexOf(value) === index);
  const root = getCompanySettings().storage.printCardsRoot; if (!root) return null;
  for (const number of lookupNumbers) { const match = await findLivePrintCardBySpecification(number); if (match) { const image = await readLiveImage(root, resolve(root, match.relativePath)); if (image) return image; } }
  return null;
}

export async function readUnregisteredPrintCard(relativePath: string): Promise<PrintCardDocument | null> {
  const root = getCompanySettings().storage.printCardsRoot; if (!root) return null;
  return readLiveImage(root, resolve(root, relativePath));
}
