import Fastify from 'fastify';
import {
  companySettingsInputSchema,
  companySettingsSchema,
  createGraphicInputSchema,
  createGraphicResponseSchema,
  createPrintCardResponseSchema,
  deleteGraphicResponseSchema,
  fileIndexJobStatusSchema,
  graphicFilesResponseSchema,
  graphicsListResponseSchema,
  graphicsQuerySchema,
  healthResponseSchema,
  pathValidationResponseSchema,
  previewResponseSchema,
  previewVariantSchema,
  printCardArtworkMatchesResponseSchema,
  printCardDefaultsResponseSchema,
  printCardDetailsResponseSchema,
  printCardDraftSchema,
  storageSettingsSchema,
} from '@graphicsflow/shared';
import { resolveApprovalDocument, streamApprovalDocument } from './approval-document-service.js';
import { config } from './config.js';
import { resolvedDatabasePath } from './database.js';
import {
  createGraphic,
  deleteGraphic,
  DuplicateGraphicError,
  getGraphicById,
  GraphicDeletionError,
  listGraphics,
} from './graphics-repository.js';
import { getFileIndexJobStatus, resolveGraphicFiles, startLiveFileIndexJob } from './live-file-service.js';
import {
  getLiveFileSyncStatus,
  initializeLiveFileSync,
  restartLiveFileSync,
  scheduleGraphicFileMissRepair,
} from './live-file-sync-service.js';
import { getOrGeneratePreview, readPreviewImage } from './preview-service.js';
import { findPrintCardArtworkMatches, readLiveArtwork } from './print-card-artwork-service.js';
import { createManagedPrintCard, getCurrentPrintCardDetails, readManagedPrintCard } from './print-card-managed-production-service.js';
import { getApprovalRevisionAutofill, renderArtworkPreview, renderCompletePrintCardPreview } from './print-card-preview-service.js';
import { getPrintCardDefaults } from './print-card-service.js';
import { getCompanySettings, saveCompanySettings, settingsDatabasePath, validateStoragePaths } from './settings-store.js';

const app = Fastify({ logger: true, bodyLimit: 45 * 1024 * 1024 });

app.get('/api/health', async () => healthResponseSchema.parse({ status: 'ok', service: 'graphicsflow-api', version: '0.1.0', timestamp: new Date().toISOString() }));

app.get('/api/graphics', async (request, reply) => {
  const parsedQuery = graphicsQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) return reply.status(400).send({ error: 'Invalid graphics query.', details: parsedQuery.error.flatten() });
  try { return graphicsListResponseSchema.parse(listGraphics(parsedQuery.data)); }
  catch (error) { request.log.error({ error, databasePath: resolvedDatabasePath }, 'Could not load graphics records'); return reply.status(500).send({ error: 'Graphics records could not be loaded.' }); }
});

app.post('/api/graphics', async (request, reply) => {
  const parsed = createGraphicInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'The graphics record is invalid.', details: parsed.error.flatten() });
  try { return reply.status(201).send(createGraphicResponseSchema.parse({ graphic: createGraphic(parsed.data) })); }
  catch (error) {
    if (error instanceof DuplicateGraphicError) return reply.status(409).send({ error: error.message });
    request.log.error({ error }, 'Could not create graphics record');
    return reply.status(500).send({ error: 'The G# could not be created.' });
  }
});

app.delete('/api/graphics/:id', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  try { return deleteGraphicResponseSchema.parse(deleteGraphic(id)); }
  catch (error) {
    if (error instanceof GraphicDeletionError) return reply.status(error.code === 'not-found' ? 404 : 409).send({ error: error.message, code: error.code });
    request.log.error({ error, graphicId: id }, 'Could not delete graphics record');
    return reply.status(500).send({ error: 'The graphics record could not be deleted.' });
  }
});

app.get('/api/graphics/:id/files', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  const graphic = getGraphicById(id);
  if (!graphic) return reply.status(404).send({ error: 'Graphics record not found.' });
  try {
    const files = await resolveGraphicFiles(graphic.gNumber);
    const missingKinds: Array<'approval' | 'printCard'> = [];
    if (!files.approval.latest) missingKinds.push('approval');
    if (!files.printCard.latest) missingKinds.push('printCard');
    scheduleGraphicFileMissRepair(graphic.gNumber, missingKinds);
    return graphicFilesResponseSchema.parse(files);
  } catch (error) {
    request.log.error({ error, graphicId: id, gNumber: graphic.gNumber }, 'Could not resolve live graphic files');
    return reply.status(500).send({ error: 'Live files could not be resolved.' });
  }
});

