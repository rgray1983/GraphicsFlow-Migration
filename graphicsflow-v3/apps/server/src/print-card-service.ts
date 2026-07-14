import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  printCardDefaultsResponseSchema,
  type PrintCardDefaultsResponse,
  type PrintCardRevision,
} from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { getCompanySettings } from './settings-store.js';

const execFileAsync = promisify(execFile);

const FIELD_ALIASES = {
  specificationNumber: ['SPEC#', 'SPEC #', 'SPEC NUMBER', 'SPECIFICATION', 'F#', 'F #', 'F NUMBER', 'S#', 'S #'],
  designNumber: ['D#', 'D #', 'D NUMBER', 'DESIGN#', 'DESIGN #', 'DESIGN NUMBER'],
  csr: ['CSR', 'CUSTOMER SERVICE', 'CUSTOMER SERVICE REP', 'CUSTOMER SERVICE REPRESENTATIVE'],
  designer: ['DSR', 'DES', 'DESIGNER', 'DESIGNER INITIALS'],
  revisionLabel: ['ART REV', 'ART REVISION', 'REV', 'REVISION'],
  revisionDate: ['REV DATE', 'REVISION DATE', 'DATE'],
  description: ['DESCR', 'DESC', 'DESCRIPTION', 'REV DESCRIPTION'],
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
  const normalized = clean(value);
  if (!normalized) return '0';
  return /^\d+$/.test(normalized) ? String(Number(normalized) + 1) : normalized;
}

