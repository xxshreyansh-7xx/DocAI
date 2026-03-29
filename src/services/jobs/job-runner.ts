import { randomUUID } from "node:crypto";
import type { ArtifactStore, JobStore } from "../../store/interfaces";
import type { RebuildJobRequest, JobRecord } from "../../types/job";
import type { OcrProvider } from "../ocr/ocr-provider";
import { preprocessPage } from "../ocr/preprocess";
import { normalizeLayout } from "../layout/normalize-blocks";
import { computeConfidenceSummary } from "../layout/confidence";
import { rebuildPdf } from "../recomposer/pdf-recomposer";
import { withRetry } from "../../utils/retry";
import { withTimeout } from "../../utils/timeout";
import { AppError } from "../../utils/app-error";
import { stableHash } from "../../utils/hash";
import { timed } from "../../utils/timing";
import { logStage, logger } from "../../utils/logger";

export interface JobRunnerConfig {
  maxOcrRetries: number;
  stageTimeoutMs: number;
  confidenceThreshold: number;
}

export class JobRunnerService {
  constructor(
    private readonly deps: {
      jobStore: JobStore;
      artifactStore: ArtifactStore;
      ocrProvider: OcrProvider;
      config: JobRunnerConfig;
    },
  ) {}

  async submitJob(request: RebuildJobRequest, idempotencyKey?: string): Promise<JobRecord> {
    const requestFingerprint = stableHash(request);

    if (idempotencyKey) {
      const existing = await this.deps.jobStore.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new AppError({
            code: "CONFLICT",
            message: "Idempotency key already used with different payload",
            statusCode: 409,
          });
        }
        return existing;
      }
    }

    const now = new Date().toISOString();
    const record: JobRecord = {
      jobId: randomUUID(),
      idempotencyKey,
      requestFingerprint,
      request,
      status: "queued",
      progress: { stage: "queued", percent: 0 },
      createdAt: now,
      updatedAt: now,
      attempts: 0,
    };

    await this.deps.jobStore.create(record);
    queueMicrotask(() => {
      this.processJob(record.jobId).catch((error) => {
        logger.error({ jobId: record.jobId, error }, "async-process-job-failed");
      });
    });

    return record;
  }

  async getJob(jobId: string): Promise<JobRecord> {
    const job = await this.deps.jobStore.get(jobId);
    if (!job) {
      throw new AppError({ code: "NOT_FOUND", message: "Job not found", statusCode: 404 });
    }
    return job;
  }

  private async processJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    await this.deps.jobStore.update(jobId, {
      status: "processing",
      progress: { stage: "ocr", percent: 10 },
      attempts: job.attempts + 1,
    });

    try {
      const ocrStage = await timed(async () => {
        const pages = [];
        for (const page of job.request.pages) {
          const preprocessed = await withTimeout(
            "preprocess",
            job.request.options?.stageTimeoutMs ?? this.deps.config.stageTimeoutMs,
            preprocessPage(page),
          );

          const pageResult = await withRetry({
            maxAttempts: this.deps.config.maxOcrRetries + 1,
            operation: () =>
              withTimeout(
                "ocr",
                job.request.options?.stageTimeoutMs ?? this.deps.config.stageTimeoutMs,
                this.deps.ocrProvider.extractPage(preprocessed),
              ),
            onRetry: (attempt, error) => {
              logger.warn({ jobId, attempt, error }, "ocr-retry");
            },
          });
          pages.push(pageResult);
        }
        return pages;
      });

      logStage({
        jobId,
        stage: "ocr",
        durationMs: ocrStage.durationMs,
        outcome: "success",
      });

      await this.deps.jobStore.update(jobId, {
        progress: { stage: "layout", percent: 55 },
      });

      const confidenceThreshold =
        job.request.options?.confidenceThreshold ?? this.deps.config.confidenceThreshold;

      const layoutStage = await timed(async () =>
        withTimeout(
          "layout-normalize",
          job.request.options?.stageTimeoutMs ?? this.deps.config.stageTimeoutMs,
          Promise.resolve(normalizeLayout(ocrStage.value, confidenceThreshold)),
        ),
      );

      logStage({
        jobId,
        stage: "layout",
        durationMs: layoutStage.durationMs,
        outcome: "success",
      });

      await this.deps.jobStore.update(jobId, {
        progress: { stage: "recompose", percent: 80 },
      });

      const recomposeStage = await timed(async () =>
        withTimeout(
          "pdf-recompose",
          job.request.options?.stageTimeoutMs ?? this.deps.config.stageTimeoutMs,
          rebuildPdf({
            pages: ocrStage.value,
            blocks: layoutStage.value,
            sourceImages: job.request.pages.map((p) => ({
              pageNumber: p.pageNumber,
              base64Data: p.base64Data,
              mimeType: p.mimeType,
            })),
          }),
        ),
      );

      logStage({
        jobId,
        stage: "recompose",
        durationMs: recomposeStage.durationMs,
        outcome: "success",
      });

      const artifact = await this.deps.artifactStore.savePdf(jobId, recomposeStage.value);
      const confidenceSummary = computeConfidenceSummary(layoutStage.value, confidenceThreshold);
      const lowConfidenceBlockIds = layoutStage.value
        .filter((block) => block.lowConfidence || block.lowConfidenceLineCount > 0)
        .map((block) => block.id);

      await this.deps.jobStore.setResult(jobId, {
        pdfPath: artifact.path,
        pdfUrl: artifact.url,
        structuredBlocks: layoutStage.value,
        confidenceSummary,
        manualReview: {
          required: lowConfidenceBlockIds.length > 0,
          lowConfidenceBlockIds,
          lowConfidenceLineCount: confidenceSummary.lowConfidenceLines,
        },
      });

      logStage({
        jobId,
        stage: "done",
        durationMs: 0,
        outcome: "success",
      });
    } catch (error) {
      const appError =
        error instanceof AppError
          ? error
          : new AppError({
              code: "JOB_FAILED",
              message: error instanceof Error ? error.message : "Job failed",
              statusCode: 500,
            });

      await this.deps.jobStore.update(jobId, {
        status: "failed",
        progress: { stage: "failed", percent: 100 },
        error: {
          code: appError.code,
          message: appError.message,
          details: appError.details,
        },
      });

      logStage({
        jobId,
        stage: "failed",
        durationMs: 0,
        outcome: "failed",
        details: { code: appError.code },
      });
    }
  }
}
