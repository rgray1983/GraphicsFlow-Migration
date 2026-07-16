import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { renderHccApprovalPdf, type ApprovalPreviewInput } from './approval-creator-preview-service.js';
import { getApprovalRevisionDetail } from './approval-revision-service.js';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { findPrintCardArtworkMatches } from './print-card-artwork-service.js';
import { settingsDatabasePath } from './settings-store.js';

const managedRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'approvals');
const temporaryRoot = resolve(managedRoot, 'temporary');
const clean = (value: unknown) => String(value ?? '').trim().toUpperCase();
const numberOnly = (value: unknown) => String(value ?? '').match(/\d+/g)?.join('') ?? '';
const approvalFileName = (gNumber: unknown) => `${numberOnly(gNumber)}_APPROVAL.pdf`;

export type SavedApprovalResult = {
  graphicId: number;
  revisionId: number;
  revisionLabel: string;
  fileName: string;
  pdfUrl: string;
  downloadUrl: string;
};

function isTemporaryApprovalPath(path: string): boolean {
  return path === temporaryRoot || path.startsWith(`${temporaryRoot}${sep}`);
}

async function removeTemporaryApproval(path: string, revisionId: number): Promise<void> {
  if (path && isTemporaryApprovalPath(path)) await rm(path, { force: true });
  graphicsStoreDatabase.prepare('UPDATE document_revisions SET rendered_relative_path=NULL WHERE id=?').run(revisionId);
}

function scheduleTemporaryApprovalRemoval(path: string, revisionId: number): void {
  const timer = setTimeout(() => {
    void removeTemporaryApproval(path, revisionId);
  }, 0);
  timer.unref();
}

export async function clearApprovalTemporaryFiles(): Promise<void> {
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  graphicsStoreDatabase.prepare(`
    UPDATE document_revisions
    SET rendered_relative_path=NULL
    WHERE rendered_relative_path LIKE 'temporary/%'
  `).run();
}

async function regenerateTemporaryApproval(graphicId: number, revisionId: number): Promise<{ path: string; fileName: string } | null> {
  const graphic = getGraphicById(graphicId);
  const revision = getApprovalRevisionDetail(graphicId, revisionId);
  if (!graphic || !revision) return null;

  let artworkRelativePath = revision.artworkRelativePath.trim();
  let artworkName = revision.artworkName.trim();
  if (!artworkRelativePath) {
    const matches = await findPrintCardArtworkMatches(graphicId);
    const selected = matches?.matches.find((match) => match.classification === 'approval') ?? matches?.matches[0];
    if (selected) {
      artworkRelativePath = selected.relativePath;
      artworkName = selected.name;
    }
  }
  if (!artworkRelativePath) throw new Error('Connect an artwork PDF before regenerating this Approval.');

  const input: ApprovalPreviewInput = {
    gNumber: graphic.gNumber,
    customerNumber: graphic.customerNumber,
    customerName: graphic.customerName,
    partNumber: graphic.partNumber,
    specificationNumber: revision.specificationNumber,
    designNumber: revision.designNumber,
    fluteTest: revision.fluteTest,
    salesRep: revision.salesRep,
    revisionLabel: revision.revisionLabel,
    revisionDate: revision.revisionDate,
    description: revision.description,
    csr: revision.csr,
    designer: revision.designer,
    digitalPrint: revision.digitalPrint,
    digitalCut: revision.digitalCut,
    digitalDieCut: revision.digitalDieCut,
    labelDieCut: revision.labelDieCut,
    label4cProcess: revision.label4cProcess,
    artPdfName: artworkName,
    artPdfBase64: '',
    liveArtworkRelativePath: artworkRelativePath,
  };

  await mkdir(temporaryRoot, { recursive: true });
  const cleanG = numberOnly(graphic.gNumber);
  const cleanRevision = clean(revision.revisionLabel) || '0';
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const temporaryName = `${cleanG}.${cleanRevision.replace(/[^A-Z0-9_-]/g, '_')}.${token}.pdf`;
  const path = resolve(temporaryRoot, temporaryName);
  if (!isTemporaryApprovalPath(path)) throw new Error('The temporary Approval output path is invalid.');
  await writeFile(path, await renderHccApprovalPdf(input));
  graphicsStoreDatabase.prepare('UPDATE document_revisions SET rendered_relative_path=? WHERE id=?').run(`temporary/${temporaryName}`, revisionId);
  return { path, fileName: approvalFileName(graphic.gNumber) };
}