app.get('/api/graphics/:id/print-card/defaults', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  try {
    const defaults = await getPrintCardDefaults(id);
    if (!defaults) return reply.status(404).send({ error: 'Graphics record not found.' });
    const approvalRevision = await getApprovalRevisionAutofill(id);
    if (approvalRevision) {
      if (!defaults.draft.csr && approvalRevision.csr) { defaults.draft.csr = approvalRevision.csr; defaults.autoFill.sources.csr = 'Approval revision table'; }
      if (!defaults.draft.designer && approvalRevision.designer) { defaults.draft.designer = approvalRevision.designer; defaults.autoFill.sources.designer = 'Approval revision table'; }
      if (!defaults.draft.description && approvalRevision.description) { defaults.draft.description = approvalRevision.description; defaults.autoFill.sources.description = 'Approval revision table'; }
    }
    return printCardDefaultsResponseSchema.parse(defaults);
  } catch (error) {
    request.log.error({ error, graphicId: id }, 'Could not load print card defaults');
    return reply.status(500).send({ error: 'Print Card defaults could not be loaded.' });
  }
});

app.get('/api/graphics/:id/print-card/artwork-matches', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  try {
    const matches = await findPrintCardArtworkMatches(id);
    if (!matches) return reply.status(404).send({ error: 'Graphics record not found.' });
    return printCardArtworkMatchesResponseSchema.parse(matches);
  } catch (error) {
    request.log.error({ error, graphicId: id }, 'Could not find live artwork PDFs');
    return reply.status(500).send({ error: 'Live artwork PDFs could not be checked.' });
  }
});

app.post('/api/print-card/artwork-preview', async (request, reply) => {
  const body = request.body as { artPdfBase64?: unknown; graphicId?: unknown; liveArtworkRelativePath?: unknown } | null;
  try {
    let base64 = typeof body?.artPdfBase64 === 'string' ? body.artPdfBase64.trim() : '';
    if (!base64 && Number.isInteger(Number(body?.graphicId)) && typeof body?.liveArtworkRelativePath === 'string') {
      const live = await readLiveArtwork(body.liveArtworkRelativePath);
      base64 = live.data.toString('base64');
    }
    if (!base64) return reply.status(400).send({ error: 'Select a live artwork PDF or upload a PDF first.' });
    const image = await renderArtworkPreview(base64);
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').send(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The artwork preview could not be generated.';
    request.log.error({ error }, 'Could not generate artwork preview');
    return reply.status(422).send({ error: message });
  }
});

app.post('/api/graphics/:id/print-card/preview', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  const body = (request.body ?? {}) as Record<string, unknown>;
  const previewDraft = {
    specificationNumber: String(body.specificationNumber ?? '').trim(),
    designNumber: String(body.designNumber ?? '').trim(),
    revisionLabel: String(body.revisionLabel ?? '').trim(),
    revisionDate: String(body.revisionDate ?? '').trim(),
    description: String(body.description ?? '').trim(),
    csr: String(body.csr ?? '').trim(),
    designer: String(body.designer ?? '').trim(),
    replaceExistingImage: body.replaceExistingImage === true,
    artPdfName: String(body.artPdfName ?? '').trim(),
    artPdfBase64: String(body.artPdfBase64 ?? ''),
    liveArtworkRelativePath: String(body.liveArtworkRelativePath ?? '').trim(),
  };
  if (!previewDraft.artPdfBase64 && !previewDraft.liveArtworkRelativePath) {
    return reply.status(400).send({ error: 'Select a live artwork PDF or upload a PDF before opening the Print Card Preview.' });
  }
  try {
    const image = await renderCompletePrintCardPreview(id, previewDraft);
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, no-store').send(image);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Print Card preview could not be rendered.';
    request.log.error({ error, graphicId: id }, 'Could not render complete Print Card preview');
    return reply.status(422).send({ error: message });
  }
});

app.post('/api/graphics/:id/print-card', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  const parsed = printCardDraftSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'The Print Card information is invalid.', details: parsed.error.flatten() });
  try {
    const created = await createManagedPrintCard(id, parsed.data);
    return reply.status(201).send(createPrintCardResponseSchema.parse(created));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Print Card could not be created.';
    request.log.error({ error, graphicId: id }, 'Could not create print card');
    return reply.status(/already exists|configure|required|invalid|select|upload|artwork/i.test(message) ? 409 : 500).send({ error: message });
  }
});

