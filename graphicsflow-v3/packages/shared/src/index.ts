import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const graphicRecordSchema = z.object({
  id: z.number().int().positive(),
  gNumber: z.string(),
  customerNumber: z.string(),
  customerName: z.string(),
  partNumber: z.string(),
  previewImage: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const graphicsQuerySchema = z.object({
  search: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

export const graphicsListResponseSchema = z.object({
  items: z.array(graphicRecordSchema),
  total: z.number().int().nonnegative(),
  query: z.string(),
});

export type GraphicRecord = z.infer<typeof graphicRecordSchema>;
export type GraphicsQuery = z.infer<typeof graphicsQuerySchema>;
export type GraphicsListResponse = z.infer<typeof graphicsListResponseSchema>;
