import Fastify from 'fastify';
import {
  graphicsListResponseSchema,
  graphicsQuerySchema,
  healthResponseSchema,
} from '@graphicsflow/shared';
import { config } from './config.js';
import { resolvedDatabasePath } from './database.js';
import { listGraphics } from './graphics-repository.js';

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
    return reply.status(500).send({
      error: 'Graphics records could not be loaded.',
    });
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
