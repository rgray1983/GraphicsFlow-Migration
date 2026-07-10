import Fastify from 'fastify';
import {
  companySettingsInputSchema,
  companySettingsSchema,
  graphicsListResponseSchema,
  graphicsQuerySchema,
  healthResponseSchema,
  pathValidationResponseSchema,
  storageSettingsSchema,
} from '@graphicsflow/shared';
import { config } from './config.js';
import { resolvedDatabasePath } from './database.js';
import { listGraphics } from './graphics-repository.js';
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
    return reply.status(400).send({ error: 'Invalid graphics query.', details: parsedQuery.error.flatten() });
  }

  try {
    return graphicsListResponseSchema.parse(listGraphics(parsedQuery.data));
  } catch (error) {
    request.log.error({ error, databasePath: resolvedDatabasePath }, 'Could not load graphics records');
    return reply.status(500).send({ error: 'Graphics records could not be loaded.' });
  }
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
    return reply.status(400).send({ error: 'Company settings are invalid.', details: parsed.error.flatten() });
  }

  try {
    return companySettingsSchema.parse(saveCompanySettings(parsed.data));
  } catch (error) {
    request.log.error({ error, settingsDatabasePath }, 'Could not save company settings');
    return reply.status(500).send({ error: 'Company settings could not be saved.' });
  }
});

app.post('/api/settings/validate-paths', async (request, reply) => {
  const parsed = storageSettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Storage paths are invalid.', details: parsed.error.flatten() });
  }

  try {
    return pathValidationResponseSchema.parse(await validateStoragePaths(parsed.data));
  } catch (error) {
    request.log.error({ error }, 'Could not validate storage paths');
    return reply.status(500).send({ error: 'Storage paths could not be checked.' });
  }
});

const start = async () => {
  try {
    await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
