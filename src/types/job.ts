import type { ErrorShape } from "./errors";
import type { ConfidenceSummary, NormalizedBlock } from "./layout";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface RebuildOptions {
  confidenceThreshold?: number;
  detectTables?: boolean;
  stageTimeoutMs?: number;
  ocrProvider?: "google-vision" | "mock";
}

export interface RebuildJobRequest {
  documentId?: string;
  pages: Array<{
    pageNumber: number;
    storagePath?: string;
    base64Data?: string;
    mimeType?: string;
  }>;
  options?: RebuildOptions;
}

export interface RebuildResult {
  pdfPath: string;
  pdfUrl?: string;
  structuredBlocks: NormalizedBlock[];
  confidenceSummary: ConfidenceSummary;
  manualReview: {
    required: boolean;
    lowConfidenceBlockIds: string[];
    lowConfidenceLineCount: number;
  };
}

export interface JobProgress {
  stage: "queued" | "ocr" | "layout" | "recompose" | "done" | "failed";
  percent: number;
}

export interface JobRecord {
  jobId: string;
  idempotencyKey?: string;
  status: JobStatus;
  requestFingerprint: string;
  request: RebuildJobRequest;
  progress: JobProgress;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  result?: RebuildResult;
  error?: ErrorShape;
}
