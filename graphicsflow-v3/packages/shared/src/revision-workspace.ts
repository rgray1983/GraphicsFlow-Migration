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
export const unregisteredPrintCardSchema = z.object({
  specificationNumber: z.string(),
  fileName: z.string(),
  relativePath: z.string(),
  modifiedAt: z.string().datetime(),
  size: z.number().int().nonnegative(),
});
export const revisionLookupResponseSchema = z.object({
  query: revisionLookupQuerySchema,
  record: revisionWorkspaceRecordSchema.nullable(),
  unregisteredPrintCard: unregisteredPrintCardSchema.nullable().default(null),
  message: z.string().nullable(),
});

const onboardingRevisionSchema = z.object({
  revisionLabel: z.string().trim().min(1, 'Revision is required.').max(20),
  revisionDate: z.string().trim().max(30).default(''),
  description: z.string().trim().max(240).default(''),
  csr: z.string().trim().max(40).default(''),
  designer: z.string().trim().max(40).default(''),
});
export const onboardPrintCardInputSchema = z.object({
  specificationNumber: z.string().trim().min(1).max(80),
  gNumber: z.string().trim().max(80).default(''),
  customerNumber: z.string().trim().max(80).default(''),
  customerName: z.string().trim().max(160).default(''),
  partNumber: z.string().trim().max(160).default(''),
  designNumber: z.string().trim().max(80).default(''),
  liveRelativePath: z.string().trim().min(1).max(1000),
  revisions: z.array(onboardingRevisionSchema).min(1, 'Add at least one revision.').max(100),
}).superRefine((value, context) => {
  if (value.gNumber) return;
  if (!value.customerNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['customerNumber'], message: 'Customer # is required when creating a new G#.' });
  if (!value.customerName) context.addIssue({ code: z.ZodIssueCode.custom, path: ['customerName'], message: 'Customer name is required when creating a new G#.' });
  if (!value.partNumber) context.addIssue({ code: z.ZodIssueCode.custom, path: ['partNumber'], message: 'Part # is required when creating a new G#.' });
});
export const onboardPrintCardResponseSchema = z.object({ record: revisionWorkspaceRecordSchema });

export type RevisionDocumentType = z.infer<typeof revisionDocumentTypeSchema>;
export type RevisionLookupQuery = z.infer<typeof revisionLookupQuerySchema>;
export type RevisionJourneyEntry = z.infer<typeof revisionJourneyEntrySchema>;
export type RevisionWorkspaceRecord = z.infer<typeof revisionWorkspaceRecordSchema>;
export type UnregisteredPrintCard = z.infer<typeof unregisteredPrintCardSchema>;
export type RevisionLookupResponse = z.infer<typeof revisionLookupResponseSchema>;
export type OnboardPrintCardInput = z.infer<typeof onboardPrintCardInputSchema>;
export type OnboardPrintCardResponse = z.infer<typeof onboardPrintCardResponseSchema>;