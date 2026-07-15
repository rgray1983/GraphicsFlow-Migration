import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { PrintCardDraft, RevisionJourneyEntry } from '@graphicsflow/shared';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { readLiveArtwork } from './print-card-artwork-service.js';
import { renderPrintCardInfoPanelPng } from './print-card-info-renderer.js';
import { getPrintCardDefaults } from './print-card-service.js';
import { getCompanySettings } from './settings-store.js';

const execFileAsync = promisify(execFile);

function clean(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalize(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function numberOnly(value: string): string {
  return value.match(/\d+/g)?.join('') ?? '';
}

function checked(value: unknown): boolean {
  return ['1', 'YES', 'ON', 'TRUE'].includes(clean(value));
}

async function commandExists(command: string, args: string[] = ['--version']): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function findPdftk(): Promise<string | null> {
  const candidates = [
    '/opt/homebrew/bin/pdftk',
    '/usr/local/bin/pdftk',
    '/opt/local/bin/pdftk',
    '/usr/bin/pdftk',
    '/Applications/XAMPP/xamppfiles/bin/pdftk',
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return await commandExists('pdftk', ['--version']) ? 'pdftk' : null;
}

async function findImageMagick(): Promise<'magick' | 'convert' | null> {
  if (await commandExists('magick')) return 'magick';
  if (await commandExists('convert')) return 'convert';
  return null;
}

type IndexedApproval = { root: string; relative_path: string; extension: string };

function findIndexedApproval(graphicId: number): IndexedApproval | null {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;
  const normalized = numberOnly(graphic.gNumber).replace(/^0+/, '');
  const root = getCompanySettings().storage.approvalsRoot;
  const row = graphicsStoreDatabase.prepare(`
    SELECT i.root, i.relative_path, i.extension
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = 'approval' AND i.root = ? AND n.g_number = ?
    ORDER BY i.modified_at DESC, i.id DESC
    LIMIT 1
  `).get(root, normalized) as IndexedApproval | undefined;
  return row ?? null;
}

async function readApprovalFields(graphicId: number): Promise<Record<string, string> | null> {
  const approval = findIndexedApproval(graphicId);
  if (!approval || approval.extension.toLowerCase() !== '.pdf') return null;
  const pdftk = await findPdftk();
  if (!pdftk) return null;
  try {
    const fullPath = resolve(approval.root, approval.relative_path);
    const { stdout } = await execFileAsync(pdftk, [fullPath, 'dump_data_fields_utf8'], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const fields: Record<string, string> = {};
    let current = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('FieldName:')) current = line.slice('FieldName:'.length).trim();
      else if (line.startsWith('FieldValue:') && current) fields[current] = line.slice('FieldValue:'.length).trim();
    }
    return fields;
  } catch {
    return null;
  }
}

function pickHeaderField(fields: Record<string, string>, aliases: string[]): string {
  const entries = Object.entries(fields).map(([key, value]) => ({ key, normalized: normalize(key), value: clean(value) }));
  for (const alias of aliases) {
    const exact = entries.find((entry) => entry.normalized === normalize(alias) && entry.value);
    if (exact) return exact.value;
  }
  return '';
}

export async function getApprovalHeaderMetadata(graphicId: number): Promise<{ specificationNumber: string }> {
  const fields = await readApprovalFields(graphicId);
  if (!fields) return { specificationNumber: '' };

  let specificationNumber = pickHeaderField(fields, [
    'SPEC #',
    'SPEC#',
    'SPEC',
    'SPEC NUMBER',
    'SPECIFICATION #',
    'SPECIFICATION NUMBER',
    'SPECIFICATION',
  ]);

  if (!specificationNumber) {
    const fallback = Object.entries(fields).find(([key, value]) => {
      const fieldName = normalize(key);
      return Boolean(clean(value))
        && (fieldName === 'SPEC' || fieldName.startsWith('SPECNUMBER') || fieldName.startsWith('SPECIFICATION'))
        && !fieldName.includes('REV');
    });
    specificationNumber = clean(fallback?.[1]);
  }

  return { specificationNumber };
}

function pick(fields: Record<string, string>, aliases: string[], suffix: number): string {
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [normalize(key), clean(value)]));
  for (const alias of aliases) {
    for (const candidate of [`${alias} ${suffix}`, `${alias}${suffix}`, `${alias}_${suffix}`]) {
      const value = normalized.get(normalize(candidate));
      if (value) return value;
    }
  }
  return '';
}

