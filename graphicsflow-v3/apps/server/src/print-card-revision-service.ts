import { execFile } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { PrintCardDraft } from '@graphicsflow/shared';
import { graphicsStoreDatabase } from './graphics-store.js';
import { renderCompletePrintCardPreview } from './print-card-preview-service.js';
import { readLiveArtwork } from './print-card-artwork-service.js';
import { settingsDatabasePath } from './settings-store.js';

const execFileAsync = promisify(execFile);
const artworkRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'print-cards', 'revision-artwork');
const temporaryRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'print-cards', 'temporary');
const artworkMarker = 'managed-print-card-revision-artwork/';

export type PrintCardRevisionDetail = {
  id: number;
  graphicId: number;
  revisionLabel: string;
  revisionDate: string;
  description: string;
  specificationNumber: string;
  designNumber: string;
  csr: string;
  designer: string;
  artworkName: string;
  artworkRelativePath: string;
  artworkSource: string | null;
  source: 'legacy-import' | 'graphicsflow';
  isCurrent: boolean;
};

export type PrintCardRevisionUpdate = Omit<PrintCardRevisionDetail, 'id' | 'graphicId' | 'source' | 'isCurrent' | 'artworkSource'> & {
  artworkPdfBase64?: string;
};

type RevisionRow = Record<string, unknown>;

