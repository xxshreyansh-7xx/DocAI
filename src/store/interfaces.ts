import type { JobRecord, RebuildResult } from "../types/job";

export interface JobStore {
  create(record: JobRecord): Promise<void>;
  get(jobId: string): Promise<JobRecord | null>;
  getByIdempotencyKey(key: string): Promise<JobRecord | null>;
  update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  setResult(jobId: string, result: RebuildResult): Promise<JobRecord>;
}

export interface ArtifactStore {
  savePdf(jobId: string, data: Uint8Array): Promise<{ path: string; url?: string }>;
}
