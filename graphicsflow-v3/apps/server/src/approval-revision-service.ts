import type { ApprovalRevisionDetail, ApprovalRevisionUpdate } from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { graphicsStoreDatabase } from './graphics-store.js';

const clean = (value: unknown) => String(value ?? '').trim().toUpperCase();
const normalizedG = (value: unknown) => (String(value ?? '').match(/\d+/g)?.join('') ?? '').replace(/^0+/, '');
const truthy = (value: unknown) => ['1', 'YES', 'ON', 'TRUE'].includes(clean(value));

function ensureApprovalDocument(graphicId: number): number {
  const now = new Date().toISOString();
  graphicsStoreDatabase.prepare(`
    INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at)
    VALUES (?, 'approval', 'active', ?, ?)
    ON CONFLICT(graphic_id, document_type) DO NOTHING
  `).run(graphicId, now, now);
  const row = graphicsStoreDatabase.prepare(`SELECT id FROM graphics_documents WHERE graphic_id=? AND document_type='approval'`).get(graphicId) as { id: number } | undefined;
  if (!row) throw new Error('The Approval document record could not be prepared.');
  return row.id;
}

export function importLegacyApprovalRevisions(graphicId: number, gNumber: string): number {
  const documentId = ensureApprovalDocument(graphicId);
  const g = normalizedG(gNumber);
  if (!g) return 0;

  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = legacyDatabase.prepare(`
      SELECT * FROM approval_revisions
      WHERE REPLACE(REPLACE(COALESCE(g_number,''), 'G#', ''), '#', '') = ?
      ORDER BY id ASC
    `).all(g) as Array<Record<string, unknown>>;
  } catch {
    return 0;
  }

  const insert = graphicsStoreDatabase.prepare(`
    INSERT INTO document_revisions (
      document_id, revision_label, revision_date, description, specification_number, design_number,
      csr, designer, source_relative_path, rendered_relative_path, source, legacy_revision_id,
      created_at, flute_test, sales_rep, digital_print, digital_cut, digital_die_cut,
      label_die_cut, label_4c_process, artwork_name, artwork_relative_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'legacy-import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let imported = 0;
  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const legacyId = Number(row.id);
      if (!Number.isInteger(legacyId) || legacyId <= 0) continue;
      const exists = graphicsStoreDatabase.prepare(`SELECT id FROM document_revisions WHERE document_id=? AND legacy_revision_id=?`).get(documentId, legacyId);
      if (exists) continue;
      const approvalPdf = String(row.approval_pdf ?? '').trim();
      insert.run(
        documentId,
        clean(row.rev || '0'),
        String(row.rev_date ?? row.approval_date ?? '').trim(),
        clean(row.description),
        clean(row.spec_number),
        clean(row.d_number),
        clean(row.csr),
        clean(row.dsr),
        approvalPdf || null,
        legacyId,
        String(row.created_at ?? new Date().toISOString()),
        clean(row.test_flute),
        clean(row.sales_rep),
        truthy(row.digital_print) ? 1 : 0,
        truthy(row.digital_cut) ? 1 : 0,
        truthy(row.digital_die_cut) ? 1 : 0,
        truthy(row.label_die_cut) ? 1 : 0,
        truthy(row.label_4c_process) ? 1 : 0,
        approvalPdf ? approvalPdf.split('/').at(-1) ?? '' : '',
        '',
      );
      imported += 1;
    }
    const current = graphicsStoreDatabase.prepare(`SELECT current_revision_id FROM graphics_documents WHERE id=?`).get(documentId) as { current_revision_id: number | null };
    if (!current.current_revision_id) {
      const newest = graphicsStoreDatabase.prepare(`SELECT id FROM document_revisions WHERE document_id=? ORDER BY id DESC LIMIT 1`).get(documentId) as { id: number } | undefined;
      if (newest) graphicsStoreDatabase.prepare(`UPDATE graphics_documents SET current_revision_id=?, updated_at=? WHERE id=?`).run(newest.id, new Date().toISOString(), documentId);
    }
    graphicsStoreDatabase.exec('COMMIT');
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    throw error;
  }
  return imported;
}

function mapDetail(row: Record<string, unknown>): ApprovalRevisionDetail {
  return {
    id: Number(row.id), graphicId: Number(row.graphic_id), revisionLabel: clean(row.revision_label),
    revisionDate: String(row.revision_date ?? ''), description: clean(row.description),
    specificationNumber: clean(row.specification_number), designNumber: clean(row.design_number),
    fluteTest: clean(row.flute_test), salesRep: clean(row.sales_rep), csr: clean(row.csr), designer: clean(row.designer),
    digitalPrint: Number(row.digital_print) === 1, digitalCut: Number(row.digital_cut) === 1,
    digitalDieCut: Number(row.digital_die_cut) === 1, labelDieCut: Number(row.label_die_cut) === 1,
    label4cProcess: Number(row.label_4c_process) === 1, artworkName: String(row.artwork_name ?? ''),
    artworkRelativePath: String(row.artwork_relative_path ?? ''), source: row.source === 'legacy-import' ? 'legacy-import' : 'graphicsflow',
    legacyRevisionId: row.legacy_revision_id == null ? null : Number(row.legacy_revision_id),
    isCurrent: Number(row.current_revision_id) === Number(row.id),
  };
}

export function getApprovalRevisionDetail(graphicId: number, revisionId: number): ApprovalRevisionDetail | null {
  const row = graphicsStoreDatabase.prepare(`
    SELECT r.*, d.graphic_id, d.current_revision_id
    FROM document_revisions r
    INNER JOIN graphics_documents d ON d.id=r.document_id
    WHERE d.graphic_id=? AND d.document_type='approval' AND r.id=?
  `).get(graphicId, revisionId) as Record<string, unknown> | undefined;
  return row ? mapDetail(row) : null;
}

export function updateApprovalRevision(graphicId: number, revisionId: number, input: ApprovalRevisionUpdate): ApprovalRevisionDetail {
  const existing = getApprovalRevisionDetail(graphicId, revisionId);
  if (!existing) throw new Error('Approval revision not found.');
  const duplicate = graphicsStoreDatabase.prepare(`
    SELECT r.id FROM document_revisions r
    INNER JOIN graphics_documents d ON d.id=r.document_id
    WHERE d.graphic_id=? AND d.document_type='approval' AND UPPER(TRIM(r.revision_label))=? AND r.id<>?
  `).get(graphicId, clean(input.revisionLabel), revisionId);
  if (duplicate) throw new Error(`Revision ${clean(input.revisionLabel)} already exists for this Approval.`);

  graphicsStoreDatabase.prepare(`
    UPDATE document_revisions SET revision_label=?, revision_date=?, description=?, specification_number=?, design_number=?,
      flute_test=?, sales_rep=?, csr=?, designer=?, digital_print=?, digital_cut=?, digital_die_cut=?,
      label_die_cut=?, label_4c_process=?, artwork_name=?, artwork_relative_path=?
    WHERE id=?
  `).run(
    clean(input.revisionLabel), input.revisionDate.trim(), clean(input.description), clean(input.specificationNumber),
    clean(input.designNumber), clean(input.fluteTest), clean(input.salesRep), clean(input.csr), clean(input.designer),
    input.digitalPrint ? 1 : 0, input.digitalCut ? 1 : 0, input.digitalDieCut ? 1 : 0,
    input.labelDieCut ? 1 : 0, input.label4cProcess ? 1 : 0, input.artworkName.trim(), input.artworkRelativePath.trim(), revisionId,
  );
  const updated = getApprovalRevisionDetail(graphicId, revisionId);
  if (!updated) throw new Error('The updated Approval revision could not be reloaded.');
  return updated;
}
