import { constants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import {
  printCardArtworkMatchesResponseSchema,
  type PrintCardArtworkMatch,
  type PrintCardArtworkMatchesResponse,
} from '@graphicsflow/shared';
import { getGraphicById } from './graphics-repository.js';
import { getCompanySettings } from './settings-store.js';

const MAX_DEPTH = 5;
const MAX_ENTRIES = 100_000;

function numberOnly(value: string): string {
  return value.match(/\d+/g)?.join('')?.replace(/^0+/, '') ?? '';
}

function hasGraphicNumber(name: string, gNumber: string): boolean {
  return (name.match(/\d+/g) ?? []).some((value) => value.replace(/^0+/, '') === gNumber);
}

function classify(name: string, gNumber: string): Pick<PrintCardArtworkMatch, 'classification' | 'rank'> {
  const stem = basename(name, extname(name)).toUpperCase().replace(/\s+/g, ' ').trim();
  const compact = stem.replace(/[^A-Z0-9]/g, '');
  const number = gNumber.replace(/^0+/, '');
  const exactPc = new RegExp(`^(G)?0*${number}(PC|PRINTCARD)$`, 'i').test(compact);
  const mentionsPc = /(^|[^A-Z])PC([^A-Z]|$)|PRINT\s*CARD/i.test(stem);
  const exactApproval = new RegExp(`^(G#?)?0*${number}$`, 'i').test(stem.replace(/\s+/g, ''));
  if (exactPc) return { classification: 'print-card', rank: 0 };
  if (mentionsPc) return { classification: 'print-card', rank: 10 };
  if (exactApproval) return { classification: 'approval', rank: 20 };
  return { classification: 'other', rank: 50 };
}

export async function findPrintCardArtworkMatches(graphicId: number): Promise<PrintCardArtworkMatchesResponse | null> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;
  const root = getCompanySettings().storage.pdfRoot.trim();
  if (!root) {
    return printCardArtworkMatchesResponseSchema.parse({
      graphicId,
      rootLabel: 'PDF artwork',
      matches: [],
      selectedRelativePath: null,
      message: 'Configure the PDF artwork folder in Company Settings.',
    });
  }

  const normalizedRoot = resolve(root);
  try { await access(normalizedRoot, constants.R_OK); }
  catch {
    return printCardArtworkMatchesResponseSchema.parse({
      graphicId,
      rootLabel: 'PDF artwork',
      matches: [],
      selectedRelativePath: null,
      message: 'The configured PDF artwork folder is not readable from this server.',
    });
  }

  const gNumber = numberOnly(graphic.gNumber);
  const queue: Array<{ path: string; depth: number }> = [{ path: normalizedRoot, depth: 0 }];
  const matches: PrintCardArtworkMatch[] = [];
  let inspected = 0;

  while (queue.length && inspected < MAX_ENTRIES) {
    const current = queue.shift()!;
    let entries;
    try { entries = await readdir(current.path, { withFileTypes: true }); }
    catch { continue; }

    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_ENTRIES) break;
      const fullPath = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_DEPTH) queue.push({ path: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf' || !hasGraphicNumber(entry.name, gNumber)) continue;
      try {
        const information = await stat(fullPath);
        const classification = classify(entry.name, gNumber);
        matches.push({
          name: entry.name,
          relativePath: relative(normalizedRoot, fullPath),
          size: information.size,
          modifiedAt: information.mtime.toISOString(),
          ...classification,
        });
      } catch {
        // Ignore files that disappear while the network folder is being read.
      }
    }
  }

  matches.sort((a, b) => a.rank - b.rank || b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
  const selectedRelativePath = matches.length === 1 ? matches[0].relativePath : null;
  const message = matches.length === 0
    ? 'No matching PDFs were found. Upload a PDF for this Print Card instead.'
    : matches.length === 1
      ? 'One read-only live artwork PDF was found and selected.'
      : `${matches.length} read-only live artwork PDFs were found. Select the correct source.`;

  return printCardArtworkMatchesResponseSchema.parse({ graphicId, rootLabel: 'PDF artwork', matches, selectedRelativePath, message });
}

export async function readLiveArtwork(relativePath: string): Promise<{ data: Buffer; name: string; relativePath: string }> {
  const root = resolve(getCompanySettings().storage.pdfRoot.trim());
  if (!relativePath.trim()) throw new Error('Select a live artwork PDF first.');
  const fullPath = resolve(root, relativePath);
  const insideRoot = fullPath === root || fullPath.startsWith(`${root}${sep}`);
  if (!insideRoot || extname(fullPath).toLowerCase() !== '.pdf') throw new Error('The selected live artwork path is invalid.');
  await access(fullPath, constants.R_OK);
  const data = await readFile(fullPath);
  if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The selected live artwork is not a valid PDF.');
  return { data, name: basename(fullPath), relativePath: relative(root, fullPath) };
}
