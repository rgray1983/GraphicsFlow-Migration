import { z } from 'zod';

export {
  formatDNumber,
  formatGNumber,
  formatRevision,
  formatSpecNumber,
} from './formatters.js';

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

export const graphicFileKindSchema = z.enum(['approval', 'printCard']);

export const graphicFileMatchSchema = z.object({
  kind: graphicFileKindSchema,
  name: z.string(),
  extension: z.string(),
  size: z.number().int().nonnegative(),
  modifiedAt: z.string().datetime(),
  relativePath: z.string(),
});

const graphicFileGroupSchema = z.object({
  latest: graphicFileMatchSchema.nullable(),
  matches: z.array(graphicFileMatchSchema),
});

export const graphicFilesResponseSchema = z.object({
  gNumber: z.string(),
  approval: graphicFileGroupSchema,
  printCard: graphicFileGroupSchema,
  indexReady: z.boolean(),
  indexedAt: z.string().datetime().nullable(),
  checkedAt: z.string().datetime(),
});

export const fileIndexRefreshResponseSchema = z.object({
  approvalCount: z.number().int().nonnegative(),
  printCardCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  indexedAt: z.string().datetime(),
});

export const fileIndexJobStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  result: fileIndexRefreshResponseSchema.nullable(),
  error: z.string().nullable(),
});

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit HEX color.');

export const identifierConfigSchema = z.object({
  label: z.string().trim().min(1).max(40),
  prefix: z.string().max(20),
  separator: z.string().max(4),
});

export const storageSettingsSchema = z.object({
  aiRoot: z.string().trim(),
  pdfRoot: z.string().trim(),
  approvalsRoot: z.string().trim(),
  printCardsRoot: z.string().trim(),
  vendorApprovalsRoot: z.string().trim(),
});

export const companySettingsInputSchema = z.object({
  company: z.object({
    name: z.string().trim().min(1).max(120),
    plantName: z.string().trim().max(120),
    logoPath: z.string().trim().max(500),
  }),
  branding: z.object({
    primaryColor: hexColorSchema,
    secondaryColor: hexColorSchema,
    accentColor: hexColorSchema,
    theme: z.enum(['dark', 'light', 'system']),
  }),
  identifiers: z.object({
    graphics: identifierConfigSchema,
    specification: identifierConfigSchema,
    design: identifierConfigSchema,
    printCard: identifierConfigSchema,
    factoryTicketMini: identifierConfigSchema,
  }),
  storage: storageSettingsSchema,
});

export const companySettingsSchema = companySettingsInputSchema.extend({
  updatedAt: z.string().datetime().nullable(),
});

export const pathStatusSchema = z.object({
  key: z.string(),
  label: z.string(),
  path: z.string(),
  configured: z.boolean(),
  exists: z.boolean(),
  isDirectory: z.boolean(),
  readable: z.boolean(),
  writable: z.boolean(),
  message: z.string(),
});

export const pathValidationResponseSchema = z.object({
  items: z.array(pathStatusSchema),
  checkedAt: z.string().datetime(),
});

export type GraphicRecord = z.infer<typeof graphicRecordSchema>;
export type GraphicsQuery = z.infer<typeof graphicsQuerySchema>;
export type GraphicsListResponse = z.infer<typeof graphicsListResponseSchema>;
export type GraphicFileKind = z.infer<typeof graphicFileKindSchema>;
export type GraphicFileMatch = z.infer<typeof graphicFileMatchSchema>;
export type GraphicFilesResponse = z.infer<typeof graphicFilesResponseSchema>;
export type FileIndexRefreshResponse = z.infer<typeof fileIndexRefreshResponseSchema>;
export type FileIndexJobStatus = z.infer<typeof fileIndexJobStatusSchema>;
export type IdentifierConfig = z.infer<typeof identifierConfigSchema>;
export type StorageSettings = z.infer<typeof storageSettingsSchema>;
export type CompanySettingsInput = z.infer<typeof companySettingsInputSchema>;
export type CompanySettings = z.infer<typeof companySettingsSchema>;
export type PathStatus = z.infer<typeof pathStatusSchema>;
export type PathValidationResponse = z.infer<typeof pathValidationResponseSchema>;
