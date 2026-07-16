import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import {
  previewResponseSchema,
  type PreviewResponse,
  type PreviewVariant,
} from '@graphicsflow/shared';
import { getGraphicById } from './graphics-repository.js';
import { scheduleGraphicFileMissRepair } from './live-file-sync-service.js';
import { getCompanySettings, settingsDatabasePath } from './settings-store.js';

const execFileAsync = promisify(execFile);
const database = new DatabaseSync(settingsDatabasePath);
const cacheRoot = resolve(dirname(settingsDatabasePath), 'preview-cache');
const activeJobs = new Map<string, Promise<PreviewResponse>>();
const PREVIEW_RENDER_VERSION = 'approval-preview-v3-adaptive';

await mkdir(cacheRoot, { recursive: true });

database.exec(`
  CREATE TABLE IF NOT EXISTS generated_previews (
    cache_key TEXT PRIMARY KEY,
    graphic_id INTEGER NOT NULL,
    variant TEXT NOT NULL,
    source_root TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    source_modified_at TEXT NOT NULL,
    source_size INTEGER NOT NULL,
    cache_relative_path TEXT,
    status TEXT NOT NULL,
    renderer TEXT,
    generated_at TEXT,
    message TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_generated_previews_graphic ON generated_previews(graphic_id, variant);
`);

type IndexedApproval = {
  root: string;
  relative_path: string;
  modified_at: string;
  size: number;
  extension: string;
};

function normalizeNumber(value: string): string {
  const digits = value.match(/\d+/g)?.join('') ?? '';
  return digits.replace(/^0+/, '') || digits;
}

function findLatestApproval(graphicId: number): IndexedApproval | null {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return null;
  const settings = getCompanySettings();
  const gNumber = normalizeNumber(graphic.gNumber);
  const row = database.prepare(`
    SELECT i.root, i.relative_path, i.modified_at, i.size, i.extension
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = 'approval' AND i.root = ? AND n.g_number = ?
    ORDER BY i.modified_at DESC
    LIMIT 1
  `).get(settings.storage.approvalsRoot, gNumber) as IndexedApproval | undefined;
  return row ?? null;
}

