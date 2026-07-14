import { z } from 'zod';

export const revisionDocumentTypeSchema = z.enum(['approval', 'printCard']);
export const revisionLookupQuerySchema = z.object({
  type: revisionDocumentTypeSchema,
  identifier: z.string().trim().min(1).max(120),
});
export const revisionJourneyEntrySchema = z.object({
  id: z.number().int().positive().nullable(),
  revisionLabel: z.string(),
  revisionDate: z.string(),
  description: z.string(),
  csr: z.string(),
  designer: z.string(),
  source: z.enum(['legacy-import', 'graphicsflow', 'live-file']),
  createdAt: z.string().nullable(),
  isCurrent: z.boolean(),
});
export const revisionWorkspaceRecordSchema = z.object({
  documentType: revisionDocumentTypeSchema,
  graphicId: z.number().int().positive(),
  gNumber: z.string(),
  specificationNumber: z.string(),
  customerNumber: z.string(),
  customerName: z.string(),
  partNumber: z.string(),
  status: z.string(),
  currentRevision: revisionJourneyEntrySchema.nullable(),
  journey: z.array(revisionJourneyEntrySchema),
});
export const revisionLookupResponseSchema = z.object({
  query: revisionLookupQuerySchema,
  record: revisionWorkspaceRecordSchema.nullable(),
  message: z.string().nullable(),
});

export type RevisionDocumentType = z.infer<typeof revisionDocumentTypeSchema>;
export type RevisionLookupQuery = z.infer<typeof revisionLookupQuerySchema>;
export type RevisionJourneyEntry = z.infer<typeof revisionJourneyEntrySchema>;
export type RevisionWorkspaceRecord = z.infer<typeof revisionWorkspaceRecordSchema>;
export type RevisionLookupResponse = z.infer<typeof revisionLookupResponseSchema>;
