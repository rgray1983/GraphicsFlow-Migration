import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { renderHccApprovalPdf, type ApprovalPreviewInput } from './approval-creator-preview-service.js';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { settingsDatabasePath } from './settings-store.js';

const managedRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'approvals');
const clean = (value: unknown) => String(value ?? '').trim().toUpperCase();
const numberOnly = (value: unknown) => String(value ?? '').match(/\d+/g)?.join('') ?? '';

export type SavedApprovalResult = {
  graphicId: number;
  revisionId: number;
  revisionLabel: string;
  fileName: string;
  pdfUrl: string;
  downloadUrl: string;
};

export async function saveManagedApproval(graphicId: number, input: ApprovalPreviewInput): Promise<SavedApprovalResult> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) throw new Error('Graphics record not found.');

  await mkdir(managedRoot, { recursive: true });
  const cleanG = numberOnly(graphic.gNumber);
  const cleanRevision = clean(input.revisionLabel) || '0';
  if (!cleanG) throw new Error('The G# cannot be converted into a valid Approval filename.');

  const fileName = `${cleanG}_REV_${cleanRevision.replace(/[^A-Z0-9_-]/g, '_')}_APPROVAL.pdf`;
  const finalPath = resolve(managedRoot, fileName);
  if (dirname(finalPath) !== managedRoot || extname(finalPath).toLowerCase() !== '.pdf') throw new Error('The managed Approval output path is invalid.');

  try {
    await access(finalPath, constants.F_OK);
    throw new Error(`Revision ${cleanRevision} already exists for this Approval.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) throw error;
  }

  const token = `${process.pid}.${Date.now()}`;
  const tempPath = resolve(managedRoot, `.${fileName}.${token}.tmp`);
  const pdf = await renderHccApprovalPdf(input);
  await writeFile(tempPath, pdf);

  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    const now = new Date().toISOString();
    graphicsStoreDatabase.prepare(`INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at) VALUES (?, 'approval', 'active', ?, ?) ON CONFLICT(graphic_id, document_type) DO UPDATE SET status='active', updated_at=excluded.updated_at`).run(graphicId, now, now);
    const document = graphicsStoreDatabase.prepare(`SELECT id FROM graphics_documents WHERE graphic_id=? AND document_type='approval'`).get(graphicId) as { id: number };
    const duplicate = graphicsStoreDatabase.prepare(`SELECT id FROM document_revisions WHERE document_id=? AND UPPER(TRIM(revision_label))=?`).get(document.id, cleanRevision);
    if (duplicate) throw new Error(`Revision ${cleanRevision} already exists for this Approval.`);

    const result = graphicsStoreDatabase.prepare(`INSERT INTO document_revisions (document_id, revision_label, revision_date, description, specification_number, design_number, csr, designer, rendered_relative_path, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'graphicsflow', ?)`).run(
      document.id,
      cleanRevision,
      clean(input.revisionDate),
      clean(input.description),
      clean(input.specificationNumber),
      clean(input.designNumber),
      clean(input.csr),
      clean(input.designer),
      fileName,
      now,
    );
    const revisionId = Number(result.lastInsertRowid);
    graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id=?, updated_at=? WHERE id=?').run(revisionId, now, document.id);
    await rename(tempPath, finalPath);
    graphicsStoreDatabase.exec('COMMIT');

    return {
      graphicId,
      revisionId,
      revisionLabel: cleanRevision,
      fileName,
      pdfUrl: `/api/graphics/${graphicId}/approval/revisions/${revisionId}.pdf`,
      downloadUrl: `/api/graphics/${graphicId}/approval/revisions/${revisionId}.pdf?download=1`,
    };
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    await rm(tempPath, { force: true });
    await rm(finalPath, { force: true });
    throw error;
  }
}

export async function readManagedApprovalRevision(graphicId: number, revisionId: number): Promise<{ data: Buffer; fileName: string } | null> {
  const row = graphicsStoreDatabase.prepare(`SELECT r.rendered_relative_path FROM graphics_documents d INNER JOIN document_revisions r ON r.document_id=d.id WHERE d.graphic_id=? AND d.document_type='approval' AND r.id=?`).get(graphicId, revisionId) as { rendered_relative_path: string | null } | undefined;
  if (!row?.rendered_relative_path) return null;
  const path = resolve(managedRoot, row.rendered_relative_path);
  if (dirname(path) !== managedRoot || extname(path).toLowerCase() !== '.pdf') return null;
  try { return { data: await readFile(path), fileName: basename(path) }; } catch { return null; }
}
