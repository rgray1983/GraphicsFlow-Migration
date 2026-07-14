import type { RevisionJourneyEntry, RevisionLookupQuery, RevisionLookupResponse } from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { graphicsStoreDatabase } from './graphics-store.js';

function clean(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function digits(value: string): string { return value.match(/\d+/g)?.join('')?.replace(/^0+/, '') ?? ''; }
function safeDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}
function mapEntry(row: Record<string, unknown>, source: RevisionJourneyEntry['source']): RevisionJourneyEntry {
  return {
    id: row.id == null ? null : Number(row.id),
    revisionLabel: clean(row.revision_label ?? row.rev ?? '0'),
    revisionDate: clean(row.revision_date ?? row.rev_date),
    description: clean(row.description),
    csr: clean(row.csr),
    designer: clean(row.designer ?? row.des),
    source,
    createdAt: safeDate(row.created_at),
    isCurrent: false,
  };
}
function getGraphicByNormalizedG(identifier: string) {
  const normalized = digits(identifier);
  if (!normalized) return null;
  return graphicsStoreDatabase.prepare(`SELECT id, g_number, customer_number, customer_name, part_number FROM graphics_records WHERE normalized_g_number = ?`).get(normalized) as Record<string, unknown> | undefined ?? null;
}
function getGraphicById(id: number) {
  return graphicsStoreDatabase.prepare(`SELECT id, g_number, customer_number, customer_name, part_number FROM graphics_records WHERE id = ?`).get(id) as Record<string, unknown> | undefined ?? null;
}
function v3Journey(graphicId: number, type: RevisionLookupQuery['type'], specificationNumber?: string): RevisionJourneyEntry[] {
  const params: unknown[] = [graphicId, type];
  let specClause = '';
  if (type === 'printCard' && specificationNumber) { specClause = ' AND UPPER(REPLACE(REPLACE(COALESCE(r.specification_number, \'\'), \'F#\', \'\'), \' \' , \'\')) = ?'; params.push(clean(specificationNumber).replace(/^F#?/, '').replace(/\s+/g, '')); }
  const rows = graphicsStoreDatabase.prepare(`
    SELECT r.* FROM graphics_documents d
    INNER JOIN document_revisions r ON r.document_id = d.id
    WHERE d.graphic_id = ? AND d.document_type = ?${specClause}
    ORDER BY COALESCE(r.created_at, ''), r.id
  `).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => mapEntry(row, 'graphicsflow'));
}
function legacyPrintCardRows(specificationNumber: string): Array<Record<string, unknown>> {
  const spec = clean(specificationNumber).replace(/^F#?/, '').replace(/\s+/g, '');
  if (!spec) return [];
  try {
    return legacyDatabase.prepare(`SELECT id, g_number, rev, rev_date, description, csr, des, f_number, d_number, created_at FROM print_card_revisions WHERE UPPER(REPLACE(REPLACE(COALESCE(f_number, ''), 'F#', ''), ' ', '')) = ? ORDER BY id`).all(spec) as Array<Record<string, unknown>>;
  } catch { return []; }
}

export function lookupRevisionWorkspace(query: RevisionLookupQuery): RevisionLookupResponse {
  if (query.type === 'approval') {
    const graphic = getGraphicByNormalizedG(query.identifier);
    if (!graphic) return { query, record: null, message: 'No Approval history was found for that G#.' };
    const journey = v3Journey(Number(graphic.id), 'approval');
    if (journey.length) journey[journey.length - 1].isCurrent = true;
    return { query, message: null, record: {
      documentType: 'approval', graphicId: Number(graphic.id), gNumber: clean(graphic.g_number), specificationNumber: '',
      customerNumber: clean(graphic.customer_number), customerName: clean(graphic.customer_name), partNumber: clean(graphic.part_number),
      status: journey.length ? 'active' : 'live file only', currentRevision: journey.at(-1) ?? null, journey,
    } };
  }

  const legacyRows = legacyPrintCardRows(query.identifier);
  const legacyG = legacyRows.length ? clean(legacyRows.at(-1)?.g_number) : '';
  let graphic = legacyG ? getGraphicByNormalizedG(legacyG) : null;
  if (!graphic) {
    const normalizedSpec = clean(query.identifier).replace(/^F#?/, '').replace(/\s+/g, '');
    const row = graphicsStoreDatabase.prepare(`
      SELECT d.graphic_id FROM graphics_documents d INNER JOIN document_revisions r ON r.document_id=d.id
      WHERE d.document_type='printCard' AND UPPER(REPLACE(REPLACE(COALESCE(r.specification_number, ''), 'F#', ''), ' ', ''))=?
      ORDER BY r.id DESC LIMIT 1
    `).get(normalizedSpec) as { graphic_id: number } | undefined;
    if (row) graphic = getGraphicById(row.graphic_id);
  }
  if (!graphic) return { query, record: null, message: 'No Print Card history was found for that Spec#.' };
  const specificationNumber = clean(query.identifier).replace(/^F#?/, '');
  const legacyJourney = legacyRows.map((row) => mapEntry(row, 'legacy-import'));
  const journey = [...legacyJourney, ...v3Journey(Number(graphic.id), 'printCard', specificationNumber)];
  if (journey.length) journey[journey.length - 1].isCurrent = true;
  return { query, message: null, record: {
    documentType: 'printCard', graphicId: Number(graphic.id), gNumber: clean(graphic.g_number), specificationNumber,
    customerNumber: clean(graphic.customer_number), customerName: clean(graphic.customer_name), partNumber: clean(graphic.part_number),
    status: journey.length ? 'active' : 'record found', currentRevision: journey.at(-1) ?? null, journey,
  } };
}