function approvalRows(fields: Record<string, string>) {
  return Array.from({ length: 10 }, (_, index) => ({
    index,
    revision: pick(fields, ['ART REV', 'REV', 'REVISION'], index),
    revisionDate: pick(fields, ['REV DATE', 'DATE', 'REVISION DATE'], index),
    description: pick(fields, ['DESCR', 'DESC', 'DESCRIPTION'], index),
    csr: pick(fields, ['CSR', 'CUSTOMER SERVICE', 'CUSTOMER SERVICE REP'], index),
    designer: pick(fields, ['DSR', 'DES', 'DESIGNER', 'DESIGNER INITIALS'], index),
  })).filter((row) => row.revision || row.revisionDate || row.description || row.csr || row.designer);
}

function revisionRank(value: string, fallback: number): number {
  const numeric = value.match(/\d+/)?.[0];
  return numeric ? Number(numeric) : fallback;
}

export type OriginalApprovalRevisionSnapshot = {
  approvalName: string;
  approvalRelativePath: string;
  specificationNumber: string;
  designNumber: string;
  fluteTest: string;
  salesRep: string;
  digitalPrint: boolean;
  digitalCut: boolean;
  digitalDieCut: boolean;
  labelDieCut: boolean;
  label4cProcess: boolean;
  revisions: Array<{
    revisionLabel: string;
    revisionDate: string;
    description: string;
    csr: string;
    designer: string;
  }>;
};

export async function getOriginalApprovalRevisionSnapshot(graphicId: number): Promise<OriginalApprovalRevisionSnapshot | null> {
  const approval = findIndexedApproval(graphicId);
  const fields = await readApprovalFields(graphicId);
  if (!approval || !fields) return null;
  const rows = approvalRows(fields).sort((a, b) => revisionRank(a.revision, a.index) - revisionRank(b.revision, b.index) || a.index - b.index);
  const value = (...aliases: string[]) => pickHeaderField(fields, aliases);
  return {
    approvalName: basename(approval.relative_path),
    approvalRelativePath: approval.relative_path,
    specificationNumber: value('SPEC #', 'SPEC#', 'SPEC NUMBER', 'SPECIFICATION NUMBER'),
    designNumber: value('DESIGN #', 'DESIGN#', 'DESIGN NUMBER'),
    fluteTest: value('TEST', 'TEST & FLUTE', 'FLUTE / TEST'),
    salesRep: value('Sales Rep', 'SALES REP', 'SALESPERSON'),
    digitalPrint: checked(value('Check Box DIGITAL PRINT')),
    digitalCut: checked(value('Check Box DIGITAL CUT')),
    digitalDieCut: checked(value('Check Box DIE CUT BAYSEK')),
    labelDieCut: checked(value('Check Box DIE CUT LABEL')),
    label4cProcess: checked(value('Check Box PROCESS')),
    revisions: rows.map((row) => ({
      revisionLabel: row.revision || String(row.index),
      revisionDate: row.revisionDate,
      description: row.description,
      csr: row.csr,
      designer: row.designer,
    })),
  };
}

export async function getApprovalRevisionJourney(graphicId: number): Promise<RevisionJourneyEntry[]> {
  const snapshot = await getOriginalApprovalRevisionSnapshot(graphicId);
  if (!snapshot) return [];
  return snapshot.revisions.map((row) => ({
    id: null,
    revisionLabel: row.revisionLabel,
    revisionDate: row.revisionDate,
    description: row.description,
    csr: row.csr,
    designer: row.designer,
    source: 'legacy-import',
    createdAt: null,
    isCurrent: false,
  }));
}

