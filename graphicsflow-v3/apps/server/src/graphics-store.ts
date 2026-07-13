import { DatabaseSync } from 'node:sqlite';
import type { CreateGraphicInput, GraphicRecord, GraphicsListResponse, GraphicsQuery } from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const database = new DatabaseSync(settingsDatabasePath);

database.exec(`
  CREATE TABLE IF NOT EXISTS graphics_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_graphic_id INTEGER UNIQUE,
    g_number TEXT NOT NULL,
    normalized_g_number TEXT NOT NULL UNIQUE,
    customer_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    part_number TEXT NOT NULL,
    preview_image TEXT,
    source TEXT NOT NULL DEFAULT 'graphicsflow',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_graphics_records_customer_number
    ON graphics_records(customer_number COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_graphics_records_customer_name
    ON graphics_records(customer_name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_graphics_records_part_number
    ON graphics_records(part_number COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS graphics_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    graphic_id INTEGER NOT NULL,
    document_type TEXT NOT NULL CHECK(document_type IN ('approval', 'printCard')),
    current_revision_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(graphic_id, document_type),
    FOREIGN KEY(graphic_id) REFERENCES graphics_records(id)
  );

  CREATE TABLE IF NOT EXISTS document_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    revision_label TEXT NOT NULL DEFAULT '0',
    revision_date TEXT,
    description TEXT,
    specification_number TEXT,
    design_number TEXT,
    csr TEXT,
    designer TEXT,
    source_relative_path TEXT,
    rendered_relative_path TEXT,
    source TEXT NOT NULL DEFAULT 'graphicsflow',
    legacy_revision_id INTEGER,
    created_at TEXT NOT NULL,
    created_by TEXT,
    FOREIGN KEY(document_id) REFERENCES graphics_documents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_document_revisions_document
    ON document_revisions(document_id, created_at DESC);
`);

type LegacyGraphicRow = {
  id: number;
  g_number: string | null;
  customer_number: string | null;
  customer_name: string | null;
  part_number: string | null;
  preview_image: string | null;
  created_at: string | null;
};

type GraphicRow = {
  id: number;
  g_number: string;
  customer_number: string;
  customer_name: string;
  part_number: string;
  preview_image: string | null;
  source: 'legacy-import' | 'graphicsflow';
  created_at: string;
};

function normalizeGNumber(value: string): string {
  const digits = value.match(/\d+/g)?.join('') ?? '';
  return digits.replace(/^0+/, '') || digits;
}

function normalizeText(value: string): string {
  return value.trim().toUpperCase();
}

function formatConfiguredGNumber(number: number): string {
  const identifier = getCompanySettings().identifiers.graphics;
  return `${identifier.prefix}${identifier.separator}${number}`.trim();
}

function mapGraphic(row: GraphicRow): GraphicRecord {
  return {
    id: row.id,
    gNumber: row.g_number,
    customerNumber: row.customer_number,
    customerName: row.customer_name,
    specificationNumber: '',
    partNumber: row.part_number,
    previewImage: row.preview_image,
    createdAt: row.created_at,
    source: row.source,
    canDelete: row.source === 'graphicsflow',
  };
}

