import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import { getGraphicById } from './graphics-repository.js';
import { resolveGraphicFiles } from './live-file-service.js';
import { readManagedPrintCard } from './print-card-managed-production-service.js';
import { getCompanySettings } from './settings-store.js';

type PrintCardDocument = { data: Buffer; fileName: string; contentType: 'image/jpeg' | 'image/png'; source: 'graphicsflow' | 'live' };
export type LivePrintCardMatch = { fileName: string; relativePath: string; extension: string; modifiedAt: string; size: number };

const IMAGE_EXTENSIONS = ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG'] as const;

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

async function exactRootMatch(root: string, target: string): Promise<LivePrintCardMatch | null> {
  for (const extension of IMAGE_EXTENSIONS) {
    const fullPath = resolve(root, `${target}${extension}`);
    if (!isInsideRoot(root, fullPath)) continue;
    try {
      await access(fullPath, constants.R_OK);
      const information = await stat(fullPath);
      return {
        fileName: basename(fullPath),
        relativePath: basename(fullPath),
        extension: extname(fullPath).toLowerCase(),
        modifiedAt: information.mtime.toISOString(),
        size: information.size,
      };
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
}

export async function findLivePrintCardBySpecification(specificationNumber: string): Promise<LivePrintCardMatch | null> {
  const target = normalizeLookup(specificationNumber); const root = getCompanySettings().storage.printCardsRoot;
  if (!target || !root) return null;

  // Most live Print Cards sit directly in the configured root. These checks are cheap
  // and avoid traversing a large network folder when an exact file exists.
  const exact = await exactRootMatch(root, target);
  if (exact) return exact;

  // Nested files are resolved through the background-maintained index. Never recursively
  // walk the live network folder during an interactive search.
  const indexed = await resolveGraphicFiles(target);
  const indexedMatch = indexed.printCard.matches.find((match) => imageContentType(match.extension) && fileStemNumber(match.name) === target);
  return indexedMatch ? {
    fileName: indexedMatch.name,
    relativePath: indexedMatch.relativePath,
    extension: indexedMatch.extension,
    modifiedAt: indexedMatch.modifiedAt,
    size: indexedMatch.size,
  } : null;
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
