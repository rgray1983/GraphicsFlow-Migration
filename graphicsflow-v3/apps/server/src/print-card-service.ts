import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createPrintCardResponseSchema,
  printCardDefaultsResponseSchema,
  renderPrintCardSvg,
  type CreatePrintCardResponse,
  type PrintCardDefaultsResponse,
  type PrintCardDraft,
  type PrintCardRevision,
  type PrintCardTemplateRevision,
} from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { getCompanySettings } from './settings-store.js';

const execFileAsync = promisify(execFile);

const FIELD_ALIASES = {
  specificationNumber: ['SPEC#', 'SPEC #', 'SPEC NUMBER', 'F#', 'F #', 'F NUMBER'],
  designNumber: ['D#', 'D #', 'D NUMBER', 'DESIGN#', 'DESIGN #', 'DESIGN NUMBER'],
  csr: ['CSR', 'CUSTOMER SERVICE', 'CUSTOMER SERVICE REP'],
  designer: ['DSR', 'DES', 'DESIGNER', 'DESIGNER INITIALS'],
  revisionLabel: ['ART REV', 'REV', 'REVISION'],
  revisionDate: ['REV DATE', 'DATE'],
  description: ['DESCR', 'DESC', 'DESCRIPTION'],
} as const;

function normalizeFieldName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function clean(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function numberOnly(value: string): string {
  return value.match(/\d+/g)?.join('') ?? '';
}

function nextRevision(value: string): string {
  const cleanValue = clean(value);
  if (!cleanValue) return '0';
  return /^\d+$/.test(cleanValue) ? String(Number(cleanValue) + 1) : cleanValue;
}

function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
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

async function readPdfFields(graphicId: number): Promise<Record<string, string> | null> {
  const approval = findIndexedApproval(graphicId);
  if (!approval || approval.extension.toLowerCase() !== '.pdf') return null;
  const pdftk = await findPdftk();
  if (!pdftk) return null;
  const fullPath = resolve(approval.root, approval.relative_path);
  try {
    const { stdout } = await execFileAsync(pdftk, [fullPath, 'dump_data_fields_utf8'], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const fields: Record<string, string> = {};
    let current = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('FieldName:')) current = line.slice('FieldName:'.length).trim();
      if (line.startsWith('FieldValue:') && current) fields[current] = line.slice('FieldValue:'.length).trim();
    }
    return fields;
  } catch {
    return null;
  }
}

function pickField(fields: Record<string, string> | null, aliases: readonly string[], suffix?: number): string {
  if (!fields) return '';
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [normalizeFieldName(key), clean(value)]));
  const candidates = suffix === undefined
    ? aliases
    : aliases.flatMap((alias) => [`${alias} ${suffix}`, `${alias}${suffix}`]);
  for (const candidate of candidates) {
    const value = normalized.get(normalizeFieldName(candidate));
    if (value) return value;
  }
  return '';
}

function legacyHistory(gNumber: string): PrintCardRevision[] {
  const base = numberOnly(gNumber).replace(/^0+/, '');
  if (!base) return [];
  try {
    const rows = legacyDatabase.prepare(`
      SELECT id, f_number, d_number, rev, rev_date, description, csr, des, created_at
      FROM print_card_revisions
      WHERE CAST(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(g_number, ''))), 'G', ''), '#', ''), ' ', '') AS INTEGER) = ?
      ORDER BY CASE WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER) ELSE -1 END ASC, id ASC
    `).all(Number(base)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: null,
      revisionLabel: clean(row.rev),
      revisionDate: clean(row.rev_date),
      description: clean(row.description),
      csr: clean(row.csr),
      designer: clean(row.des),
      specificationNumber: clean(row.f_number),
      designNumber: clean(row.d_number),
      renderedRelativePath: null,
      createdAt: row.created_at ? new Date(String(row.created_at).replace(' ', 'T') + 'Z').toISOString() : null,
      source: 'legacy-import' as const,
    }));
  } catch {
    return [];
  }
}

function v3History(graphicId: number): PrintCardRevision[] {
  const rows = graphicsStoreDatabase.prepare(`
    SELECT r.id, r.revision_label, r.revision_date, r.description, r.csr, r.designer,
           r.specification_number, r.design_number, r.rendered_relative_path, r.created_at, r.source
    FROM graphics_documents d
    INNER JOIN document_revisions r ON r.document_id = d.id
    WHERE d.graphic_id = ? AND d.document_type = 'printCard'
    ORDER BY r.created_at ASC, r.id ASC
  `).all(graphicId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    revisionLabel: clean(row.revision_label),
    revisionDate: clean(row.revision_date),
    description: clean(row.description),
    csr: clean(row.csr),
    designer: clean(row.designer),
    specificationNumber: clean(row.specification_number),
    designNumber: clean(row.design_number),
    renderedRelativePath: row.rendered_relative_path ? String(row.rendered_relative_path) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    source: row.source === 'legacy-import' ? 'legacy-import' : 'graphicsflow',
  }));
}

