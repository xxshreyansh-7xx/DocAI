import Fastify from "fastify";
import { loadConfig } from "./utils/env";
import { logger } from "./utils/logger";
import { InMemoryJobStore } from "./store/in-memory-job-store";
import { FileArtifactStore } from "./store/file-artifact-store";
import { GoogleVisionOcrProvider } from "./services/ocr/google-vision.provider";
import { MockOcrProvider } from "./services/ocr/mock-ocr.provider";
import { JobRunnerService } from "./services/jobs/job-runner";
import { RebuildController } from "./api/rebuild.controller";
import { registerRebuildRoutes } from "./api/rebuild.routes";
import type { OCRPageResult } from "./types/ocr";

export interface BuildAppDeps {
  ocrFixtures?: Record<number, OCRPageResult>;
  forceOcrProvider?: "google-vision" | "mock";
  artifactsDir?: string;
}

export function buildApp(deps: BuildAppDeps = {}) {
  const config = loadConfig();
  const app = Fastify({ logger: false });

  const providerChoice = deps.forceOcrProvider ?? config.ocrProvider;
  const ocrProvider =
    providerChoice === "google-vision"
      ? new GoogleVisionOcrProvider()
      : new MockOcrProvider(deps.ocrFixtures ?? {});

  const jobs = new JobRunnerService({
    jobStore: new InMemoryJobStore(),
    artifactStore: new FileArtifactStore(deps.artifactsDir ?? config.artifactsDir),
    ocrProvider,
    config: {
      maxOcrRetries: config.maxOcrRetries,
      stageTimeoutMs: config.stageTimeoutMs,
      confidenceThreshold: config.confidenceThreshold,
    },
  });

  const controller = new RebuildController(jobs);
  void registerRebuildRoutes(app, controller);

  app.setErrorHandler((error, _request, reply) => {
    logger.error({ error }, "fastify-unhandled-error");
    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected error",
      },
    });
  });

  return app;
}
