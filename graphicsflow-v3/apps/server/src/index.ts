import Fastify from 'fastify';
import {
  companySettingsInputSchema,
  companySettingsSchema,
  fileIndexJobStatusSchema,
  graphicFilesResponseSchema,
  graphicsListResponseSchema,
  graphicsQuerySchema,
  healthResponseSchema,
  pathValidationResponseSchema,
  previewResponseSchema,
  previewVariantSchema,
  storageSettingsSchema,
} from '@graphicsflow/shared';
import { config } from './config.js';
import { resolvedDatabasePath } from './database.js';
import { getGraphicById, listGraphics } from './graphics-repository.js';
import {
  getFileIndexJobStatus,
  resolveGraphicFiles,
  startLiveFileIndexJob,
} from './live-file-service.js';
import {
  getLiveFileSyncStatus,
  initializeLiveFileSync,
  restartLiveFileSync,
  scheduleGraphicFileMissRepair,
} from './live-file-sync-service.js';
import { getOrGeneratePreview, readPreviewImage } from './preview-service.js';
import {
  getCompanySettings,
  saveCompanySettings,
  settingsDatabasePath,
  validateStoragePaths,
} from './settings-store.js';

const app = Fastify({ logger: true });

app.get('/api/health', async () => healthResponseSchema.parse({
  status: 'ok',
  service: 'graphicsflow-api',
  version: '0.1.0',
  timestamp: new Date().toISOString(),
}));

app.get('/api/graphics', async (request, reply) => {
  const parsedQuery = graphicsQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    return reply.status(400).send({
      error: 'Invalid graphics query.',
      details: parsedQuery.error.flatten(),
    });
  }

  try {
    return graphicsListResponseSchema.parse(listGraphics(parsedQuery.data));
  } catch (error) {
    request.log.error({ error, databasePath: resolvedDatabasePath }, 'Could not load graphics records');
    return reply.status(500).send({ error: 'Graphics records could not be loaded.' });
  }
});

app.get('/api/graphics/:id/files', async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid graphics record id.' });
  }

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

app.get('/api/previews/:graphicId/:variant', async (request, reply) => {
  const params = request.params as { graphicId?: string; variant?: string };
  const graphicId = Number(params.graphicId);
  const variant = previewVariantSchema.safeParse(params.variant);

  if (!Number.isInteger(graphicId) || graphicId <= 0 || !variant.success) {
    return reply.status(400).send({ error: 'Invalid preview request.' });
  }
  if (!getGraphicById(graphicId)) {
    return reply.status(404).send({ error: 'Graphics record not found.' });
  }

  try {
    return previewResponseSchema.parse(await getOrGeneratePreview(graphicId, variant.data));
  } catch (error) {
    request.log.error({ error, graphicId, variant: variant.data }, 'Could not generate preview');
    return reply.status(500).send({ error: 'Preview could not be generated.' });
  }
});

app.get('/api/previews/:graphicId/:variant/image', async (request, reply) => {
  const params = request.params as { graphicId?: string; variant?: string };
  const graphicId = Number(params.graphicId);
  const variant = previewVariantSchema.safeParse(params.variant);

  if (!Number.isInteger(graphicId) || graphicId <= 0 || !variant.success) {
    return reply.status(400).send({ error: 'Invalid preview request.' });
  }

  const image = await readPreviewImage(graphicId, variant.data);
  if (!image) return reply.status(404).send({ error: 'Preview image is not available.' });

  return reply
    .header('Content-Type', 'image/png')
    .header('Cache-Control', 'private, max-age=3600')
    .send(image);
});

app.get('/api/settings/company', async (_request, reply) => {
  try {
    return companySettingsSchema.parse(getCompanySettings());
  } catch (error) {
    app.log.error({ error, settingsDatabasePath }, 'Could not load company settings');
    return reply.status(500).send({ error: 'Company settings could not be loaded.' });
  }
});

app.put('/api/settings/company', async (request, reply) => {
  const parsed = companySettingsInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'Company settings are invalid.',
      details: parsed.error.flatten(),
    });
  }

  try {
    const saved = companySettingsSchema.parse(saveCompanySettings(parsed.data));
    restartLiveFileSync();
    return saved;
  } catch (error) {
    request.log.error({ error, settingsDatabasePath }, 'Could not save company settings');
    return reply.status(500).send({ error: 'Company settings could not be saved.' });
  }
});

app.post('/api/settings/validate-paths', async (request, reply) => {
  const parsed = storageSettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'Storage paths are invalid.',
      details: parsed.error.flatten(),
    });
  }

  try {
    return pathValidationResponseSchema.parse(await validateStoragePaths(parsed.data));
  } catch (error) {
    request.log.error({ error }, 'Could not validate storage paths');
    return reply.status(500).send({ error: 'Storage paths could not be checked.' });
  }
});

app.post('/api/settings/file-index/refresh', async () => (
  fileIndexJobStatusSchema.parse(startLiveFileIndexJob())
));

app.get('/api/settings/file-index/status', async () => (
  fileIndexJobStatusSchema.parse(getFileIndexJobStatus())
));

app.get('/api/settings/file-sync/status', async () => getLiveFileSyncStatus());

const start = async () => {
  try {
    await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });
    setImmediate(() => initializeLiveFileSync());
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
