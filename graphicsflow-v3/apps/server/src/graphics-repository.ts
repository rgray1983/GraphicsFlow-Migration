import type { GraphicRecord, GraphicsListResponse, GraphicsQuery } from '@graphicsflow/shared';
import { database } from './database.js';

type GraphicRow = {
  id: number;
  g_number: string | null;
  customer_number: string | null;
  customer_name: string | null;
  specification_number: string | null;
  part_number: string | null;
  preview_image: string | null;
  created_at: string | null;
};

type TableColumn = { name: string };

const graphicsColumns = new Set(
  (database.prepare('PRAGMA table_info(graphics)').all() as TableColumn[]).map((column) => column.name.toLowerCase()),
);

const specificationColumnCandidates = [
  'spec_number',
  'spec_no',
  'specification_number',
  'specification_no',
  'f_number',
  'f_no',
  'fnumber',
  'spec',
] as const;

const specificationColumn = specificationColumnCandidates.find((candidate) => graphicsColumns.has(candidate)) ?? null;
const specificationSelect = specificationColumn
  ? `"${specificationColumn}" AS specification_number`
  : "'' AS specification_number";

const numericGNumberExpression = `
  CAST(
    REPLACE(
      REPLACE(
        REPLACE(UPPER(TRIM(COALESCE(g_number, ''))), 'G', ''),
        '#',
        ''
      ),
      ' ',
      ''
    ) AS INTEGER
  )
`;

const sortColumns: Record<GraphicsQuery['sortBy'], string> = {
  gNumber: numericGNumberExpression,
  customerNumber: "COALESCE(customer_number, '') COLLATE NOCASE",
  customerName: "COALESCE(customer_name, '') COLLATE NOCASE",
  partNumber: "COALESCE(part_number, '') COLLATE NOCASE",
  createdAt: "COALESCE(created_at, '')",
};

function mapGraphic(row: GraphicRow): GraphicRecord {
  return {
    id: row.id,
    gNumber: row.g_number ?? '',
    customerNumber: row.customer_number ?? '',
    customerName: row.customer_name ?? '',
    specificationNumber: row.specification_number ?? '',
    partNumber: row.part_number ?? '',
    previewImage: row.preview_image,
    createdAt: row.created_at,
  };
}

export function getGraphicById(id: number): GraphicRecord | null {
  const row = database.prepare(`
    SELECT id, g_number, customer_number, customer_name, ${specificationSelect}, part_number, preview_image, created_at
    FROM graphics
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

  const countStatement = database.prepare(`SELECT COUNT(*) AS total FROM graphics ${whereClause}`);
  const countRow = countStatement.get(...searchParameters) as { total: number };

  const listStatement = database.prepare(`
    SELECT id, g_number, customer_number, customer_name, ${specificationSelect}, part_number, preview_image, created_at
    FROM graphics
    ${whereClause}
    ORDER BY ${sortColumn} ${sortDirection}, id ${sortDirection}
    LIMIT ?
  `);

  const rows = listStatement.all(...searchParameters, query.limit) as GraphicRow[];

  return {
    items: rows.map(mapGraphic),
    total: Number(countRow.total),
    query: search,
  };
}