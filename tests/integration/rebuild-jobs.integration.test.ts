import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import fixture from "../fixtures/sample-ocr-page-1.json";
import { buildApp } from "../../src/app";

async function pollUntilDone(app: ReturnType<typeof buildApp>, jobId: string) {
  for (let i = 0; i < 30; i += 1) {
    const res = await request(app.server).get(`/rebuild/jobs/${jobId}`);
    if (res.body.status === "completed" || res.body.status === "failed") {
      return res.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Job did not finish in time");
}

describe("rebuild jobs integration", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("submit -> process -> result success flow", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "docai-artifacts-"));
    const app = buildApp({
      forceOcrProvider: "mock",
      ocrFixtures: { 1: fixture },
      artifactsDir: tempDir,
    });
    await app.ready();

    const submit = await request(app.server)
      .post("/rebuild/jobs")
      .set("idempotency-key", "job-123")
      .send({
        documentId: "doc-1",
        pages: [{ pageNumber: 1, storagePath: "gs://bucket/doc-1-page-1.png" }],
        options: { confidenceThreshold: 0.85 },
      });

    expect(submit.status).toBe(202);
    expect(submit.body.jobId).toBeTruthy();

    const done = await pollUntilDone(app, submit.body.jobId);
    expect(done.status).toBe("completed");

    const result = await request(app.server).get(`/rebuild/jobs/${submit.body.jobId}/result`);
    expect(result.status).toBe(200);
    expect(result.body.result.structuredBlocks.length).toBeGreaterThan(0);
    expect(result.body.result.confidenceSummary.lowConfidenceLines).toBeGreaterThanOrEqual(1);
    expect(result.body.result.manualReview.required).toBe(true);

    await app.close();
  });

  it("failure flow returns failed status and error shape", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "docai-artifacts-"));
    const app = buildApp({
      forceOcrProvider: "mock",
      ocrFixtures: {},
      artifactsDir: tempDir,
    });
    await app.ready();

    const submit = await request(app.server)
      .post("/rebuild/jobs")
      .send({
        pages: [{ pageNumber: 1, storagePath: "gs://bucket/missing.png" }],
      });

    expect(submit.status).toBe(202);

    const done = await pollUntilDone(app, submit.body.jobId);
    expect(done.status).toBe("failed");
    expect(done.error.code).toBeTruthy();
    expect(done.error.message).toBeTruthy();

    const result = await request(app.server).get(`/rebuild/jobs/${submit.body.jobId}/result`);
    expect(result.status).toBe(409);

    await app.close();
  });
});
