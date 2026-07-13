import { z } from 'zod';

export { formatDNumber, formatGNumber, formatRevision, formatSpecNumber } from './formatters.js';

export const healthResponseSchema = z.object({ status: z.literal('ok'), service: z.string(), version: z.string(), timestamp: z.string().datetime() });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const graphicRecordSchema = z.object({
  id: z.number().int().positive(), gNumber: z.string(), customerNumber: z.string(), customerName: z.string(),
  specificationNumber: z.string(), partNumber: z.string(), previewImage: z.string().nullable(), createdAt: z.string().nullable(),
  source: z.enum(['legacy-import', 'graphicsflow']), canDelete: z.boolean(),
});
export const createGraphicInputSchema = z.object({
  customerNumber: z.string().trim().min(1, 'Customer # is required.').max(80),
  customerName: z.string().trim().min(1, 'Customer name is required.').max(160),
  partNumber: z.string().trim().min(1, 'Part # is required.').max(160),
});
export const createGraphicResponseSchema = z.object({ graphic: graphicRecordSchema });
export const deleteGraphicResponseSchema = z.object({ deletedId: z.number().int().positive(), deletedGNumber: z.string() });
export const graphicsSortFieldSchema = z.enum(['gNumber', 'customerNumber', 'customerName', 'partNumber', 'createdAt']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export const graphicsQuerySchema = z.object({
  search: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(250).default(100),
  sortBy: graphicsSortFieldSchema.default('gNumber'),
  sortDirection: sortDirectionSchema.default('desc'),
});
export const graphicsListResponseSchema = z.object({ items: z.array(graphicRecordSchema), total: z.number().int().nonnegative(), query: z.string() });

export const graphicFileKindSchema = z.enum(['approval', 'printCard']);
export const graphicFileMatchSchema = z.object({
  kind: graphicFileKindSchema, name: z.string(), extension: z.string(), size: z.number().int().nonnegative(),
  modifiedAt: z.string().datetime(), relativePath: z.string(),
});
const graphicFileGroupSchema = z.object({ latest: graphicFileMatchSchema.nullable(), matches: z.array(graphicFileMatchSchema) });
export const graphicFilesResponseSchema = z.object({
  gNumber: z.string(), approval: graphicFileGroupSchema, printCard: graphicFileGroupSchema,
  indexReady: z.boolean(), indexedAt: z.string().datetime().nullable(), checkedAt: z.string().datetime(),
});

export const previewVariantSchema = z.enum(['thumb', 'medium', 'large']);
export const previewStatusSchema = z.enum(['ready', 'generating', 'unavailable', 'error']);
export const previewResponseSchema = z.object({
  graphicId: z.number().int().positive(), status: previewStatusSchema, variant: previewVariantSchema,
  imageUrl: z.string().nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
  generatedAt: z.string().datetime().nullable(), message: z.string().nullable(),
});

export const fileIndexRefreshResponseSchema = z.object({
  approvalCount: z.number().int().nonnegative(), printCardCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(), durationMs: z.number().int().nonnegative(), indexedAt: z.string().datetime(),
});
export const fileIndexProgressSchema = z.object({
  phase: z.enum(['preparing', 'approvals', 'printCards', 'finalizing']), currentKind: graphicFileKindSchema.nullable(),
  scannedEntries: z.number().int().nonnegative(), discoveredFiles: z.number().int().nonnegative(),
  estimatedTotalFiles: z.number().int().nonnegative().nullable(), progressPercent: z.number().min(0).max(100).nullable(),
  elapsedMs: z.number().int().nonnegative(), estimatedRemainingMs: z.number().int().nonnegative().nullable(),
});
export const fileIndexJobStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'completed', 'failed']), startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(), progress: fileIndexProgressSchema.nullable(),
  result: fileIndexRefreshResponseSchema.nullable(), error: z.string().nullable(),
});

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit HEX color.');
export const identifierConfigSchema = z.object({ label: z.string().trim().min(1).max(40), prefix: z.string().max(20), separator: z.string().max(4) });
export const storageSettingsSchema = z.object({ aiRoot: z.string().trim(), pdfRoot: z.string().trim(), approvalsRoot: z.string().trim(), printCardsRoot: z.string().trim(), vendorApprovalsRoot: z.string().trim() });
export const companySettingsInputSchema = z.object({
  company: z.object({ name: z.string().trim().min(1).max(120), plantName: z.string().trim().max(120), logoPath: z.string().trim().max(500) }),
  branding: z.object({ primaryColor: hexColorSchema, secondaryColor: hexColorSchema, accentColor: hexColorSchema, theme: z.enum(['dark', 'light', 'system']) }),
  identifiers: z.object({ graphics: identifierConfigSchema, specification: identifierConfigSchema, design: identifierConfigSchema, printCard: identifierConfigSchema, factoryTicketMini: identifierConfigSchema }),
  storage: storageSettingsSchema,
});
export const companySettingsSchema = companySettingsInputSchema.extend({ updatedAt: z.string().datetime().nullable() });
export const pathStatusSchema = z.object({ key: z.string(), label: z.string(), path: z.string(), configured: z.boolean(), exists: z.boolean(), isDirectory: z.boolean(), readable: z.boolean(), writable: z.boolean(), message: z.string() });
export const pathValidationResponseSchema = z.object({ items: z.array(pathStatusSchema), checkedAt: z.string().datetime() });

export type GraphicRecord = z.infer<typeof graphicRecordSchema>;
export type CreateGraphicInput = z.infer<typeof createGraphicInputSchema>;
export type CreateGraphicResponse = z.infer<typeof createGraphicResponseSchema>;
export type DeleteGraphicResponse = z.infer<typeof deleteGraphicResponseSchema>;
export type GraphicsSortField = z.infer<typeof graphicsSortFieldSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type GraphicsQuery = z.infer<typeof graphicsQuerySchema>;
export type GraphicsListResponse = z.infer<typeof graphicsListResponseSchema>;
export type GraphicFileKind = z.infer<typeof graphicFileKindSchema>;
export type GraphicFileMatch = z.infer<typeof graphicFileMatchSchema>;
export type GraphicFilesResponse = z.infer<typeof graphicFilesResponseSchema>;
export type PreviewVariant = z.infer<typeof previewVariantSchema>;
export type PreviewStatus = z.infer<typeof previewStatusSchema>;
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type FileIndexRefreshResponse = z.infer<typeof fileIndexRefreshResponseSchema>;
export type FileIndexProgress = z.infer<typeof fileIndexProgressSchema>;
export type FileIndexJobStatus = z.infer<typeof fileIndexJobStatusSchema>;
export type IdentifierConfig = z.infer<typeof identifierConfigSchema>;
export type StorageSettings = z.infer<typeof storageSettingsSchema>;
export type CompanySettingsInput = z.infer<typeof companySettingsInputSchema>;
export type CompanySettings = z.infer<typeof companySettingsSchema>;
export type PathStatus = z.infer<typeof pathStatusSchema>;
export type PathValidationResponse = z.infer<typeof pathValidationResponseSchema>;
