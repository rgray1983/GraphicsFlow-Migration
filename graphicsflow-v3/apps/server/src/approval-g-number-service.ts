import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getGraphicById } from './graphics-repository.js';
import { graphicsStoreDatabase } from './graphics-store.js';
import { getCompanySettings } from './settings-store.js';

const execFileAsync = promisify(execFile);

function clean(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function normalize(value: string): string { return value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function numberOnly(value: string): string { return value.match(/\d+/g)?.join('') ?? ''; }

async function findPdftk(): Promise<string | null> {
  for (const candidate of ['/opt/homebrew/bin/pdftk', '/usr/local/bin/pdftk', '/opt/local/bin/pdftk', '/usr/bin/pdftk', '/Applications/XAMPP/xamppfiles/bin/pdftk']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  try { await execFileAsync('pdftk', ['--version'], { timeout: 5000 }); return 'pdftk'; } catch { return null; }
}

export async function getApprovalDisplayGNumberByBase(gNumber: string): Promise<string | null> {
  const normalized = numberOnly(gNumber).replace(/^0+/, '');
  const root = getCompanySettings().storage.approvalsRoot;
  if (!root || !normalized) return null;
  const approval = graphicsStoreDatabase.prepare(`
    SELECT i.root, i.relative_path
    FROM live_file_index i
    INNER JOIN live_file_numbers n ON n.file_id = i.id
    WHERE i.kind = 'approval' AND i.root = ? AND n.g_number = ? AND LOWER(i.extension) = '.pdf'
    ORDER BY i.modified_at DESC, i.id DESC
    LIMIT 1
  `).get(root, normalized) as { root: string; relative_path: string } | undefined;
  if (!approval) return null;
  const pdftk = await findPdftk();
  if (!pdftk) return null;
  try {
    const { stdout } = await execFileAsync(pdftk, [resolve(approval.root, approval.relative_path), 'dump_data_fields_utf8'], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    const aliases = new Set(['G', 'GNUMBER', 'GRAPHICS', 'GRAPHICSNUMBER', 'GRAPHICNUMBER']);
    let current = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('FieldName:')) current = normalize(line.slice('FieldName:'.length).trim());
      else if (line.startsWith('FieldValue:') && aliases.has(current)) {
        const value = clean(line.slice('FieldValue:'.length));
        if (value) return value.startsWith('G#') ? value : `G#${value.replace(/^G#?/, '')}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function getApprovalDisplayGNumber(graphicId: number): Promise<string | null> {
  const graphic = getGraphicById(graphicId);
  return graphic ? getApprovalDisplayGNumberByBase(graphic.gNumber) : null;
}
