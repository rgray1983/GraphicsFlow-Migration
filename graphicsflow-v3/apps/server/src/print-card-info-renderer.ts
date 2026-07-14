import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { PrintCardTemplateData, PrintCardTemplateRevision } from '@graphicsflow/shared';

const execFileAsync = promisify(execFile);
const BASE_WIDTH = 300;
const BASE_HEIGHT = 1200;

function clean(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
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

function revisionedGNumber(gNumber: string, revision: string): string {
  const base = clean(gNumber).replace(/^G#?/, '').replace(/[^A-Z0-9_-]/g, '');
  const rev = clean(revision);
  if (!base) return '';
  if (!rev || rev === '0' || base.endsWith(`-${rev}`)) return `G#${base}`;
  return `G#${base}-${rev}`;
}

function normalizedRevisions(revisions: PrintCardTemplateRevision[]): PrintCardTemplateRevision[] {
  const rows = revisions.slice(-4).map((row) => ({
    revisionLabel: fit(row.revisionLabel, 7),
    revisionDate: fit(row.revisionDate, 12),
    description: fit(row.description, 42),
    csr: fit(row.csr, 8),
    designer: fit(row.designer, 8),
  }));
  while (rows.length < 4) rows.push({ revisionLabel: '', revisionDate: '', description: '', csr: '', designer: '' });
  return rows;
}

function buildPostScript(data: PrintCardTemplateData): string {
  const rows = normalizedRevisions(data.revisions);
  const latest = data.revisions.slice(-4).at(-1);
  const displayG = revisionedGNumber(data.gNumber, latest?.revisionLabel ?? '');

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
    return [
      '/Helvetica findfont 22 scalefont setfont',
      `28 ${baseline} moveto (${ps(row.revisionLabel)}) show`,
      `90 ${baseline} moveto (${ps(row.revisionDate)}) show`,
      `242 ${baseline} moveto (${ps(row.description)}) show`,
      `772 ${baseline} moveto (${ps(row.csr)}) show`,
      `897 ${baseline} moveto (${ps(row.designer)}) show`,
    ].join('\n');
  }).join('\n');

  const verticalLines = columns.slice(1, -1).map((x) => `${x} 0 moveto ${x} ${sourceH} lineto stroke`).join('\n');
  const horizontalLines = [headerH, ...Array.from({ length: 4 }, (_, index) => headerH + rowH * (index + 1))]
    .map((y) => `0 ${flipY(y)} moveto ${sourceW} ${flipY(y)} lineto stroke`).join('\n');

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
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue.
    }
  }
  try {
    await execFileAsync('gs', ['--version'], { timeout: 5000 });
    return 'gs';
  } catch {
    throw new Error('Ghostscript is required to render the Print Card information panel.');
  }
}

export async function renderPrintCardInfoPanelPng(
  data: PrintCardTemplateData,
  outputPath: string,
  width: 300 | 600,
  height: 1200 | 2400,
): Promise<void> {
  const gs = await findGhostscript();
  const postScriptPath = `${outputPath}.ps`;
  const resolution = width === 600 ? 144 : 72;
  await writeFile(postScriptPath, buildPostScript(data), 'utf8');
  try {
    await execFileAsync(gs, [
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
      '-sDEVICE=png16m', `-r${resolution}`, `-g${width}x${height}`,
      '-dGraphicsAlphaBits=4', '-dTextAlphaBits=4',
      `-sOutputFile=${outputPath}`, postScriptPath,
    ], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
  } finally {
    await rm(postScriptPath, { force: true });
  }
}
