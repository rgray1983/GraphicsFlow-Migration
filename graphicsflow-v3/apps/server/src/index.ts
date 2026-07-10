import Fastify from 'fastify';
import { healthResponseSchema } from '@graphicsflow/shared';
import { config } from './config.js';

const app = Fastify({ logger: true });

app.get('/api/health', async () => healthResponseSchema.parse({
  status: 'ok',
  service: 'graphicsflow-api',
  version: '0.1.0',
  timestamp: new Date().toISOString(),
}));

const start = async () => {
  try {
    await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
