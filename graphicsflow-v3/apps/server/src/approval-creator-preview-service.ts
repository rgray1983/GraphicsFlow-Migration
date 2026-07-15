import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readLiveArtwork } from './print-card-artwork-service.js';

const execFileAsync = promisify(execFile);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(moduleDirectory, '../assets/approval-templates/HCC APPROVAL FORM-2026.pdf');

export type ApprovalPreviewInput = {
  gNumber: string;
  customerNumber: string;
  customerName: string;
  partNumber: string;
  specificationNumber: string;
  designNumber: string;
  fluteTest: string;
  salesRep: string;
  revisionLabel: string;
  revisionDate: string;
  description: string;
  csr: string;
  designer: string;
  digitalPrint: boolean;
  digitalCut: boolean;
  digitalDieCut: boolean;
  labelDieCut: boolean;
  label4cProcess: boolean;
  artPdfName: string;
  artPdfBase64: string;
  liveArtworkRelativePath: string;
};

function uppercase(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function numberOnly(value: unknown): string { return String(value ?? '').match(/\d+/g)?.join('') ?? ''; }
function formatDate(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return uppercase(trimmed);
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}
function revisionedGNumber(gNumber: string, revision: string): string {
  const cleanG = numberOnly(gNumber); const cleanRevision = uppercase(revision);
  return !cleanRevision || cleanRevision === '0' ? cleanG : `${cleanG}-${cleanRevision}`;
}
function escapeFdf(value: string): string { return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r\n|\r|\n/g, '\\r'); }
function buildFdf(fields: Record<string, string>, checkboxes: Record<string, boolean>): string {
  const textRows = Object.entries(fields).map(([name, value]) => `<< /T (${escapeFdf(name)}) /V (${escapeFdf(value)}) >>`);
  const checkboxRows = Object.entries(checkboxes).filter(([, checked]) => checked).map(([name]) => `<< /T (${escapeFdf(name)}) /V /Yes >>`);
  return `%FDF-1.2\n1 0 obj\n<<\n/FDF << /Fields [\n${[...textRows, ...checkboxRows].join('\n')}\n] >>\n>>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`;
}

async function executable(candidates: string[], fallback: string): Promise<string | null> {
  for (const candidate of candidates) { try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ } }
  try { await execFileAsync(fallback, ['--version'], { timeout: 5000 }); return fallback; } catch { return null; }
}
async function findPdftk() { return executable(['/opt/homebrew/bin/pdftk','/usr/local/bin/pdftk','/opt/local/bin/pdftk','/usr/bin/pdftk','/Applications/XAMPP/xamppfiles/bin/pdftk'], 'pdftk'); }
async function findGhostscript() { return executable(['/opt/homebrew/bin/gs','/usr/local/bin/gs','/opt/local/bin/gs','/usr/bin/gs','/Applications/XAMPP/xamppfiles/bin/gs'], 'gs'); }
async function findImageMagick() { return (await executable(['/opt/homebrew/bin/magick','/usr/local/bin/magick','/opt/local/bin/magick'], 'magick')) ?? executable(['/opt/homebrew/bin/convert','/usr/local/bin/convert','/opt/local/bin/convert','/usr/bin/convert'], 'convert'); }

function approvalFields(input: ApprovalPreviewInput): Record<string, string> {
  const revisionDate = formatDate(input.revisionDate);
  return {
    CUSTOMER: uppercase(input.customerName), 'CUST #': uppercase(input.customerNumber), 'SPEC #': uppercase(input.specificationNumber),
    'DESIGN #': uppercase(input.designNumber), 'ART #': revisionedGNumber(input.gNumber, input.revisionLabel), 'I.D': uppercase(input.partNumber),
    TEST: uppercase(input.fluteTest), 'Sales Rep': uppercase(input.salesRep), 'APPROVAL CREATION DATE': revisionDate, 'DATE APPROVED': '',
    'Signature1_es_:signer:signature': '', 'ART REV 0': uppercase(input.revisionLabel), 'rev date 0': revisionDate,
    'DESCR 0': uppercase(input.description), 'CSR 0': uppercase(input.csr), 'DSR 0': uppercase(input.designer),
  };
}
function approvalCheckboxes(input: ApprovalPreviewInput): Record<string, boolean> {
  return { 'Check Box SAMPLE': false, 'Check Box APPROVED': false, 'Check Box DIGITAL PRINT': input.digitalPrint, 'Check Box DIGITAL CUT': input.digitalCut, 'Check Box DIE CUT BAYSEK': input.digitalDieCut, 'Check Box DIE CUT LABEL': input.labelDieCut, 'Check Box PROCESS': input.label4cProcess };
}

