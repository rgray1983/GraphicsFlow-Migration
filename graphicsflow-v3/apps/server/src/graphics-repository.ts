import type { GraphicRecord, GraphicsListResponse, GraphicsQuery } from '@graphicsflow/shared';
import { database } from './database.js';

type GraphicRow = {
  id: number;
  g_number: string | null;
  customer_number: string | null;
  customer_name: string | null;
  part_number: string | null;
  preview_image: string | null;
  created_at: string | null;
};

function mapGraphic(row: GraphicRow): GraphicRecord {
  return {
    id: row.id,
    gNumber: row.g_number ?? '',
    customerNumber: row.customer_number ?? '',
    customerName: row.customer_name ?? '',
    partNumber: row.part_number ?? '',
    previewImage: row.preview_image,
    createdAt: row.created_at,
  };
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

  const countStatement = database.prepare(`SELECT COUNT(*) AS total FROM graphics ${whereClause}`);
  const countRow = countStatement.get(...searchParameters) as { total: number };

  const listStatement = database.prepare(`
    SELECT id, g_number, customer_number, customer_name, part_number, preview_image, created_at
    FROM graphics
    ${whereClause}
    ORDER BY CAST(g_number AS INTEGER) DESC, id DESC
    LIMIT ?
  `);

  const rows = listStatement.all(...searchParameters, query.limit) as GraphicRow[];

  return {
    items: rows.map(mapGraphic),
    total: Number(countRow.total),
    query: search,
  };
}