app.get('/api/graphics/:id/print-card/details', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  const details = getCurrentPrintCardDetails(id);
  if (!details) return reply.status(404).send({ error: 'Graphics record not found.' });
  return printCardDetailsResponseSchema.parse(details);
});

app.get('/api/graphics/:id/print-card.jpg', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  const image = await readManagedPrintCard(id);
  if (!image) return reply.status(404).send({ error: 'Generated Print Card is not available in GraphicsFlow managed storage.' });
  const download = (request.query as { download?: string } | undefined)?.download === '1';
  return reply.header('Content-Type', 'image/jpeg').header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${image.fileName.replace(/"/g, '')}"`).header('Cache-Control', 'private, no-store').send(image.data);
});

app.get('/api/graphics/:id/approval.pdf', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  const download = (request.query as { download?: string } | undefined)?.download === '1';
  if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid graphics record id.' });
  if (!getGraphicById(id)) return reply.status(404).send({ error: 'Graphics record not found.' });
  try {
    const document = await resolveApprovalDocument(id);
    if (!document) return reply.status(404).send({ error: 'Approval PDF is not available.' });
    const stream = await streamApprovalDocument(document);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${document.fileName.replace(/"/g, '')}"`).header('Cache-Control', 'private, no-store').send(stream);
  } catch (error) {
    request.log.error({ error, graphicId: id }, 'Could not stream approval PDF');
    return reply.status(500).send({ error: 'The approval PDF could not be opened.' });
  }
});

app.get('/api/previews/:graphicId/:variant', async (request, reply) => {
  const params = request.params as { graphicId?: string; variant?: string };
  const graphicId = Number(params.graphicId);
  const variant = previewVariantSchema.safeParse(params.variant);
  if (!Number.isInteger(graphicId) || graphicId <= 0 || !variant.success) return reply.status(400).send({ error: 'Invalid preview request.' });
  if (!getGraphicById(graphicId)) return reply.status(404).send({ error: 'Graphics record not found.' });
  try { return previewResponseSchema.parse(await getOrGeneratePreview(graphicId, variant.data)); }
  catch (error) { request.log.error({ error, graphicId, variant: variant.data }, 'Could not generate preview'); return reply.status(500).send({ error: 'Preview could not be generated.' }); }
});

app.get('/api/previews/:graphicId/:variant/image', async (request, reply) => {
  const params = request.params as { graphicId?: string; variant?: string };
  const graphicId = Number(params.graphicId);
  const variant = previewVariantSchema.safeParse(params.variant);
  if (!Number.isInteger(graphicId) || graphicId <= 0 || !variant.success) return reply.status(400).send({ error: 'Invalid preview request.' });
  const image = await readPreviewImage(graphicId, variant.data);
  if (!image) return reply.status(404).send({ error: 'Preview image is not available.' });
  return reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, max-age=3600').send(image);
});

app.get('/api/settings/company', async (_request, reply) => reply.send(companySettingsSchema.parse(getCompanySettings())));
app.put('/api/settings/company', async (request, reply) => {
  const parsed = companySettingsInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Company settings are invalid.', details: parsed.error.flatten() });
  try { const saved = companySettingsSchema.parse(saveCompanySettings(parsed.data)); restartLiveFileSync(); return reply.send(saved); }
  catch (error) { request.log.error({ error }, 'Could not save company settings'); return reply.status(500).send({ error: 'Company settings could not be saved.' }); }
});
app.post('/api/settings/validate-paths', async (request, reply) => {
  const parsed = storageSettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: 'Storage paths are invalid.', details: parsed.error.flatten() });
  try { return pathValidationResponseSchema.parse(await validateStoragePaths(parsed.data)); }
  catch (error) { request.log.error({ error }, 'Could not validate storage paths'); return reply.status(500).send({ error: 'Storage paths could not be checked.' }); }
});
app.post('/api/file-index/refresh', async (_request, reply) => reply.status(202).send(startLiveFileIndexJob()));
app.get('/api/file-index/status', async () => fileIndexJobStatusSchema.parse(getFileIndexJobStatus()));
app.get('/api/live-file-sync/status', async () => getLiveFileSyncStatus());

const serverHost = '127.0.0.1';
await app.listen({ host: serverHost, port: config.SERVER_PORT });
initializeLiveFileSync();
app.log.info({ host: serverHost, port: config.SERVER_PORT, databasePath: resolvedDatabasePath, settingsDatabasePath }, 'GraphicsFlow server started');