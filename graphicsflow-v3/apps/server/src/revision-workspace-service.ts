import type { RevisionJourneyEntry, RevisionLookupQuery, RevisionLookupResponse } from '@graphicsflow/shared';
import type { SQLInputValue } from 'node:sqlite';
import { importLegacyApprovalRevisions, syncOriginalApprovalRevisionRecords } from './approval-revision-service.js';
import { database as legacyDatabase } from './database.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { findLivePrintCardBySpecification } from './print-card-document-service.js';

function clean(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function digits(value: string): string { return value.match(/\d+/g)?.join('')?.replace(/^0+/, '') ?? ''; }
function safeDate(value: unknown): string | null { const text = String(value ?? '').trim(); if (!text) return null; const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T')); return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString(); }
function mapEntry(row: Record<string, unknown>, source: RevisionJourneyEntry['source']): RevisionJourneyEntry {
  return { id: row.id == null ? null : Number(row.id), revisionLabel: clean(row.revision_label ?? row.rev ?? '0'), revisionDate: clean(row.revision_date ?? row.rev_date), description: clean(row.description), csr: clean(row.csr), designer: clean(row.designer ?? row.des), source, createdAt: safeDate(row.created_at), isCurrent: false };
}
function getGraphicByNormalizedG(identifier: string) { const normalized = digits(identifier); if (!normalized) return null; return graphicsStoreDatabase.prepare(`SELECT id, g_number, customer_number, customer_name, part_number FROM graphics_records WHERE normalized_g_number = ?`).get(normalized) as Record<string, unknown> | undefined ?? null; }
function getGraphicById(id: number) { return graphicsStoreDatabase.prepare(`SELECT id, g_number, customer_number, customer_name, part_number FROM graphics_records WHERE id = ?`).get(id) as Record<string, unknown> | undefined ?? null; }
function v3Journey(graphicId: number, type: RevisionLookupQuery['type'], specificationNumber?: string): RevisionJourneyEntry[] {
  const params: SQLInputValue[] = [graphicId, type]; let specClause = '';
  if (type === 'printCard' && specificationNumber) { specClause = ' AND UPPER(REPLACE(REPLACE(COALESCE(r.specification_number, \'\'), \'F#\', \'\'), \' \' , \'\')) = ?'; params.push(clean(specificationNumber).replace(/^F#?/, '').replace(/\s+/g, '')); }
  const rows = graphicsStoreDatabase.prepare(`SELECT r.* FROM graphics_documents d INNER JOIN document_revisions r ON r.document_id = d.id WHERE d.graphic_id = ? AND d.document_type = ?${specClause} ORDER BY COALESCE(r.created_at, ''), r.id`).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => mapEntry(row, row.source === 'legacy-import' ? 'legacy-import' : 'graphicsflow'));
}
function legacyPrintCardRows(specificationNumber: string): Array<Record<string, unknown>> {
  const spec = clean(specificationNumber).replace(/^F#?/, '').replace(/\s+/g, ''); if (!spec) return [];
  try { return legacyDatabase.prepare(`SELECT id, g_number, rev, rev_date, description, csr, des, f_number, d_number, created_at FROM print_card_revisions WHERE UPPER(REPLACE(REPLACE(COALESCE(f_number, ''), 'F#', ''), ' ', '')) = ? ORDER BY id`).all(spec) as Array<Record<string, unknown>>; } catch { return []; }
}
function ensureLegacyTrackingColumns(): void {
  const columns = graphicsStoreDatabase.prepare('PRAGMA table_info(document_revisions)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has('legacy_source_table')) graphicsStoreDatabase.exec('ALTER TABLE document_revisions ADD COLUMN legacy_source_table TEXT');
  if (!names.has('legacy_source_id')) graphicsStoreDatabase.exec('ALTER TABLE document_revisions ADD COLUMN legacy_source_id INTEGER');
  graphicsStoreDatabase.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_document_revisions_legacy_source ON document_revisions(legacy_source_table, legacy_source_id) WHERE legacy_source_table IS NOT NULL AND legacy_source_id IS NOT NULL');
}
function importLegacyPrintCardRevisions(graphicId: number, specificationNumber: string, rows: Array<Record<string, unknown>>): void {
  if (!rows.length) return;
  ensureLegacyTrackingColumns();
  const now = new Date().toISOString();
  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    graphicsStoreDatabase.prepare(`INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at) VALUES (?, 'printCard', 'active', ?, ?) ON CONFLICT(graphic_id, document_type) DO UPDATE SET status='active', updated_at=excluded.updated_at`).run(graphicId, now, now);
    const document = graphicsStoreDatabase.prepare(`SELECT id, current_revision_id FROM graphics_documents WHERE graphic_id=? AND document_type='printCard'`).get(graphicId) as { id: number; current_revision_id: number | null };
    let latestRevisionId = document.current_revision_id;
    for (const row of rows) {
      const legacyId = Number(row.id);
      const revisionLabel = clean(row.rev || '0');
      const existing = graphicsStoreDatabase.prepare(`SELECT id FROM document_revisions WHERE document_id=? AND (legacy_source_table='print_card_revisions' AND legacy_source_id=? OR UPPER(TRIM(revision_label))=? AND UPPER(REPLACE(REPLACE(COALESCE(specification_number,''),'F#',''),' ',''))=?) ORDER BY id DESC LIMIT 1`).get(document.id, legacyId, revisionLabel, clean(specificationNumber).replace(/^F#?/, '').replace(/\s+/g, '')) as { id: number } | undefined;
      if (existing) { latestRevisionId = existing.id; continue; }
      const createdAt = safeDate(row.created_at) || now;
      const result = graphicsStoreDatabase.prepare(`INSERT INTO document_revisions (document_id, revision_label, revision_date, description, specification_number, design_number, csr, designer, source, created_at, legacy_source_table, legacy_source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'legacy-import', ?, 'print_card_revisions', ?)`).run(document.id, revisionLabel, clean(row.rev_date), clean(row.description), clean(row.f_number || specificationNumber), clean(row.d_number), clean(row.csr), clean(row.des), createdAt, legacyId);
      latestRevisionId = Number(result.lastInsertRowid);
    }
    if (!document.current_revision_id && latestRevisionId) graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id=?, updated_at=? WHERE id=?').run(latestRevisionId, now, document.id);
    graphicsStoreDatabase.exec('COMMIT');
  } catch (error) {
    graphicsStoreDatabase.exec('ROLLBACK');
    throw error;
  }
}
function revisionNumber(entry: RevisionJourneyEntry): number | null { const matched = clean(entry.revisionLabel).match(/\d+/)?.[0]; return matched == null ? null : Number(matched); }
function revisionTime(entry: RevisionJourneyEntry): number { const candidate = entry.createdAt || entry.revisionDate; if (!candidate) return 0; const parsed = new Date(candidate).getTime(); return Number.isNaN(parsed) ? 0 : parsed; }
function finalizeJourney(entries: RevisionJourneyEntry[]): { journey: RevisionJourneyEntry[]; current: RevisionJourneyEntry | null } {
  const byRevision = new Map<string, RevisionJourneyEntry>();
  for (const entry of entries) { const key = clean(entry.revisionLabel) || `ROW-${byRevision.size}`; const existing = byRevision.get(key); if (!existing || entry.source === 'graphicsflow' || revisionTime(entry) > revisionTime(existing)) byRevision.set(key, { ...entry, isCurrent: false }); }
  const journey = [...byRevision.values()].sort((a, b) => { const aNumber = revisionNumber(a); const bNumber = revisionNumber(b); if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber; if (aNumber !== null && bNumber === null) return 1; if (aNumber === null && bNumber !== null) return -1; return revisionTime(a) - revisionTime(b) || clean(a.revisionLabel).localeCompare(clean(b.revisionLabel)); });
  const current = journey.at(-1) ?? null; if (current) current.isCurrent = true; return { journey, current };
}

export async function lookupRevisionWorkspace(query: RevisionLookupQuery): Promise<RevisionLookupResponse> {
  if (query.type === 'approval') {
    const graphic = getGraphicByNormalizedG(query.identifier);
    if (!graphic) return { query, record: null, unregisteredPrintCard: null, message: 'No Approval history was found for that G#.' };
    const graphicId = Number(graphic.id);
    importLegacyApprovalRevisions(graphicId, clean(graphic.g_number));
    await syncOriginalApprovalRevisionRecords(graphicId);
    const { journey, current } = finalizeJourney(v3Journey(graphicId, 'approval'));
    return { query, unregisteredPrintCard: null, message: null, record: { documentType: 'approval', graphicId, gNumber: clean(graphic.g_number), specificationNumber: '', customerNumber: clean(graphic.customer_number), customerName: clean(graphic.customer_name), partNumber: clean(graphic.part_number), status: journey.length ? 'active' : 'live file only', currentRevision: current, journey } };
  }

  const specificationNumber = clean(query.identifier).replace(/^F#?/, '');
  const legacyRows = legacyPrintCardRows(query.identifier); const legacyG = legacyRows.length ? clean(legacyRows.at(-1)?.g_number) : '';
  let graphic = legacyG ? getGraphicByNormalizedG(legacyG) : null;
  if (!graphic) {
    const normalizedSpec = clean(query.identifier).replace(/^F#?/, '').replace(/\s+/g, '');
    const row = graphicsStoreDatabase.prepare(`SELECT d.graphic_id FROM graphics_documents d INNER JOIN document_revisions r ON r.document_id=d.id WHERE d.document_type='printCard' AND UPPER(REPLACE(REPLACE(COALESCE(r.specification_number, ''), 'F#', ''), ' ', ''))=? ORDER BY r.id DESC LIMIT 1`).get(normalizedSpec) as { graphic_id: number } | undefined;
    if (row) graphic = getGraphicById(row.graphic_id);
  }
  if (!graphic) {
    const live = await findLivePrintCardBySpecification(specificationNumber);
    if (live) return { query, record: null, unregisteredPrintCard: { specificationNumber, fileName: live.fileName, relativePath: live.relativePath, modifiedAt: live.modifiedAt, size: live.size }, message: 'Print Card found in live storage, but no GraphicsFlow record exists yet.' };
    return { query, record: null, unregisteredPrintCard: null, message: 'No Print Card record or live file was found for that Spec#.' };
  }
  const graphicId = Number(graphic.id);
  importLegacyPrintCardRevisions(graphicId, specificationNumber, legacyRows);
  const { journey, current } = finalizeJourney(v3Journey(graphicId, 'printCard', specificationNumber));
  return { query, unregisteredPrintCard: null, message: null, record: { documentType: 'printCard', graphicId, gNumber: clean(graphic.g_number), specificationNumber, customerNumber: clean(graphic.customer_number), customerName: clean(graphic.customer_name), partNumber: clean(graphic.part_number), status: journey.length ? 'active' : 'record found', currentRevision: current, journey } };
}