function cacheKey(graphicId: number, variant: PreviewVariant, source: IndexedApproval): string {
  return createHash('sha256')
    .update(`${PREVIEW_RENDER_VERSION}|${graphicId}|${variant}|${source.root}|${source.relative_path}|${source.modified_at}|${source.size}`)
    .digest('hex');
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function renderPdf(sourcePath: string, outputPath: string, variant: PreviewVariant): Promise<string | null> {
  const dimensions: Record<PreviewVariant, { maxPixels: number; density: number }> = {
    thumb: { maxPixels: 720, density: 150 },
    medium: { maxPixels: 3600, density: 300 },
    large: { maxPixels: 7200, density: 600 },
  };
  const { maxPixels, density } = dimensions[variant];

  if (await commandExists('magick')) {
    await execFileAsync('magick', [
      '-density', String(density), `${sourcePath}[0]`, '-resize', `${maxPixels}x${maxPixels}>`,
      '-background', 'white', '-alpha', 'remove', '-alpha', 'off', outputPath,
    ], { timeout: 240000, maxBuffer: 40 * 1024 * 1024 });
    return 'ImageMagick';
  }
  if (await commandExists('convert')) {
    await execFileAsync('convert', [
      '-density', String(density), `${sourcePath}[0]`, '-resize', `${maxPixels}x${maxPixels}>`,
      '-background', 'white', '-alpha', 'remove', '-alpha', 'off', outputPath,
    ], { timeout: 240000, maxBuffer: 40 * 1024 * 1024 });
    return 'ImageMagick';
  }
  if (await commandExists('gs')) {
    await execFileAsync('gs', [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', `-r${density}`,
      '-dGraphicsAlphaBits=4', '-dTextAlphaBits=4',
      '-dFirstPage=1', '-dLastPage=1', `-sOutputFile=${outputPath}`, sourcePath,
    ], { timeout: 240000, maxBuffer: 40 * 1024 * 1024 });
    return 'Ghostscript';
  }
  return null;
}

function response(
  graphicId: number,
  variant: PreviewVariant,
  status: PreviewResponse['status'],
  imageUrl: string | null,
  generatedAt: string | null,
  message: string | null,
): PreviewResponse {
  return previewResponseSchema.parse({ graphicId, variant, status, imageUrl, width: null, height: null, generatedAt, message });
}

async function generate(graphicId: number, variant: PreviewVariant): Promise<PreviewResponse> {
  const graphic = getGraphicById(graphicId);
  if (!graphic) return response(graphicId, variant, 'unavailable', null, null, 'Graphics record not found.');

  const source = findLatestApproval(graphicId);
  if (!source) {
    scheduleGraphicFileMissRepair(graphic.gNumber, ['approval']);
    return response(graphicId, variant, 'unavailable', null, null, 'No approval is available for this record yet.');
  }
  if (source.extension.toLowerCase() !== '.pdf') return response(graphicId, variant, 'unavailable', null, null, 'The current approval format cannot be previewed yet.');

  const key = cacheKey(graphicId, variant, source);
  const relativeCachePath = join(variant, `${key}.png`);
  const outputPath = resolve(cacheRoot, relativeCachePath);
  const sourcePath = resolve(source.root, source.relative_path);
  const existing = database.prepare('SELECT status, generated_at FROM generated_previews WHERE cache_key = ?').get(key) as { status: string; generated_at: string | null } | undefined;

  if (existing?.status === 'ready') {
    try {
      await access(outputPath, constants.R_OK);
      return response(graphicId, variant, 'ready', `/api/previews/${graphicId}/${variant}/image`, existing.generated_at, null);
    } catch {
      // Missing cache files are regenerated below.
    }
  }

  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO generated_previews
      (cache_key, graphic_id, variant, source_root, source_relative_path, source_modified_at, source_size, cache_relative_path, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?)
    ON CONFLICT(cache_key) DO UPDATE SET status = 'generating', message = NULL, updated_at = excluded.updated_at
  `).run(key, graphicId, variant, source.root, source.relative_path, source.modified_at, source.size, relativeCachePath, updatedAt);

  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await stat(sourcePath);
    const renderer = await renderPdf(sourcePath, outputPath, variant);
    if (!renderer) {
      const message = 'Install ImageMagick or Ghostscript on the GraphicsFlow server to generate PDF previews.';
      database.prepare("UPDATE generated_previews SET status = 'unavailable', message = ?, updated_at = ? WHERE cache_key = ?")
        .run(message, new Date().toISOString(), key);
      return response(graphicId, variant, 'unavailable', null, null, message);
    }
    const generatedAt = new Date().toISOString();
    database.prepare("UPDATE generated_previews SET status = 'ready', renderer = ?, generated_at = ?, message = NULL, updated_at = ? WHERE cache_key = ?")
      .run(renderer, generatedAt, generatedAt, key);
    database.prepare('DELETE FROM generated_previews WHERE graphic_id = ? AND variant = ? AND cache_key <> ?')
      .run(graphicId, variant, key);
    return response(graphicId, variant, 'ready', `/api/previews/${graphicId}/${variant}/image`, generatedAt, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview generation failed.';
    database.prepare("UPDATE generated_previews SET status = 'error', message = ?, updated_at = ? WHERE cache_key = ?")
      .run(message, new Date().toISOString(), key);
    return response(graphicId, variant, 'error', null, null, message);
  }
}

export function getOrGeneratePreview(graphicId: number, variant: PreviewVariant): Promise<PreviewResponse> {
  const jobKey = `${graphicId}:${variant}`;
  const existing = activeJobs.get(jobKey);
  if (existing) return existing;
  const job = generate(graphicId, variant).finally(() => activeJobs.delete(jobKey));
  activeJobs.set(jobKey, job);
  return job;
}

export async function readPreviewImage(graphicId: number, variant: PreviewVariant): Promise<Buffer | null> {
  const preview = await getOrGeneratePreview(graphicId, variant);
  if (preview.status !== 'ready') return null;
  const source = findLatestApproval(graphicId);
  if (!source) return null;
  const key = cacheKey(graphicId, variant, source);
  try {
    return await readFile(resolve(cacheRoot, variant, `${key}.png`));
  } catch {
    return null;
  }
}