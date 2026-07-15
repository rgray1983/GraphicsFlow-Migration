import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderHccApprovalPdf, type ApprovalPreviewInput } from './approval-creator-preview-service.js';
import { getApprovalRevisionDetail } from './approval-revision-service.js';
import { getGraphicById } from './graphics-repository.js';
import { findPrintCardArtworkMatches } from './print-card-artwork-service.js';
import { settingsDatabasePath } from './settings-store.js';

const temporaryRoot = resolve(dirname(settingsDatabasePath), 'generated-documents', 'approvals', 'temporary-regenerated');
const lifetimeMs = 15 * 60 * 1000;
const files = new Map<string, { path: string; fileName: string; expiresAt: number }>();

function isTemporaryPath(path: string): boolean {
  return path === temporaryRoot || path.startsWith(`${temporaryRoot}${sep}`);
}

function scheduleRemoval(token: string, path: string): void {
  const timer = setTimeout(() => {
    files.delete(token);
    void rm(path, { force: true });
  }, lifetimeMs);
  timer.unref();
}

export async function regenerateApprovalRevision(graphicId: number, revisionId: number) {
  const graphic = getGraphicById(graphicId);
  const revision = getApprovalRevisionDetail(graphicId, revisionId);
  if (!graphic || !revision) throw new Error('Approval revision not found.');

  let artworkRelativePath = revision.artworkRelativePath.trim();
  let artworkName = revision.artworkName.trim();
  if (!artworkRelativePath) {
    const matches = await findPrintCardArtworkMatches(graphicId);
    const selected = matches?.matches.find((match) => match.classification === 'approval') ?? matches?.matches[0];
    if (selected) {
      artworkRelativePath = selected.relativePath;
      artworkName = selected.name;
    }
  }
  if (!artworkRelativePath) throw new Error('Connect an artwork PDF before regenerating this Approval.');

  const input: ApprovalPreviewInput = {
    gNumber: graphic.gNumber,
    customerNumber: graphic.customerNumber,
    customerName: graphic.customerName,
    partNumber: graphic.partNumber,
    specificationNumber: revision.specificationNumber,
    designNumber: revision.designNumber,
    fluteTest: revision.fluteTest,
    salesRep: revision.salesRep,
    revisionLabel: revision.revisionLabel,
    revisionDate: revision.revisionDate,
    description: revision.description,
    csr: revision.csr,
    designer: revision.designer,
    digitalPrint: revision.digitalPrint,
    digitalCut: revision.digitalCut,
    digitalDieCut: revision.digitalDieCut,
    labelDieCut: revision.labelDieCut,
    label4cProcess: revision.label4cProcess,
    artPdfName: artworkName,
    artPdfBase64: '',
    liveArtworkRelativePath: artworkRelativePath,
  };

  await mkdir(temporaryRoot, { recursive: true });
  const token = randomUUID();
  const safeG = graphic.gNumber.match(/\d+/g)?.join('') ?? String(graphicId);
  const safeRevision = revision.revisionLabel.replace(/[^A-Z0-9_-]/gi, '_') || '0';
  const fileName = `${safeG}_REV_${safeRevision}_APPROVAL.pdf`;
  const path = resolve(temporaryRoot, `${token}.pdf`);
  if (!isTemporaryPath(path)) throw new Error('The temporary Approval path is invalid.');
  await writeFile(path, await renderHccApprovalPdf(input));
  const expiresAt = Date.now() + lifetimeMs;
  files.set(token, { path, fileName, expiresAt });
  scheduleRemoval(token, path);
  return {
    token,
    fileName,
    printUrl: `/api/approval-revisions/temporary/${token}`,
    downloadUrl: `/api/approval-revisions/temporary/${token}?download=1`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function readRegeneratedApproval(token: string): Promise<{ data: Buffer; fileName: string } | null> {
  const entry = files.get(token);
  if (!entry || entry.expiresAt <= Date.now() || !isTemporaryPath(entry.path)) return null;
  try {
    return { data: await readFile(entry.path), fileName: entry.fileName };
  } catch {
    files.delete(token);
    return null;
  }
}
