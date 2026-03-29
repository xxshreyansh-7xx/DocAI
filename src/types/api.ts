import { z } from "zod";

export const PageRefSchema = z.object({
  pageNumber: z.number().int().positive(),
  storagePath: z.string().min(1).optional(),
  base64Data: z.string().min(1).optional(),
  mimeType: z.string().optional(),
}).refine((data) => Boolean(data.storagePath || data.base64Data), {
  message: "Either storagePath or base64Data is required",
  path: ["storagePath"],
});

export const RebuildOptionsSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).optional(),
  detectTables: z.boolean().optional(),
  stageTimeoutMs: z.number().int().positive().max(120000).optional(),
  ocrProvider: z.enum(["google-vision", "mock"]).optional(),
}).optional();

export const SubmitRebuildJobSchema = z.object({
  documentId: z.string().optional(),
  pages: z.array(PageRefSchema).min(1),
  options: RebuildOptionsSchema,
});

export type SubmitRebuildJobInput = z.infer<typeof SubmitRebuildJobSchema>;
