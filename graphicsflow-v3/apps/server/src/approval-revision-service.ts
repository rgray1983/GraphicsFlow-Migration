import type { ApprovalRevisionDetail, ApprovalRevisionUpdate } from '@graphicsflow/shared';
import { storeApprovalRevisionArtwork } from './approval-revision-artwork-service.js';
import { database as legacyDatabase } from './database.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { getOriginalApprovalRevisionSnapshot } from './print-card-preview-service.js';

const clean = (value: unknown) => String(value ?? '').trim().toUpperCase();
const normalizedG = (value: unknown) => (String(value ?? '').match(/\d+/g)?.join('') ?? '').replace(/^0+/, '');
const truthy = (value: unknown) => ['1', 'YES', 'ON', 'TRUE'].includes(clean(value));

function normalizeRevisionDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const usMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (usMatch) {
    const [, month, day, rawYear] = usMatch;
    const yearNumber = Number(rawYear);
    const year = rawYear.length === 2 ? String(yearNumber >= 70 ? 1900 + yearNumber : 2000 + yearNumber) : rawYear;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
        normalizeRevisionDate(row.rev_date ?? row.approval_date),
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

    const importedRows = graphicsStoreDatabase.prepare(`
      SELECT id, revision_date
      FROM document_revisions
      WHERE document_id=? AND source='legacy-import'
    `).all(documentId) as Array<{ id: number; revision_date: string | null }>;
    const updateDate = graphicsStoreDatabase.prepare('UPDATE document_revisions SET revision_date=? WHERE id=?');
    for (const row of importedRows) {
      const normalized = normalizeRevisionDate(row.revision_date);
      if (normalized && normalized !== String(row.revision_date ?? '')) updateDate.run(normalized, row.id);
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

export async function syncOriginalApprovalRevisionRecords(graphicId: number): Promise<number> {
  const documentId = ensureApprovalDocument(graphicId);
  const snapshot = await getOriginalApprovalRevisionSnapshot(graphicId);
  if (!snapshot || snapshot.revisions.length === 0) return 0;

  const findRevision = graphicsStoreDatabase.prepare(`
    SELECT id FROM document_revisions
    WHERE document_id=? AND UPPER(TRIM(revision_label))=?
    ORDER BY CASE WHEN source='graphicsflow' THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  `);
  const insert = graphicsStoreDatabase.prepare(`
    INSERT INTO document_revisions (
      document_id, revision_label, revision_date, description, specification_number, design_number,
      csr, designer, source_relative_path, rendered_relative_path, source, legacy_revision_id,
      created_at, flute_test, sales_rep, digital_print, digital_cut, digital_die_cut,
      label_die_cut, label_4c_process, artwork_name, artwork_relative_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'legacy-import', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `);
  const hydrate = graphicsStoreDatabase.prepare(`
    UPDATE document_revisions SET
      revision_date=CASE WHEN TRIM(COALESCE(revision_date,''))='' THEN ? ELSE revision_date END,
      description=CASE WHEN TRIM(COALESCE(description,''))='' THEN ? ELSE description END,
      specification_number=CASE WHEN TRIM(COALESCE(specification_number,''))='' THEN ? ELSE specification_number END,
      design_number=CASE WHEN TRIM(COALESCE(design_number,''))='' THEN ? ELSE design_number END,
      flute_test=CASE WHEN TRIM(COALESCE(flute_test,''))='' THEN ? ELSE flute_test END,
      sales_rep=CASE WHEN TRIM(COALESCE(sales_rep,''))='' THEN ? ELSE sales_rep END,
      csr=CASE WHEN TRIM(COALESCE(csr,''))='' THEN ? ELSE csr END,
      designer=CASE WHEN TRIM(COALESCE(designer,''))='' THEN ? ELSE designer END,
      digital_print=CASE WHEN digital_print=0 THEN ? ELSE digital_print END,
      digital_cut=CASE WHEN digital_cut=0 THEN ? ELSE digital_cut END,
      digital_die_cut=CASE WHEN digital_die_cut=0 THEN ? ELSE digital_die_cut END,
      label_die_cut=CASE WHEN label_die_cut=0 THEN ? ELSE label_die_cut END,
      label_4c_process=CASE WHEN label_4c_process=0 THEN ? ELSE label_4c_process END,
      source_relative_path=CASE WHEN TRIM(COALESCE(source_relative_path,''))='' THEN ? ELSE source_relative_path END,
      artwork_name=CASE WHEN TRIM(COALESCE(artwork_name,''))='' THEN ? ELSE artwork_name END
    WHERE id=?
  `);

  let created = 0;
  let currentRevisionId: number | null = null;
  const now = new Date().toISOString();
  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    for (const revision of snapshot.revisions) {
      const label = clean(revision.revisionLabel || '0');
      const existing = findRevision.get(documentId, label) as { id: number } | undefined;
      if (existing) {
        hydrate.run(
          normalizeRevisionDate(revision.revisionDate), clean(revision.description), clean(snapshot.specificationNumber),
          clean(snapshot.designNumber), clean(snapshot.fluteTest), clean(snapshot.salesRep), clean(revision.csr), clean(revision.designer),
          snapshot.digitalPrint ? 1 : 0, snapshot.digitalCut ? 1 : 0, snapshot.digitalDieCut ? 1 : 0,
          snapshot.labelDieCut ? 1 : 0, snapshot.label4cProcess ? 1 : 0,
          snapshot.approvalRelativePath, snapshot.approvalName, existing.id,
        );
        currentRevisionId = existing.id;
        continue;
      }

      const result = insert.run(
        documentId,
        label,
        normalizeRevisionDate(revision.revisionDate),
        clean(revision.description),
        clean(snapshot.specificationNumber),
        clean(snapshot.designNumber),
        clean(revision.csr),
        clean(revision.designer),
        snapshot.approvalRelativePath,
        now,
        clean(snapshot.fluteTest),
        clean(snapshot.salesRep),
        snapshot.digitalPrint ? 1 : 0,
        snapshot.digitalCut ? 1 : 0,
        snapshot.digitalDieCut ? 1 : 0,
        snapshot.labelDieCut ? 1 : 0,
        snapshot.label4cProcess ? 1 : 0,
        snapshot.approvalName,
      );
      currentRevisionId = Number(result.lastInsertRowid);
      created += 1;
    }

    if (currentRevisionId) {
      graphicsStoreDatabase.prepare(`UPDATE graphics_documents SET current_revision_id=?, status='active', updated_at=? WHERE id=?`).run(currentRevisionId, now, documentId);
    }
    graphicsStoreDatabase.exec('COMMIT');
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    throw error;
  }
  return created;
}

function mapDetail(row: Record<string, unknown>): ApprovalRevisionDetail {
  return {
    id: Number(row.id), graphicId: Number(row.graphic_id), revisionLabel: clean(row.revision_label),
    revisionDate: normalizeRevisionDate(row.revision_date), description: clean(row.description),
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

  let artworkName = input.artworkName.trim();
  let artworkRelativePath = input.artworkRelativePath.trim();
  if (input.artworkPdfBase64.trim()) {
    const stored = storeApprovalRevisionArtwork(graphicId, revisionId, artworkName, input.artworkPdfBase64);
    artworkName = stored.artworkName;
    artworkRelativePath = stored.artworkRelativePath;
  }

  graphicsStoreDatabase.prepare(`
    UPDATE document_revisions SET revision_label=?, revision_date=?, description=?, specification_number=?, design_number=?,
      flute_test=?, sales_rep=?, csr=?, designer=?, digital_print=?, digital_cut=?, digital_die_cut=?,
      label_die_cut=?, label_4c_process=?, artwork_name=?, artwork_relative_path=?
    WHERE id=?
  `).run(
    clean(input.revisionLabel), normalizeRevisionDate(input.revisionDate), clean(input.description), clean(input.specificationNumber),
    clean(input.designNumber), clean(input.fluteTest), clean(input.salesRep), clean(input.csr), clean(input.designer),
    input.digitalPrint ? 1 : 0, input.digitalCut ? 1 : 0, input.digitalDieCut ? 1 : 0,
    input.labelDieCut ? 1 : 0, input.label4cProcess ? 1 : 0, artworkName, artworkRelativePath, revisionId,
  );
  const updated = getApprovalRevisionDetail(graphicId, revisionId);
  if (!updated) throw new Error('The updated Approval revision could not be reloaded.');
  return updated;
}
