import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  createPrintCardResponseSchema,
  renderPrintCardSvg,
  type CreatePrintCardResponse,
  type PrintCardDraft,
  type PrintCardTemplateRevision,
} from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { getCompanySettings } from './settings-store.js';

const execFileAsync = promisify(execFile);

function clean(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function numberOnly(value: string): string {
  return value.match(/\d+/g)?.join('') ?? '';
}

async function commandExists(command: string, args: string[] = ['--version']): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function imageMagick(): Promise<string> {
  if (await commandExists('magick')) return 'magick';
  if (await commandExists('convert')) return 'convert';
  throw new Error('ImageMagick is required to generate production Print Cards.');
}

async function ghostscript(): Promise<string | null> {
  const candidates = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/opt/local/bin/gs', '/usr/bin/gs'];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return await commandExists('gs') ? 'gs' : null;
}

function revisionHistory(graphicId: number, gNumber: string): PrintCardTemplateRevision[] {
  const rows: PrintCardTemplateRevision[] = [];
  const base = numberOnly(gNumber).replace(/^0+/, '');
  if (base) {
    try {
      const legacyRows = legacyDatabase.prepare(`
        SELECT rev, rev_date, description, csr, des
        FROM print_card_revisions
        WHERE CAST(REPLACE(REPLACE(REPLACE(UPPER(TRIM(COALESCE(g_number, ''))), 'G', ''), '#', ''), ' ', '') AS INTEGER) = ?
        ORDER BY CASE WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER) ELSE 999999 END ASC, id ASC
      `).all(Number(base)) as Array<Record<string, unknown>>;
      for (const row of legacyRows) rows.push({
        revisionLabel: clean(row.rev), revisionDate: clean(row.rev_date), description: clean(row.description),
        csr: clean(row.csr), designer: clean(row.des),
      });
    } catch {
      // Legacy history is an optional migration fallback.
    }
  }
  const v3Rows = graphicsStoreDatabase.prepare(`
    SELECT r.revision_label, r.revision_date, r.description, r.csr, r.designer
    FROM graphics_documents d
    INNER JOIN document_revisions r ON r.document_id = d.id
    WHERE d.graphic_id = ? AND d.document_type = 'printCard'
    ORDER BY r.created_at ASC, r.id ASC
  `).all(graphicId) as Array<Record<string, unknown>>;
  for (const row of v3Rows) rows.push({
    revisionLabel: clean(row.revision_label), revisionDate: clean(row.revision_date), description: clean(row.description),
    csr: clean(row.csr), designer: clean(row.designer),
  });
  return rows;
}

async function renderPdfArtwork(pdfPath: string, artPath: string): Promise<void> {
  const gs = await ghostscript();
  if (gs) {
    await execFileAsync(gs, [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dFirstPage=1', '-dLastPage=1', '-sDEVICE=jpeg',
      '-dJPEGQ=95', '-r300', '-dGraphicsAlphaBits=4', '-dTextAlphaBits=4',
      `-sOutputFile=${artPath}`, pdfPath,
    ], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  } else {
    const magick = await imageMagick();
    await execFileAsync(magick, ['-density', '300', `${pdfPath}[0]`, '-background', 'white', '-alpha', 'remove', '-quality', '95', artPath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  }
  const magick = await imageMagick();
  await execFileAsync(magick, [artPath, '-resize', '2700x1200!', '-background', 'white', '-gravity', 'center', '-extent', '2700x1200', artPath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
}

async function renderInfoPanel(svg: string, infoPath: string): Promise<void> {
  const svgPath = `${infoPath}.svg`;
  await writeFile(svgPath, svg, 'utf8');
  try {
    const magick = await imageMagick();
    await execFileAsync(magick, [svgPath, '-resize', '300x1200!', '-background', 'white', '-alpha', 'remove', '-quality', '95', infoPath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  } finally {
    await rm(svgPath, { force: true });
  }
}

async function combine(artPath: string, infoPath: string, targetPath: string): Promise<void> {
  const magick = await imageMagick();
  await execFileAsync(magick, [artPath, infoPath, '+append', '-resize', '3000x1200!', '-units', 'PixelsPerInch', '-density', '300', '-quality', '95', '-strip', targetPath], { timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
}

export async function createProductionPrintCard(graphicId: number, draft: PrintCardDraft): Promise<CreatePrintCardResponse> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) throw new Error('Graphics record not found.');
  const root = getCompanySettings().storage.printCardsRoot.trim();
  if (!root) throw new Error('Configure the Print Card storage folder in Company Settings first.');
  await mkdir(root, { recursive: true });

  const fileBase = numberOnly(draft.specificationNumber) || clean(draft.specificationNumber).replace(/[^A-Z0-9_-]/g, '_');
  if (!fileBase) throw new Error('Spec # cannot be converted into a valid Print Card filename.');
  const fileName = `${fileBase}.jpg`;
  const finalPath = resolve(root, fileName);
  if (dirname(finalPath) !== resolve(root)) throw new Error('The Print Card output path is invalid.');

  let hadExisting = false;
  try { await access(finalPath, constants.F_OK); hadExisting = true; } catch { hadExisting = false; }
  if (hadExisting && !draft.replaceExistingImage) throw new Error(`${fileName} already exists. Enable Replace Existing Image to intentionally update it.`);
  if (!draft.artPdfBase64 && !hadExisting) throw new Error('Upload the 9 × 4 inch artwork PDF before generating the Print Card.');
  if (draft.artPdfBase64 && !draft.artPdfName.toLowerCase().endsWith('.pdf')) throw new Error('Print Card artwork must be a PDF.');

  const token = `${process.pid}.${Date.now()}`;
  const pdfPath = join(root, `.${fileBase}.${token}.art.pdf`);
  const artPath = join(root, `.${fileBase}.${token}.art.jpg`);
  const infoPath = join(root, `.${fileBase}.${token}.info.jpg`);
  const tempPath = join(root, `.${fileBase}.${token}.tmp.jpg`);
  const backupPath = join(root, `.${fileBase}.${token}.backup.jpg`);

  try {
    if (draft.artPdfBase64) {
      const data = Buffer.from(draft.artPdfBase64, 'base64');
      if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded artwork is not a valid PDF.');
      await writeFile(pdfPath, data);
      await renderPdfArtwork(pdfPath, artPath);
    } else {
      const magick = await imageMagick();
      await execFileAsync(magick, [finalPath, '-crop', '2700x1200+0+0', '+repage', artPath], { timeout: 120000 });
    }

    const revisions = [...revisionHistory(graphicId, graphic.gNumber), {
      revisionLabel: draft.revisionLabel, revisionDate: draft.revisionDate, description: draft.description,
      csr: draft.csr, designer: draft.designer,
    }].slice(-4);
    await renderInfoPanel(renderPrintCardSvg({
      gNumber: graphic.gNumber, customerNumber: graphic.customerNumber, customerName: graphic.customerName,
      partNumber: graphic.partNumber, specificationNumber: draft.specificationNumber,
      designNumber: draft.designNumber, revisions,
    }), infoPath);
    await combine(artPath, infoPath, tempPath);

    graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      graphicsStoreDatabase.prepare(`
        INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at)
        VALUES (?, 'printCard', 'active', ?, ?)
        ON CONFLICT(graphic_id, document_type) DO UPDATE SET status = 'active', updated_at = excluded.updated_at
      `).run(graphicId, now, now);
      const document = graphicsStoreDatabase.prepare(`SELECT id FROM graphics_documents WHERE graphic_id = ? AND document_type = 'printCard'`).get(graphicId) as { id: number };
      const result = graphicsStoreDatabase.prepare(`
        INSERT INTO document_revisions (document_id, revision_label, revision_date, description, specification_number, design_number, csr, designer, rendered_relative_path, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'graphicsflow', ?)
      `).run(document.id, clean(draft.revisionLabel), clean(draft.revisionDate), clean(draft.description), clean(draft.specificationNumber), clean(draft.designNumber), clean(draft.csr), clean(draft.designer), fileName, now);
      const revisionId = Number(result.lastInsertRowid);
      graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id = ?, updated_at = ? WHERE id = ?').run(revisionId, now, document.id);
      if (hadExisting) await rename(finalPath, backupPath);
      await rename(tempPath, finalPath);
      graphicsStoreDatabase.exec('COMMIT');
      await rm(backupPath, { force: true });
      return createPrintCardResponseSchema.parse({
        graphicId, fileName, relativePath: fileName, replacedExistingImage: hadExisting,
        revision: { id: revisionId, revisionLabel: clean(draft.revisionLabel), revisionDate: clean(draft.revisionDate), description: clean(draft.description), csr: clean(draft.csr), designer: clean(draft.designer), specificationNumber: clean(draft.specificationNumber), designNumber: clean(draft.designNumber), renderedRelativePath: fileName, createdAt: now, source: 'graphicsflow' },
      });
    } catch (error) {
      graphicsStoreDatabase.exec('ROLLBACK');
      try { await access(backupPath, constants.F_OK); await rm(finalPath, { force: true }); await rename(backupPath, finalPath); } catch { /* No backup. */ }
      throw error;
    }
  } finally {
    await Promise.all([pdfPath, artPath, infoPath, tempPath].map((path) => rm(path, { force: true })));
  }
}

export async function readProductionPrintCard(graphicId: number): Promise<{ data: Buffer; fileName: string } | null> {
  const row = graphicsStoreDatabase.prepare(`SELECT r.rendered_relative_path FROM graphics_documents d INNER JOIN document_revisions r ON r.id = d.current_revision_id WHERE d.graphic_id = ? AND d.document_type = 'printCard'`).get(graphicId) as { rendered_relative_path: string | null } | undefined;
  if (!row?.rendered_relative_path) return null;
  const root = resolve(getCompanySettings().storage.printCardsRoot);
  const path = resolve(root, row.rendered_relative_path);
  if (dirname(path) !== root || extname(path).toLowerCase() !== '.jpg') return null;
  try { return { data: await readFile(path), fileName: basename(path) }; } catch { return null; }
}