export async function saveManagedApproval(graphicId: number, input: ApprovalPreviewInput): Promise<SavedApprovalResult> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) throw new Error('Graphics record not found.');

  await mkdir(temporaryRoot, { recursive: true });
  const cleanG = numberOnly(graphic.gNumber);
  const cleanRevision = clean(input.revisionLabel) || '0';
  if (!cleanG) throw new Error('The G# cannot be converted into a valid Approval filename.');

  const fileName = approvalFileName(graphic.gNumber);
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const temporaryName = `${cleanG}.${cleanRevision.replace(/[^A-Z0-9_-]/g, '_')}.${token}.pdf`;
  const temporaryPath = resolve(temporaryRoot, temporaryName);
  if (!isTemporaryApprovalPath(temporaryPath)) throw new Error('The temporary Approval output path is invalid.');

  const pdf = await renderHccApprovalPdf(input);
  await writeFile(temporaryPath, pdf);

  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    const now = new Date().toISOString();
    graphicsStoreDatabase.prepare(`INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at) VALUES (?, 'approval', 'active', ?, ?) ON CONFLICT(graphic_id, document_type) DO UPDATE SET status='active', updated_at=excluded.updated_at`).run(graphicId, now, now);
    const document = graphicsStoreDatabase.prepare(`SELECT id FROM graphics_documents WHERE graphic_id=? AND document_type='approval'`).get(graphicId) as { id: number };
    const duplicate = graphicsStoreDatabase.prepare(`SELECT id FROM document_revisions WHERE document_id=? AND UPPER(TRIM(revision_label))=?`).get(document.id, cleanRevision);
    if (duplicate) throw new Error(`Revision ${cleanRevision} already exists for this Approval.`);

    const temporaryRelativePath = `temporary/${temporaryName}`;
    const result = graphicsStoreDatabase.prepare(`
      INSERT INTO document_revisions (
        document_id, revision_label, revision_date, description,
        specification_number, design_number, flute_test, sales_rep,
        csr, designer,
        digital_print, digital_cut, digital_die_cut, label_die_cut, label_4c_process,
        artwork_name, artwork_relative_path,
        rendered_relative_path, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'graphicsflow', ?)
    `).run(
      document.id, cleanRevision, clean(input.revisionDate), clean(input.description), clean(input.specificationNumber), clean(input.designNumber),
      clean(input.fluteTest), clean(input.salesRep), clean(input.csr), clean(input.designer), input.digitalPrint ? 1 : 0, input.digitalCut ? 1 : 0,
      input.digitalDieCut ? 1 : 0, input.labelDieCut ? 1 : 0, input.label4cProcess ? 1 : 0, clean(input.artPdfName), input.liveArtworkRelativePath.trim(),
      temporaryRelativePath, now,
    );
    const revisionId = Number(result.lastInsertRowid);
    graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id=?, updated_at=? WHERE id=?').run(revisionId, now, document.id);
    graphicsStoreDatabase.exec('COMMIT');

    return { graphicId, revisionId, revisionLabel: cleanRevision, fileName, pdfUrl: `/api/graphics/${graphicId}/approval/revisions/${revisionId}.pdf`, downloadUrl: `/api/graphics/${graphicId}/approval/revisions/${revisionId}.pdf?download=1` };
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function discardManagedApprovalRevision(graphicId: number, revisionId: number): Promise<boolean> {
  const row = graphicsStoreDatabase.prepare(`
    SELECT r.rendered_relative_path
    FROM graphics_documents d
    INNER JOIN document_revisions r ON r.document_id=d.id
    WHERE d.graphic_id=? AND d.document_type='approval' AND r.id=?
  `).get(graphicId, revisionId) as { rendered_relative_path: string | null } | undefined;
  if (!row) return false;

  const path = row.rendered_relative_path ? resolve(managedRoot, row.rendered_relative_path) : '';
  await removeTemporaryApproval(path, revisionId);
  return true;
}

export async function readManagedApprovalRevision(graphicId: number, revisionId: number, consume = false): Promise<{ data: Buffer; fileName: string } | null> {
  const row = graphicsStoreDatabase.prepare(`SELECT r.rendered_relative_path, r.revision_label, g.g_number FROM graphics_documents d INNER JOIN document_revisions r ON r.document_id=d.id INNER JOIN graphics_records g ON g.id=d.graphic_id WHERE d.graphic_id=? AND d.document_type='approval' AND r.id=?`).get(graphicId, revisionId) as { rendered_relative_path: string | null; revision_label: string; g_number: string } | undefined;
  if (!row) return null;

  let path = row.rendered_relative_path ? resolve(managedRoot, row.rendered_relative_path) : '';
  if (!path || !isTemporaryApprovalPath(path)) {
    const regenerated = await regenerateTemporaryApproval(graphicId, revisionId);
    if (!regenerated) return null;
    path = regenerated.path;
  }

  try {
    const data = await readFile(path);
    const fileName = approvalFileName(row.g_number);
    if (consume) scheduleTemporaryApprovalRemoval(path, revisionId);
    return { data, fileName: basename(fileName) };
  } catch {
    const regenerated = await regenerateTemporaryApproval(graphicId, revisionId);
    if (!regenerated) return null;
    const data = await readFile(regenerated.path);
    if (consume) scheduleTemporaryApprovalRemoval(regenerated.path, revisionId);
    return { data, fileName: basename(regenerated.fileName) };
  }
}
