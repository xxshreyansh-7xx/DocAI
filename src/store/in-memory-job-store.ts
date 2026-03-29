import type { JobStore } from "./interfaces";
import type { JobRecord, RebuildResult } from "../types/job";
import { AppError } from "../utils/app-error";

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly idempotencyKeys = new Map<string, string>();

  async create(record: JobRecord): Promise<void> {
    this.jobs.set(record.jobId, record);
    if (record.idempotencyKey) {
      this.idempotencyKeys.set(record.idempotencyKey, record.jobId);
    }
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<JobRecord | null> {
    const jobId = this.idempotencyKeys.get(key);
    if (!jobId) {
      return null;
    }
    return this.jobs.get(jobId) ?? null;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const existing = this.jobs.get(jobId);
    if (!existing) {
      throw new AppError({ code: "NOT_FOUND", message: "Job not found", statusCode: 404 });
    }

    const updated: JobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, updated);
    return updated;
  }

  async setResult(jobId: string, result: RebuildResult): Promise<JobRecord> {
    return this.update(jobId, {
      result,
      status: "completed",
      progress: { stage: "done", percent: 100 },
      error: undefined,
    });
  }
}