async function createFilledApprovalPdf(input: ApprovalPreviewInput, directory: string): Promise<string> {
  await access(templatePath, constants.R_OK).catch(() => { throw new Error(`The V3 HCC Approval template is missing: ${templatePath}`); });
  const pdftk = await findPdftk(); if (!pdftk) throw new Error('pdftk is required to fill the HCC Approval template.');
  const fdfPath = join(directory, 'approval.fdf'); const filledPdfPath = join(directory, 'approval.pdf');
  await writeFile(fdfPath, buildFdf(approvalFields(input), approvalCheckboxes(input)), 'utf8');
  await execFileAsync(pdftk, [templatePath, 'fill_form', fdfPath, 'output', filledPdfPath, 'need_appearances'], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
  return filledPdfPath;
}

async function artworkPdf(input: ApprovalPreviewInput): Promise<Buffer | null> {
  if (input.artPdfBase64.trim()) {
    const data = Buffer.from(input.artPdfBase64, 'base64');
    if (data.length < 5 || data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded Approval artwork is not a valid PDF.');
    return data;
  }
  if (input.liveArtworkRelativePath.trim()) return (await readLiveArtwork(input.liveArtworkRelativePath)).data;
  return null;
}

async function renderComposedPage(input: ApprovalPreviewInput, filledPdfPath: string, directory: string, dpi: number): Promise<string> {
  const gs = await findGhostscript(); if (!gs) throw new Error('Ghostscript is required to render the Approval preview.');
  const pagePath = join(directory, `approval-${dpi}.png`);
  await execFileAsync(gs, ['-dSAFER','-dBATCH','-dNOPAUSE','-dFirstPage=1','-dLastPage=1','-sDEVICE=png16m',`-r${dpi}`,'-dGraphicsAlphaBits=4','-dTextAlphaBits=4',`-sOutputFile=${pagePath}`,filledPdfPath], { timeout: 60000, maxBuffer: 30 * 1024 * 1024 });
  const art = await artworkPdf(input); if (!art) return pagePath;
  const artPdfPath = join(directory, 'artwork.pdf');
  const artPngPath = join(directory, `artwork-${dpi}.png`);
  const preparedArtPath = join(directory, `artwork-prepared-${dpi}.png`);
  const composedPagePath = join(directory, `approval-composed-${dpi}.png`);
  await writeFile(artPdfPath, art);
  await execFileAsync(gs, ['-dSAFER','-dBATCH','-dNOPAUSE','-dFirstPage=1','-dLastPage=1','-sDEVICE=png16m',`-r${dpi}`,'-dGraphicsAlphaBits=4','-dTextAlphaBits=4',`-sOutputFile=${artPngPath}`,artPdfPath], { timeout: 60000, maxBuffer: 30 * 1024 * 1024 });
  const magick = await findImageMagick(); if (!magick) throw new Error('ImageMagick is required to place artwork on the Approval.');
  const scale = dpi / 180; const width = Math.round(1420 * scale); const height = Math.round(465 * scale); const x = Math.round(55 * scale); const y = Math.round(689 * scale);
  await execFileAsync(magick, [artPngPath,'-background','white','-alpha','remove','-alpha','off','-resize',`${width}x${height}`,'-gravity','center','-extent',`${width}x${height}`,preparedArtPath], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
  await execFileAsync(magick, [pagePath, preparedArtPath, '-geometry', `+${x}+${y}`, '-composite', composedPagePath], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
  return composedPagePath;
}

export async function renderHccApprovalPdf(input: ApprovalPreviewInput): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'graphicsflow-approval-pdf-'));
  try {
    const filledPdfPath = await createFilledApprovalPdf(input, directory);
    if (!(await artworkPdf(input))) return await readFile(filledPdfPath);
    const pagePath = await renderComposedPage(input, filledPdfPath, directory, 300);
    const outputPath = join(directory, 'approval-complete.pdf'); const magick = await findImageMagick();
    if (!magick) throw new Error('ImageMagick is required to create the finished Approval PDF.');
    await execFileAsync(magick, [pagePath,'-units','PixelsPerInch','-density','300',outputPath], { timeout: 120000, maxBuffer: 40 * 1024 * 1024 });
    return await readFile(outputPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function renderHccApprovalPreview(input: ApprovalPreviewInput): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'graphicsflow-approval-preview-'));
  try { const filledPdfPath = await createFilledApprovalPdf(input, directory); return await readFile(await renderComposedPage(input, filledPdfPath, directory, 180)); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
