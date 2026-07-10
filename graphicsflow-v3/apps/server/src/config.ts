import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('../PHP version/graphics.db'),
  STORAGE_ROOT: z.string().default('./storage'),
  AI_ROOT: z.string().default(''),
  PDF_ROOT: z.string().default(''),
  APPROVALS_ROOT: z.string().default(''),
  PRINT_CARD_IMAGE_ROOT: z.string().default(''),
  VENDOR_APPROVALS_ROOT: z.string().default(''),
});

export const config = environmentSchema.parse(process.env);
