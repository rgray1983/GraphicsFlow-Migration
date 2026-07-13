import { DatabaseSync } from 'node:sqlite';
import type { GraphicRecord } from '@graphicsflow/shared';
import { database as legacyDatabase } from './database.js';
import { settingsDatabasePath } from './settings-store.js';

const metadataDatabase = new DatabaseSync(settingsDatabasePath);

metadataDatabase.exec(`
  CREATE TABLE IF NOT EXISTS graphic_metadata (
    legacy_graphic_id INTEGER PRIMARY KEY,
    g_number TEXT NOT NULL,
    normalized_g_number TEXT NOT NULL,
    specification_number TEXT,
    design_number TEXT,
    source TEXT NOT NULL DEFAULT 'legacy-import',
    source_revision_id INTEGER,
    source_updated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_graphic_metadata_g_number
    ON graphic_metadata(normalized_g_number);
`);

type MetadataRow = {
  specification_number: string | null;
};

type LegacyRevisionRow = {
  id: number;
  spec_number: string | null;
  created_at: string | null;
};

function normalizeGNumber(value: string): string {
  const digits = value.match(/\d+/g)?.join('') ?? '';
  return digits.replace(/^0+/, '') || digits;
}

function readMetadata(legacyGraphicId: number): MetadataRow | null {
  return metadataDatabase.prepare(`
    SELECT specification_number
    FROM graphic_metadata
    WHERE legacy_graphic_id = ?
  `).get(legacyGraphicId) as MetadataRow | undefined ?? null;
}

function readLatestLegacyRevision(gNumber: string): LegacyRevisionRow | null {
  const normalized = normalizeGNumber(gNumber);
  if (!normalized) return null;

  try {
    return legacyDatabase.prepare(`
      SELECT id, spec_number, created_at
      FROM approval_revisions
      WHERE CAST(
        REPLACE(
          REPLACE(
            REPLACE(UPPER(TRIM(COALESCE(g_number, ''))), 'G', ''),
            '#',
            ''
          ),
          ' ',
          ''
        ) AS INTEGER
      ) = ?
      ORDER BY COALESCE(created_at, '') DESC, id DESC
      LIMIT 1
    `).get(Number(normalized)) as LegacyRevisionRow | undefined ?? null;
  } catch {
    // Some older reference databases may not yet contain approval_revisions.
    return null;
  }
}

function importLegacyMetadata(record: GraphicRecord): MetadataRow | null {
  const revision = readLatestLegacyRevision(record.gNumber);
  const specificationNumber = revision?.spec_number?.trim() ?? '';

  // Do not persist an empty legacy result. A later approval revision may add a Spec #,
  // and the next read should be allowed to discover it automatically.
  if (!specificationNumber) return null;

  const now = new Date().toISOString();
  metadataDatabase.prepare(`
    INSERT INTO graphic_metadata (
      legacy_graphic_id,
      g_number,
      normalized_g_number,
      specification_number,
      source,
      source_revision_id,
      source_updated_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'legacy-import', ?, ?, ?, ?)
    ON CONFLICT(legacy_graphic_id) DO UPDATE SET
      g_number = excluded.g_number,
      normalized_g_number = excluded.normalized_g_number,
      specification_number = excluded.specification_number,
      source = excluded.source,
      source_revision_id = excluded.source_revision_id,
      source_updated_at = excluded.source_updated_at,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    record.gNumber,
    normalizeGNumber(record.gNumber),
    specificationNumber,
    revision?.id ?? null,
    revision?.created_at ?? null,
    now,
    now,
  );

  return { specification_number: specificationNumber };
}

export function applyGraphicMetadata(record: GraphicRecord): GraphicRecord {
  const metadata = readMetadata(record.id) ?? importLegacyMetadata(record);
  return {
    ...record,
    specificationNumber: metadata?.specification_number?.trim() ?? '',
  };
}