function today(): string {
  const date = new Date();
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
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

type IndexedApproval = {
  root: string;
  relative_path: string;
  extension: string;
  name: string;
  modified_at: string;
};

function indexedApprovalCandidates(graphicId: number): IndexedApproval[] {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return [];
  const normalized = numberOnly(graphic.gNumber).replace(/^0+/, '');
  const root = getCompanySettings().storage.approvalsRoot;
  if (!root || !normalized) return [];

  return graphicsStoreDatabase.prepare(`
    SELECT i.root, i.relative_path, i.extension, i.name, i.modified_at
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = 'approval' AND i.root = ? AND n.g_number = ? AND LOWER(i.extension) = '.pdf'
    ORDER BY
      CASE
        WHEN UPPER(i.name) = UPPER(? || '.pdf') THEN 0
        WHEN UPPER(i.name) LIKE UPPER(? || ' %') THEN 1
        WHEN UPPER(i.name) LIKE UPPER(? || '-%') THEN 2
        ELSE 3
      END,
      i.modified_at DESC,
      i.id DESC
  `).all(root, normalized, normalized, normalized, normalized) as IndexedApproval[];
}

async function dumpPdfFields(pdftk: string, candidate: IndexedApproval): Promise<Record<string, string> | null> {
  try {
    const fullPath = resolve(candidate.root, candidate.relative_path);
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
    return Object.values(fields).some((value) => clean(value)) ? fields : null;
  } catch {
    return null;
  }
}

async function readPdfFields(graphicId: number): Promise<{ fields: Record<string, string>; fileName: string } | null> {
  const pdftk = await findPdftk();
  if (!pdftk) return null;
  for (const candidate of indexedApprovalCandidates(graphicId)) {
    const fields = await dumpPdfFields(pdftk, candidate);
    if (fields) return { fields, fileName: basename(candidate.relative_path) };
  }
  return null;
}

function normalizedFields(fields: Record<string, string> | null): Map<string, string> {
  return new Map(Object.entries(fields ?? {}).map(([key, value]) => [normalizeFieldName(key), clean(value)]));
}

function pickExact(fields: Map<string, string>, aliases: readonly string[], suffix?: number): string {
  const candidates = suffix === undefined
    ? aliases
    : aliases.flatMap((alias) => [`${alias} ${suffix}`, `${alias}${suffix}`, `${alias}_${suffix}`]);
  for (const candidate of candidates) {
    const value = fields.get(normalizeFieldName(candidate));
    if (value) return value;
  }
  return '';
}

function pickAcrossRows(fields: Map<string, string>, aliases: readonly string[]): string {
  const direct = pickExact(fields, aliases);
  if (direct) return direct;
  for (let suffix = 9; suffix >= 0; suffix -= 1) {
    const value = pickExact(fields, aliases, suffix);
    if (value) return value;
  }
  return '';
}

function latestRevisionRow(fields: Map<string, string>): Record<keyof typeof FIELD_ALIASES, string> {
  const rows = Array.from({ length: 10 }, (_, suffix) => ({
    suffix,
    specificationNumber: pickExact(fields, FIELD_ALIASES.specificationNumber, suffix),
    designNumber: pickExact(fields, FIELD_ALIASES.designNumber, suffix),
    csr: pickExact(fields, FIELD_ALIASES.csr, suffix),
    designer: pickExact(fields, FIELD_ALIASES.designer, suffix),
    revisionLabel: pickExact(fields, FIELD_ALIASES.revisionLabel, suffix),
    revisionDate: pickExact(fields, FIELD_ALIASES.revisionDate, suffix),
    description: pickExact(fields, FIELD_ALIASES.description, suffix),
  })).filter((row) => Object.entries(row).some(([key, value]) => key !== 'suffix' && Boolean(value)));

  rows.sort((a, b) => {
    const aNumeric = /^\d+$/.test(a.revisionLabel) ? Number(a.revisionLabel) : -1;
    const bNumeric = /^\d+$/.test(b.revisionLabel) ? Number(b.revisionLabel) : -1;
    return aNumeric === bNumeric ? a.suffix - b.suffix : aNumeric - bNumeric;
  });

  const latest = rows.at(-1);
  return {
    specificationNumber: latest?.specificationNumber ?? '',
    designNumber: latest?.designNumber ?? '',
    csr: latest?.csr ?? '',
    designer: latest?.designer ?? '',
    revisionLabel: latest?.revisionLabel ?? '',
    revisionDate: latest?.revisionDate ?? '',
    description: latest?.description ?? '',
  };
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
  const pdfResult = await readPdfFields(graphicId);
  const pdf = normalizedFields(pdfResult?.fields ?? null);
  const pdfRevision = latestRevisionRow(pdf);
  const sources: Record<string, string> = {};
  const pdfSource = pdfResult ? `Approval PDF · ${pdfResult.fileName}` : 'Approval PDF';

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

  const pdfValue = (key: keyof typeof FIELD_ALIASES) => pickAcrossRows(pdf, FIELD_ALIASES[key]) || pdfRevision[key];

  const specificationNumber = choose('specificationNumber', [
    ['V3 graphic metadata', graphic.specificationNumber],
    ['Latest print card', latest?.specificationNumber ?? ''],
    ['Latest approval revision', clean(approvalRow?.spec_number)],
    [pdfSource, pdfValue('specificationNumber')],
  ]);
  const designNumber = choose('designNumber', [
    ['Latest print card', latest?.designNumber ?? ''],
    ['Latest approval revision', clean(approvalRow?.d_number)],
    [pdfSource, pdfValue('designNumber')],
  ]);
  const csr = choose('csr', [
    ['Latest print card', latest?.csr ?? ''],
    ['Latest approval revision', clean(approvalRow?.csr)],
    [pdfSource, pdfValue('csr')],
  ]);
  const designer = choose('designer', [
    ['Latest print card', latest?.designer ?? ''],
    ['Latest approval revision', clean(approvalRow?.des)],
    [pdfSource, pdfValue('designer')],
  ]);
  const description = choose('description', [
    ['Latest approval revision', clean(approvalRow?.description)],
    [pdfSource, pdfValue('description')],
  ]);

  const currentApprovalRev = clean(approvalRow?.rev) || pdfValue('revisionLabel');
  const revisionLabel = history.length ? nextRevision(latest?.revisionLabel ?? '') : (currentApprovalRev || '0');
  sources.revisionLabel = history.length ? 'Next print card revision' : currentApprovalRev ? 'Current approval revision' : 'Initial revision';
  sources.revisionDate = 'Today';

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
      approvalFound: Boolean(indexedApprovalCandidates(graphicId).length || approvalRow),
      approvalFieldsRead: Boolean(pdfResult),
      sources,
      message: pdfResult
        ? `Approval fields were read from ${pdfResult.fileName} and combined with structured GraphicsFlow data.`
        : 'Defaults were loaded from structured data. Matching approval form fields were unavailable or flattened.',
    },
  });
}