function latestLegacyApproval(gNumber: string): Record<string, unknown> | null {
  const base = numberOnly(gNumber).replace(/^0+/, '');
  if (!base) return null;
  try {
    return legacyDatabase.prepare(`
      SELECT spec_number, d_number, csr, des, rev, rev_date, description
      FROM approval_revisions
      WHERE CAST(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(g_number, ''))), 'G', ''), '#', ''), ' ', '') AS INTEGER) = ?
      ORDER BY COALESCE(created_at, '') DESC, id DESC
      LIMIT 1
    `).get(Number(base)) as Record<string, unknown> | undefined ?? null;
  } catch {
    return null;
  }
}

export async function getPrintCardDefaults(graphicId: number): Promise<PrintCardDefaultsResponse | null> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;

  const history = [...legacyHistory(graphic.gNumber), ...v3History(graphicId)];
  const latest = history.at(-1) ?? null;
  const approvalRow = latestLegacyApproval(graphic.gNumber);
  const pdfFields = await readPdfFields(graphicId);
  const sources: Record<string, string> = {};

  const choose = (field: string, values: Array<[string, string]>): string => {
    for (const [source, value] of values) {
      if (clean(value)) {
        sources[field] = source;
        return clean(value);
      }
    }
    sources[field] = 'Manual entry needed';
    return '';
  };

  const specificationNumber = choose('specificationNumber', [
    ['V3 graphic metadata', graphic.specificationNumber],
    ['Latest print card', latest?.specificationNumber ?? ''],
    ['Latest approval revision', clean(approvalRow?.spec_number)],
    ['Approval PDF', pickField(pdfFields, FIELD_ALIASES.specificationNumber)],
  ]);
  const designNumber = choose('designNumber', [
    ['Latest print card', latest?.designNumber ?? ''],
    ['Latest approval revision', clean(approvalRow?.d_number)],
    ['Approval PDF', pickField(pdfFields, FIELD_ALIASES.designNumber)],
  ]);
  const csr = choose('csr', [
    ['Latest print card', latest?.csr ?? ''],
    ['Latest approval revision', clean(approvalRow?.csr)],
    ['Approval PDF', pickField(pdfFields, FIELD_ALIASES.csr)],
  ]);
  const designer = choose('designer', [
    ['Latest print card', latest?.designer ?? ''],
    ['Latest approval revision', clean(approvalRow?.des)],
    ['Approval PDF', pickField(pdfFields, FIELD_ALIASES.designer)],
  ]);

  const currentApprovalRev = clean(approvalRow?.rev) || pickField(pdfFields, FIELD_ALIASES.revisionLabel);
  const revisionLabel = history.length ? nextRevision(latest?.revisionLabel ?? '') : (currentApprovalRev || '0');
  sources.revisionLabel = history.length ? 'Next print card revision' : currentApprovalRev ? 'Current approval revision' : 'Initial revision';
  sources.revisionDate = 'Today';
  const description = choose('description', [
    ['Latest approval revision', clean(approvalRow?.description)],
    ['Approval PDF', pickField(pdfFields, FIELD_ALIASES.description)],
  ]);

  return printCardDefaultsResponseSchema.parse({
    graphic,
    draft: {
      specificationNumber,
      designNumber,
      revisionLabel,
      revisionDate: today(),
      description,
      csr,
      designer,
      replaceExistingImage: false,
    },
    history,
    autoFill: {
      approvalFound: Boolean(findIndexedApproval(graphicId) || approvalRow),
      approvalFieldsRead: Boolean(pdfFields),
      sources,
      message: pdfFields
        ? 'Approval form fields were read and combined with GraphicsFlow metadata.'
        : 'Defaults were loaded from structured data. Approval form fields were unavailable or not fillable.',
    },
  });
}

function toTemplateRevision(revision: PrintCardRevision | PrintCardDraft): PrintCardTemplateRevision {
  return {
    revisionLabel: revision.revisionLabel,
    revisionDate: revision.revisionDate,
    description: revision.description,
    csr: revision.csr,
    designer: revision.designer,
  };
}

