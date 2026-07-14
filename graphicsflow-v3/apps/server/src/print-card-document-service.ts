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

export async function readCurrentPrintCard(graphicId: number): Promise<PrintCardDocument | null> {
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

  const files = await resolveGraphicFiles(graphic.gNumber);
  const live = files.printCard.matches.find((match) => imageContentType(match.extension));
  if (!live) return null;

  const root = getCompanySettings().storage.printCardsRoot;
  if (!root) return null;

  const fullPath = resolve(root, live.relativePath);
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