function clean(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function safeName(value: string): string { const name = basename(value || 'artwork.pdf').replace(/[^a-zA-Z0-9._-]/g, '_'); return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`; }
function inside(root: string, path: string): boolean { return path === root || path.startsWith(`${root}${sep}`); }
function numberOnly(value: string): string { return value.match(/\d+/g)?.join('') ?? ''; }

function mapRow(row: RevisionRow): PrintCardRevisionDetail {
  const sourcePath = String(row.source_relative_path ?? '');
  return {
    id: Number(row.id),
    graphicId: Number(row.graphic_id),
    revisionLabel: clean(row.revision_label),
    revisionDate: clean(row.revision_date),
    description: clean(row.description),
    specificationNumber: clean(row.specification_number),
    designNumber: clean(row.design_number),
    csr: clean(row.csr),
    designer: clean(row.designer),
    artworkName: sourcePath ? basename(sourcePath) : '',
    artworkRelativePath: sourcePath,
    artworkSource: row.artwork_source ? String(row.artwork_source) : null,
    source: row.source === 'legacy-import' ? 'legacy-import' : 'graphicsflow',
    isCurrent: Number(row.current_revision_id) === Number(row.id),
  };
}

export function getPrintCardRevisionDetail(graphicId: number, revisionId: number): PrintCardRevisionDetail | null {
  const row = graphicsStoreDatabase.prepare(`
    SELECT r.*, d.graphic_id, d.current_revision_id
    FROM document_revisions r
    INNER JOIN graphics_documents d ON d.id = r.document_id
    WHERE r.id = ? AND d.graphic_id = ? AND d.document_type = 'printCard'
  `).get(revisionId, graphicId) as RevisionRow | undefined;
  return row ? mapRow(row) : null;
}

async function storeUploadedArtwork(graphicId: number, revisionId: number, fileName: string, base64: string): Promise<{ name: string; marker: string }> {
  const data = Buffer.from(base64, 'base64');
  if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded Print Card artwork is not a valid PDF.');
  const directory = resolve(artworkRoot, String(graphicId), String(revisionId));
  if (!inside(artworkRoot, directory)) throw new Error('The managed Print Card artwork path is invalid.');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const name = safeName(fileName);
  const path = resolve(directory, name);
  if (!inside(artworkRoot, path)) throw new Error('The managed Print Card artwork path is invalid.');
  await writeFile(path, data);
  return { name, marker: `${artworkMarker}${graphicId}/${revisionId}/${name}` };
}

async function readManagedArtwork(relativePath: string): Promise<Buffer | null> {
  if (!relativePath.startsWith(artworkMarker)) return null;
  const path = resolve(artworkRoot, relativePath.slice(artworkMarker.length));
  if (!inside(artworkRoot, path)) return null;
  try { return await readFile(path); } catch { return null; }
}

export async function updatePrintCardRevision(graphicId: number, revisionId: number, input: PrintCardRevisionUpdate): Promise<PrintCardRevisionDetail> {
  const existing = getPrintCardRevisionDetail(graphicId, revisionId);
  if (!existing) throw new Error('Print Card revision not found.');
  const duplicate = graphicsStoreDatabase.prepare(`
    SELECT r.id FROM document_revisions r
    INNER JOIN graphics_documents d ON d.id = r.document_id
    WHERE d.graphic_id = ? AND d.document_type = 'printCard' AND UPPER(TRIM(r.revision_label)) = ? AND r.id <> ?
  `).get(graphicId, clean(input.revisionLabel), revisionId);
  if (duplicate) throw new Error(`Revision ${clean(input.revisionLabel)} already exists for this Print Card.`);

  let artworkName = input.artworkName.trim();
  let artworkRelativePath = input.artworkRelativePath.trim();
  let artworkSource = existing.artworkSource;
  if (input.artworkPdfBase64?.trim()) {
    const stored = await storeUploadedArtwork(graphicId, revisionId, artworkName, input.artworkPdfBase64);
    artworkName = stored.name;
    artworkRelativePath = stored.marker;
    artworkSource = 'uploaded-pdf';
  } else if (artworkRelativePath && artworkRelativePath !== existing.artworkRelativePath) {
    artworkSource = 'live-pdf';
  }

  graphicsStoreDatabase.prepare(`
    UPDATE document_revisions
    SET revision_label=?, revision_date=?, description=?, specification_number=?, design_number=?, csr=?, designer=?, source_relative_path=?, artwork_source=?
    WHERE id=?
  `).run(clean(input.revisionLabel), clean(input.revisionDate), clean(input.description), clean(input.specificationNumber), clean(input.designNumber), clean(input.csr), clean(input.designer), artworkRelativePath, artworkSource, revisionId);

  const updated = getPrintCardRevisionDetail(graphicId, revisionId);
  if (!updated) throw new Error('Print Card revision not found after update.');
  return { ...updated, artworkName };
}

async function imageMagick(): Promise<string> {
  for (const command of ['magick', 'convert']) {
    try { await execFileAsync(command, ['--version'], { timeout: 5000 }); return command; } catch { /* continue */ }
  }
  throw new Error('ImageMagick is required to regenerate Print Cards.');
}

export async function regeneratePrintCardRevision(graphicId: number, revisionId: number): Promise<{ data: Buffer; fileName: string }> {
  const revision = getPrintCardRevisionDetail(graphicId, revisionId);
  if (!revision) throw new Error('Print Card revision not found.');
  let artPdfBase64 = '';
  let liveArtworkRelativePath = revision.artworkRelativePath;
  const managed = await readManagedArtwork(revision.artworkRelativePath);
  if (managed) { artPdfBase64 = managed.toString('base64'); liveArtworkRelativePath = ''; }
  else if (liveArtworkRelativePath) await readLiveArtwork(liveArtworkRelativePath);
  else throw new Error('This revision does not have a connected artwork PDF. Edit the revision and select artwork first.');

  const draft: PrintCardDraft = {
    specificationNumber: revision.specificationNumber,
    designNumber: revision.designNumber,
    revisionLabel: revision.revisionLabel,
    revisionDate: revision.revisionDate,
    description: revision.description,
    csr: revision.csr,
    designer: revision.designer,
    replaceExistingImage: false,
    artPdfName: revision.artworkName,
    artPdfBase64,
    liveArtworkRelativePath,
  };
  const png = await renderCompletePrintCardPreview(graphicId, draft);
  await mkdir(temporaryRoot, { recursive: true });
  const fileBase = numberOnly(revision.specificationNumber) || revision.specificationNumber.replace(/[^A-Z0-9_-]/gi, '_');
  const fileName = `${fileBase || `PRINT_CARD_${revisionId}`}.jpg`;
  const path = resolve(temporaryRoot, `${revisionId}-${Date.now()}-${fileName}`);
  if (!inside(temporaryRoot, path)) throw new Error('The temporary Print Card path is invalid.');
  const renderer = await imageMagick();
  const pngPath = `${path}.png`;
  await writeFile(pngPath, png);
  try {
    await execFileAsync(renderer, [pngPath, '-units', 'PixelsPerInch', '-density', '300', '-sampling-factor', '4:4:4', '-quality', '100', path], { timeout: 120000, maxBuffer: 80 * 1024 * 1024 });
    return { data: await readFile(path), fileName };
  } finally {
    await rm(pngPath, { force: true });
    await rm(path, { force: true });
  }
}
