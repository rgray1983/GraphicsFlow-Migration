import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { getGraphicById } from './graphics-repository.js';
import { resolveGraphicFiles } from './live-file-service.js';
import { readManagedPrintCard } from './print-card-managed-production-service.js';
import { getCompanySettings } from './settings-store.js';

type PrintCardDocument = {
  data: Buffer;
  fileName: string;
  contentType: 'image/jpeg' | 'image/png';
  source: 'graphicsflow' | 'live';
};

function imageContentType(extension: string): PrintCardDocument['contentType'] | null {
  const normalized = extension.toLowerCase();
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.png') return 'image/png';
  return null;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function normalizeLookup(value: unknown): string {
  return String(value ?? '').match(/\d+/g)?.join('').replace(/^0+/, '') ?? '';
}

async function readLiveImage(root: string, fullPath: string): Promise<PrintCardDocument | null> {
  if (!isInsideRoot(root, fullPath)) return null;
  const contentType = imageContentType(extname(fullPath));
  if (!contentType) return null;
  try {
    return {
      data: await readFile(fullPath),
      fileName: basename(fullPath),
      contentType,
      source: 'live',
    };
  } catch {
    return null;
  }
}

export async function readCurrentPrintCard(graphicId: number, requestedSpecificationNumber = ''): Promise<PrintCardDocument | null> {
  const managed = await readManagedPrintCard(graphicId);
  if (managed) {
    return {
      ...managed,
      contentType: 'image/jpeg',
      source: 'graphicsflow',
    };
  }

  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;

  const lookupNumbers = [requestedSpecificationNumber, graphic.specificationNumber, graphic.gNumber]
    .map(normalizeLookup)
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const root = getCompanySettings().storage.printCardsRoot;
  if (!root) return null;

  for (const number of lookupNumbers) {
    for (const extension of ['.jpg', '.JPG', '.jpeg', '.JPEG', '.png', '.PNG']) {
      const exact = await readLiveImage(root, resolve(root, `${number}${extension}`));
      if (exact) return exact;
    }
  }

  for (const number of lookupNumbers) {
    const files = await resolveGraphicFiles(number);
    const live = files.printCard.matches.find((match) => imageContentType(match.extension));
    if (!live) continue;
    const indexed = await readLiveImage(root, resolve(root, live.relativePath));
    if (indexed) return indexed;
  }

  return null;
}
