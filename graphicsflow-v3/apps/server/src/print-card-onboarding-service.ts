import type { OnboardPrintCardInput, RevisionWorkspaceRecord } from '@graphicsflow/shared';
import { graphicsStoreDatabase } from './graphics-store.js';

function clean(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function digits(value: unknown): string { return String(value ?? '').match(/\d+/g)?.join('').replace(/^0+/, '') ?? ''; }
function revisionNumber(label: string): number { const match = clean(label).match(/\d+/)?.[0]; return match == null ? -1 : Number(match); }

export function onboardPrintCard(input: OnboardPrintCardInput): RevisionWorkspaceRecord {
  const normalizedG = digits(input.gNumber);
  if (!normalizedG) throw new Error('Enter a valid G#.');
  const now = new Date().toISOString();
  graphicsStoreDatabase.exec('BEGIN IMMEDIATE');
  try {
    let graphic = graphicsStoreDatabase.prepare('SELECT id, g_number, customer_number, customer_name, part_number FROM graphics_records WHERE normalized_g_number = ?').get(normalizedG) as Record<string, unknown> | undefined;
    if (!graphic) {
      const result = graphicsStoreDatabase.prepare(`INSERT INTO graphics_records (g_number, normalized_g_number, customer_number, customer_name, part_number, preview_image, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 'graphicsflow', ?, ?)`).run(clean(input.gNumber), normalizedG, clean(input.customerNumber), clean(input.customerName), clean(input.partNumber), now, now);
      graphic = { id: Number(result.lastInsertRowid), g_number: clean(input.gNumber), customer_number: clean(input.customerNumber), customer_name: clean(input.customerName), part_number: clean(input.partNumber) };
    } else {
      graphicsStoreDatabase.prepare('UPDATE graphics_records SET customer_number=?, customer_name=?, part_number=?, updated_at=? WHERE id=?').run(clean(input.customerNumber), clean(input.customerName), clean(input.partNumber), now, Number(graphic.id));
      graphic = { ...graphic, customer_number: clean(input.customerNumber), customer_name: clean(input.customerName), part_number: clean(input.partNumber) };
    }

    const existing = graphicsStoreDatabase.prepare(`SELECT id FROM graphics_documents WHERE graphic_id=? AND document_type='printCard'`).get(Number(graphic.id));
    if (existing) throw new Error('This G# already has a Print Card document record.');
    const documentResult = graphicsStoreDatabase.prepare(`INSERT INTO graphics_documents (graphic_id, document_type, status, created_at, updated_at) VALUES (?, 'printCard', 'active', ?, ?)`).run(Number(graphic.id), now, now);
    const documentId = Number(documentResult.lastInsertRowid);

    const sorted = [...input.revisions].sort((a, b) => revisionNumber(a.revisionLabel) - revisionNumber(b.revisionLabel));
    let currentRevisionId = 0;
    const journey = sorted.map((revision, index) => {
      const createdAt = new Date(Date.now() + index).toISOString();
      const result = graphicsStoreDatabase.prepare(`INSERT INTO document_revisions (document_id, revision_label, revision_date, description, specification_number, design_number, csr, designer, source_relative_path, rendered_relative_path, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'graphicsflow', ?)`).run(documentId, clean(revision.revisionLabel), clean(revision.revisionDate), clean(revision.description), clean(input.specificationNumber), clean(input.designNumber), clean(revision.csr), clean(revision.designer), input.liveRelativePath, createdAt);
      currentRevisionId = Number(result.lastInsertRowid);
      return { id: currentRevisionId, revisionLabel: clean(revision.revisionLabel), revisionDate: clean(revision.revisionDate), description: clean(revision.description), csr: clean(revision.csr), designer: clean(revision.designer), source: 'graphicsflow' as const, createdAt, isCurrent: index === sorted.length - 1 };
    });
    graphicsStoreDatabase.prepare('UPDATE graphics_documents SET current_revision_id=?, updated_at=? WHERE id=?').run(currentRevisionId, now, documentId);
    graphicsStoreDatabase.exec('COMMIT');
    return {
      documentType: 'printCard', graphicId: Number(graphic.id), gNumber: clean(graphic.g_number), specificationNumber: clean(input.specificationNumber),
      customerNumber: clean(graphic.customer_number), customerName: clean(graphic.customer_name), partNumber: clean(graphic.part_number), status: 'active',
      currentRevision: journey.at(-1) ?? null, journey,
    };
  } catch (error) { graphicsStoreDatabase.exec('ROLLBACK'); throw error; }
}