async function renderJpg(svg: string, targetPath: string): Promise<void> {
  const svgPath = `${targetPath}.svg`;
  await writeFile(svgPath, svg, 'utf8');
  try {
    const args = [svgPath, '-density', '300', '-units', 'PixelsPerInch', '-quality', '94', '-strip', targetPath];
    if (await commandExists('magick')) {
      await execFileAsync('magick', args, { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
      return;
    }
    if (await commandExists('convert')) {
      await execFileAsync('convert', args, { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
      return;
    }
    throw new Error('ImageMagick is required to generate production print-card JPG files.');
  } finally {
    await rm(svgPath, { force: true });
  }
}

export async function createPrintCard(graphicId: number, draft: PrintCardDraft): Promise<CreatePrintCardResponse> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) throw new Error('Graphics record not found.');
  const settings = getCompanySettings();
  const root = settings.storage.printCardsRoot.trim();
  if (!root) throw new Error('Configure the Print Card storage folder in Company Settings first.');
  await mkdir(root, { recursive: true });

  const history = [...legacyHistory(graphic.gNumber), ...v3History(graphicId)];
  const fileBase = numberOnly(draft.specificationNumber) || clean(draft.specificationNumber).replace(/[^A-Z0-9_-]/g, '_');
  if (!fileBase) throw new Error('Spec # cannot be converted into a valid print-card filename.');
  const fileName = `${fileBase}.jpg`;
  const finalPath = resolve(root, fileName);
  if (dirname(finalPath) !== resolve(root)) throw new Error('The print-card output path is invalid.');

  const tempPath = join(root, `.${fileBase}.${process.pid}.${Date.now()}.tmp.jpg`);
  const backupPath = join(root, `.${fileBase}.${process.pid}.${Date.now()}.backup.jpg`);
  const svg = renderPrintCardSvg({
    gNumber: graphic.gNumber,
    customerNumber: graphic.customerNumber,
    customerName: graphic.customerName,
    partNumber: graphic.partNumber,
    specificationNumber: draft.specificationNumber,
    designNumber: draft.designNumber,
    revisions: [...history.map(toTemplateRevision), toTemplateRevision(draft)].slice(-4),
  });

  await renderJpg(svg, tempPath);
  let hadExisting = false;
  try {
    await access(finalPath, constants.F_OK);
    hadExisting = true;
  } catch {
    hadExisting = false;
  }
  if (hadExisting && !draft.replaceExistingImage) {
    await rm(tempPath, { force: true });
    throw new Error(`${fileName} already exists. Enable Replace Existing Image to intentionally update it.`);
  }

  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    const now = new Date().toISOString();
    graphicsStoreDatabase.prepare(`
      INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at)
      VALUES (?, 'printCard', 'active', ?, ?)
      ON CONFLICT(graphic_id, document_type) DO UPDATE SET status = 'active', updated_at = excluded.updated_at
    `).run(graphicId, now, now);
    const document = graphicsStoreDatabase.prepare(`
      SELECT id FROM graphics_documents WHERE graphic_id = ? AND document_type = 'printCard'
    `).get(graphicId) as { id: number };

    const result = graphicsStoreDatabase.prepare(`
      INSERT INTO document_revisions (
        document_id, revision_label, revision_date, description, specification_number, design_number,
        csr, designer, rendered_relative_path, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'graphicsflow', ?)
    `).run(
      document.id,
      clean(draft.revisionLabel),
      clean(draft.revisionDate),
      clean(draft.description),
      clean(draft.specificationNumber),
      clean(draft.designNumber),
      clean(draft.csr),
      clean(draft.designer),
      fileName,
      now,
    );
    const revisionId = Number(result.lastInsertRowid);
    graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id = ?, updated_at = ? WHERE id = ?')
      .run(revisionId, now, document.id);

    if (hadExisting) await rename(finalPath, backupPath);
    await rename(tempPath, finalPath);
    graphicsStoreDatabase.exec('COMMIT');
    await rm(backupPath, { force: true });

    return createPrintCardResponseSchema.parse({
      graphicId,
      revision: {
        id: revisionId,
        revisionLabel: clean(draft.revisionLabel),
        revisionDate: clean(draft.revisionDate),
        description: clean(draft.description),
        csr: clean(draft.csr),
        designer: clean(draft.designer),
        specificationNumber: clean(draft.specificationNumber),
        designNumber: clean(draft.designNumber),
        renderedRelativePath: fileName,
        createdAt: now,
        source: 'graphicsflow',
      },
      fileName,
      relativePath: fileName,
      replacedExistingImage: hadExisting,
    });
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    await rm(tempPath, { force: true });
    try {
      await access(backupPath, constants.F_OK);
      await rm(finalPath, { force: true });
      await rename(backupPath, finalPath);
    } catch {
      // No backup was created.
    }
    throw error;
  }
}

export async function readGeneratedPrintCard(graphicId: number): Promise<{ data: Buffer; fileName: string } | null> {
  const row = graphicsStoreDatabase.prepare(`
    SELECT r.rendered_relative_path
    FROM graphics_documents d
    INNER JOIN document_revisions r ON r.id = d.current_revision_id
    WHERE d.graphic_id = ? AND d.document_type = 'printCard'
  `).get(graphicId) as { rendered_relative_path: string | null } | undefined;
  if (!row?.rendered_relative_path) return null;
  const root = resolve(getCompanySettings().storage.printCardsRoot);
  const path = resolve(root, row.rendered_relative_path);
  if (dirname(path) !== root || extname(path).toLowerCase() !== '.jpg') return null;
  try {
    return { data: await readFile(path), fileName: basename(path) };
  } catch {
    return null;
  }
}