export async function getApprovalRevisionAutofill(graphicId: number): Promise<{ csr: string; designer: string; description: string } | null> {
  const journey = await getApprovalRevisionJourney(graphicId);
  if (!journey.length) return null;
  const latest = journey.at(-1)!;
  return { csr: latest.csr, designer: latest.designer, description: latest.description };
}

async function readDraftPdf(draft: PrintCardDraft): Promise<Buffer> {
  if (draft.artPdfBase64) {
    const pdf = Buffer.from(draft.artPdfBase64, 'base64');
    if (pdf.length < 5 || pdf.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('The uploaded artwork is not a valid PDF.');
    return pdf;
  }
  if (draft.liveArtworkRelativePath) return (await readLiveArtwork(draft.liveArtworkRelativePath)).data;
  throw new Error('Select a live artwork PDF or upload a PDF first.');
}

async function renderPdfPage(pdf: Buffer, width: number, height: number): Promise<Buffer> {
  const renderer = await findImageMagick();
  if (!renderer) throw new Error('ImageMagick is required to preview artwork PDFs.');
  const directory = await mkdtemp(join(tmpdir(), 'graphicsflow-print-card-preview-'));
  const pdfPath = join(directory, 'artwork.pdf');
  const imagePath = join(directory, 'artwork.png');
  try {
    await writeFile(pdfPath, pdf);
    await execFileAsync(renderer, [
      '-density', '600', `${pdfPath}[0]`, '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
      '-filter', 'Lanczos', '-resize', `${width}x${height}`, '-gravity', 'center', '-extent', `${width}x${height}`,
      '-units', 'PixelsPerInch', '-density', '600', '-define', 'png:compression-level=4', imagePath,
    ], { timeout: 120000, maxBuffer: 60 * 1024 * 1024 });
    return await readFile(imagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function renderArtworkPreview(artPdfBase64: string): Promise<Buffer> {
  return renderPdfPage(Buffer.from(artPdfBase64, 'base64'), 5400, 2400);
}

export async function renderCompletePrintCardPreview(graphicId: number, draft: PrintCardDraft): Promise<Buffer> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) throw new Error('Graphics record not found.');
  const defaults = await getPrintCardDefaults(graphicId);
  if (!defaults) throw new Error('Print Card defaults could not be loaded.');
  const renderer = await findImageMagick();
  if (!renderer) throw new Error('ImageMagick is required to render the Print Card preview.');

  const directory = await mkdtemp(join(tmpdir(), 'graphicsflow-complete-print-card-preview-'));
  const artPath = join(directory, 'art.png');
  const infoPath = join(directory, 'info.png');
  const outputPath = join(directory, 'print-card.png');
  try {
    await writeFile(artPath, await renderPdfPage(await readDraftPdf(draft), 5400, 2400));
    const revisions = [
      ...defaults.history.map((row) => ({ revisionLabel: row.revisionLabel, revisionDate: row.revisionDate, description: row.description, csr: row.csr, designer: row.designer })),
      { revisionLabel: draft.revisionLabel, revisionDate: draft.revisionDate, description: draft.description, csr: draft.csr, designer: draft.designer },
    ].slice(-4);
    await renderPrintCardInfoPanelPng({
      gNumber: graphic.gNumber,
      customerNumber: graphic.customerNumber,
      customerName: graphic.customerName,
      partNumber: graphic.partNumber,
      specificationNumber: draft.specificationNumber,
      designNumber: draft.designNumber,
      revisions,
    }, infoPath, 600, 2400);
    await execFileAsync(renderer, [artPath, infoPath, '+append', '-units', 'PixelsPerInch', '-density', '600', '-define', 'png:compression-level=4', outputPath], { timeout: 120000, maxBuffer: 80 * 1024 * 1024 });
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