function importLegacyGraphics(): void {
  const rows = legacyDatabase.prepare(`
    SELECT id, g_number, customer_number, customer_name, part_number, preview_image, created_at
    FROM graphics
    ORDER BY id ASC
  `).all() as LegacyGraphicRow[];

  const upsert = database.prepare(`
    INSERT INTO graphics_records (
      id, legacy_graphic_id, g_number, normalized_g_number,
      customer_number, customer_name, part_number, preview_image,
      source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'legacy-import', ?, ?)
    ON CONFLICT(legacy_graphic_id) DO UPDATE SET
      g_number = excluded.g_number,
      normalized_g_number = excluded.normalized_g_number,
      customer_number = excluded.customer_number,
      customer_name = excluded.customer_name,
      part_number = excluded.part_number,
      preview_image = excluded.preview_image,
      updated_at = excluded.updated_at
  `);

  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const gNumber = row.g_number?.trim() ?? '';
      const normalized = normalizeGNumber(gNumber);
      if (!gNumber || !normalized) continue;
      upsert.run(
        row.id,
        row.id,
        gNumber,
        normalized,
        normalizeText(row.customer_number ?? ''),
        normalizeText(row.customer_name ?? ''),
        normalizeText(row.part_number ?? ''),
        row.preview_image,
        row.created_at ?? now,
        now,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

importLegacyGraphics();

const numericGNumberExpression = `CAST(normalized_g_number AS INTEGER)`;
const sortColumns: Record<GraphicsQuery['sortBy'], string> = {
  gNumber: numericGNumberExpression,
  customerNumber: "COALESCE(customer_number, '') COLLATE NOCASE",
  customerName: "COALESCE(customer_name, '') COLLATE NOCASE",
  partNumber: "COALESCE(part_number, '') COLLATE NOCASE",
  createdAt: "COALESCE(created_at, '')",
};

export function getGraphicById(id: number): GraphicRecord | null {
  const row = database.prepare(`
    SELECT id, g_number, customer_number, customer_name, part_number, preview_image, source, created_at
    FROM graphics_records
    WHERE id = ?
  `).get(id) as GraphicRow | undefined;
  return row ? mapGraphic(row) : null;
}

export function listGraphics(query: GraphicsQuery): GraphicsListResponse {
  const search = query.search.trim();
  const pattern = `%${search}%`;
  const whereClause = search
    ? `WHERE g_number LIKE ? COLLATE NOCASE
        OR customer_number LIKE ? COLLATE NOCASE
        OR customer_name LIKE ? COLLATE NOCASE
        OR part_number LIKE ? COLLATE NOCASE`
    : '';
  const searchParameters = search ? [pattern, pattern, pattern, pattern] : [];
  const sortColumn = sortColumns[query.sortBy];
  const sortDirection = query.sortDirection === 'asc' ? 'ASC' : 'DESC';

  const countRow = database.prepare(`SELECT COUNT(*) AS total FROM graphics_records ${whereClause}`)
    .get(...searchParameters) as { total: number };
  const rows = database.prepare(`
    SELECT id, g_number, customer_number, customer_name, part_number, preview_image, source, created_at
    FROM graphics_records
    ${whereClause}
    ORDER BY ${sortColumn} ${sortDirection}, id ${sortDirection}
    LIMIT ?
  `).all(...searchParameters, query.limit) as GraphicRow[];

  return { items: rows.map(mapGraphic), total: Number(countRow.total), query: search };
}

export class DuplicateGraphicError extends Error {
  constructor() {
    super('That G# already exists.');
    this.name = 'DuplicateGraphicError';
  }
}

export class GraphicDeletionError extends Error {
  constructor(message: string, public readonly code: 'not-found' | 'legacy-record' | 'has-documents') {
    super(message);
    this.name = 'GraphicDeletionError';
  }
}

export function createGraphic(input: CreateGraphicInput): GraphicRecord {
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    const nextRow = database.prepare(`
      SELECT COALESCE(MAX(CAST(normalized_g_number AS INTEGER)), 0) + 1 AS next_number
      FROM graphics_records
    `).get() as { next_number: number };
    const nextNumber = Number(nextRow.next_number);
    const normalized = String(nextNumber);
    const gNumber = formatConfiguredGNumber(nextNumber);

    const existing = database.prepare('SELECT id FROM graphics_records WHERE normalized_g_number = ?').get(normalized);
    if (existing) throw new DuplicateGraphicError();

    const result = database.prepare(`
      INSERT INTO graphics_records (
        g_number, normalized_g_number, customer_number, customer_name, part_number,
        preview_image, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'graphicsflow', ?, ?)
    `).run(
      gNumber,
      normalized,
      normalizeText(input.customerNumber),
      normalizeText(input.customerName),
      normalizeText(input.partNumber),
      now,
      now,
    );

    const id = Number(result.lastInsertRowid);
    database.exec('COMMIT');
    const created = getGraphicById(id);
    if (!created) throw new Error('The new graphics record could not be reloaded.');
    return created;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function deleteGraphic(id: number): { deletedId: number; deletedGNumber: string } {
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare(`
      SELECT id, g_number, source
      FROM graphics_records
      WHERE id = ?
    `).get(id) as { id: number; g_number: string; source: string } | undefined;

    if (!row) throw new GraphicDeletionError('Graphics record not found.', 'not-found');
    if (row.source !== 'graphicsflow') {
      throw new GraphicDeletionError('Imported legacy graphics records cannot be deleted from GraphicsFlow.', 'legacy-record');
    }

    const documentCount = database.prepare('SELECT COUNT(*) AS total FROM graphics_documents WHERE graphic_id = ?')
      .get(id) as { total: number };
    if (Number(documentCount.total) > 0) {
      throw new GraphicDeletionError('This record already has GraphicsFlow documents or revisions and cannot be deleted.', 'has-documents');
    }

    database.prepare('DELETE FROM graphic_metadata WHERE legacy_graphic_id = ?').run(id);
    database.prepare('DELETE FROM graphics_records WHERE id = ?').run(id);
    database.exec('COMMIT');
    return { deletedId: id, deletedGNumber: row.g_number };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export { database as graphicsStoreDatabase };
