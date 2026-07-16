import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { PrintCardTemplateData, PrintCardTemplateRevision } from '@graphicsflow/shared';
import { getApprovalDisplayGNumberByBase } from './approval-g-number-service.js';

const execFileAsync = promisify(execFile);
const BASE_WIDTH = 300;
const BASE_HEIGHT = 1200;

function clean(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function formatRevisionDate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const slash = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1].slice(-2)}`;
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}/${slash[3].slice(-2)}`;
  const parsed = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return clean(text);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}/${String(parsed.getFullYear()).slice(-2)}`;
}

function fit(value: unknown, max: number): string {
  const normalized = clean(value);
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function ps(value: unknown): string {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replace(/[\r\n\t]/g, ' ');
}

function displayGNumber(value: string): string {
  const cleaned = clean(value);
  if (!cleaned) return '';
  return cleaned.startsWith('G#') ? cleaned : `G#${cleaned.replace(/^G#?/, '')}`;
}

function revisionOrder(value: string): { numeric: number | null; text: string } {
  const text = clean(value);
  const match = text.match(/\d+/);
  return { numeric: match ? Number(match[0]) : null, text };
}

function normalizedRevisions(revisions: PrintCardTemplateRevision[]): PrintCardTemplateRevision[] {
  const unique = new Map<string, PrintCardTemplateRevision>();
  for (const row of revisions) {
    const key = clean(row.revisionLabel);
    if (!key) continue;
    unique.set(key, row);
  }
  const rows = [...unique.values()]
    .sort((a, b) => {
      const left = revisionOrder(a.revisionLabel);
      const right = revisionOrder(b.revisionLabel);
      if (left.numeric !== null && right.numeric !== null && left.numeric !== right.numeric) return left.numeric - right.numeric;
      if (left.numeric !== null && right.numeric === null) return -1;
      if (left.numeric === null && right.numeric !== null) return 1;
      return left.text.localeCompare(right.text);
    })
    .slice(-4)
    .map((row) => ({ revisionLabel: fit(row.revisionLabel, 7), revisionDate: fit(formatRevisionDate(row.revisionDate), 12), description: fit(row.description, 42), csr: fit(row.csr, 8), designer: fit(row.designer, 8) }));
  while (rows.length < 4) rows.push({ revisionLabel: '', revisionDate: '', description: '', csr: '', designer: '' });
  return rows;
}

function buildPostScript(data: PrintCardTemplateData): string {
  const rows = normalizedRevisions(data.revisions);
  const displayG = displayGNumber(data.gNumber);
  const tableX = 22;
  const tableY = 210;
  const tableW = 256;
  const tableH = 810;
  const sourceW = 980;
  const sourceH = 234;
  const scaleX = tableH / sourceW;
  const scaleY = tableW / sourceH;
  const columns = [0, 75, 230, 730, 855, 980];
  const headerH = 42;
  const rowH = 48;
  const flipY = (value: number) => sourceH - value;
  const rowCommands = rows.map((row, index) => {
    const baseline = flipY(headerH + rowH * index + 32);
    return ['/Helvetica findfont 22 scalefont setfont', `28 ${baseline} moveto (${ps(row.revisionLabel)}) show`, `90 ${baseline} moveto (${ps(row.revisionDate)}) show`, `242 ${baseline} moveto (${ps(row.description)}) show`, `772 ${baseline} moveto (${ps(row.csr)}) show`, `897 ${baseline} moveto (${ps(row.designer)}) show`].join('\n');
  }).join('\n');
  const verticalLines = columns.slice(1, -1).map((x) => `${x} 0 moveto ${x} ${sourceH} lineto stroke`).join('\n');
  const horizontalLines = [headerH, ...Array.from({ length: 4 }, (_, index) => headerH + rowH * (index + 1))].map((y) => `0 ${flipY(y)} moveto ${sourceW} ${flipY(y)} lineto stroke`).join('\n');
  const tableTranslateY = BASE_HEIGHT - tableY;
  const headerBaseline = flipY(29);
  return `%!PS-Adobe-3.0
<< /PageSize [${BASE_WIDTH} ${BASE_HEIGHT}] >> setpagedevice
1 1 1 setrgbcolor 0 0 ${BASE_WIDTH} ${BASE_HEIGHT} rectfill
0 0 0 setrgbcolor
1 setlinejoin 1 setlinecap

gsave
${tableX} ${tableTranslateY} translate
-90 rotate
${scaleX} ${scaleY} scale
2 setlinewidth
0 0 ${sourceW} ${sourceH} rectstroke
${verticalLines}
${horizontalLines}
/Helvetica-Bold findfont 15 scalefont setfont
16 ${headerBaseline} moveto (REV) show
103 ${headerBaseline} moveto (DATE) show
410 ${headerBaseline} moveto (DESCRIPTION) show
768 ${headerBaseline} moveto (CSR) show
893 ${headerBaseline} moveto (DES) show
${rowCommands}
grestore

/Helvetica findfont 24 scalefont setfont
28 ${BASE_HEIGHT - 1045} moveto (F#${ps(clean(data.specificationNumber))}) show
28 ${BASE_HEIGHT - 1085} moveto (D#${ps(clean(data.designNumber))}) show
28 ${BASE_HEIGHT - 1125} moveto (${ps(displayG)}) show
showpage
`;
}

async function findGhostscript(): Promise<string> {
  for (const candidate of ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/opt/local/bin/gs', '/usr/bin/gs']) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Continue. */ }
  }
  try { await execFileAsync('gs', ['--version'], { timeout: 5000 }); return 'gs'; }
  catch { throw new Error('Ghostscript is required to render the Print Card information panel.'); }
}

export async function renderPrintCardInfoPanelPng(data: PrintCardTemplateData, outputPath: string, width: 300 | 600, height: 1200 | 2400): Promise<void> {
  const gs = await findGhostscript();
  const approvalGNumber = await getApprovalDisplayGNumberByBase(data.gNumber);
  const resolvedData = { ...data, gNumber: approvalGNumber ?? data.gNumber };
  const postScriptPath = `${outputPath}.ps`;
  const resolution = width === 600 ? 144 : 72;
  await writeFile(postScriptPath, buildPostScript(resolvedData), 'utf8');
  try {
    await execFileAsync(gs, ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=png16m', `-r${resolution}`, `-g${width}x${height}`, '-dGraphicsAlphaBits=4', '-dTextAlphaBits=4', `-sOutputFile=${outputPath}`, postScriptPath], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
  } finally {
    await rm(postScriptPath, { force: true });
  }
}
