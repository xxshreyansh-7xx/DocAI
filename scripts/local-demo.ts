import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fixture from "../tests/fixtures/sample-ocr-page-1.json";
import { buildApp } from "../src/app";

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryOpenFile(pdfPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    await execFileAsync("open", [pdfPath]);
  } catch {
    // Intentionally non-fatal for environments without GUI open support.
  }
}

async function main(): Promise<void> {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "docai-local-demo-"));
  const app = buildApp({
    forceOcrProvider: "mock",
    ocrFixtures: { 1: fixture },
    artifactsDir,
  });

  await app.ready();
  console.log(`Demo artifacts directory: ${artifactsDir}`);

  const submit = await app.inject({
    method: "POST",
    url: "/rebuild/jobs",
    headers: {
      "idempotency-key": "local-demo-key",
    },
    payload: {
      documentId: "local-demo-doc",
      pages: [{ pageNumber: 1, storagePath: "gs://demo/local-page-1.png" }],
      options: { confidenceThreshold: 0.85 },
    },
  });

  if (submit.statusCode !== 202) {
    throw new Error(`Submit failed: ${submit.statusCode} ${submit.body}`);
  }

  const submitBody = submit.json();
  const jobId = submitBody.jobId as string;
  console.log(`Job accepted: ${jobId}`);

  let status = "queued";
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const statusRes = await app.inject({
      method: "GET",
      url: `/rebuild/jobs/${jobId}`,
    });
    if (statusRes.statusCode !== 200) {
      throw new Error(`Status failed: ${statusRes.statusCode} ${statusRes.body}`);
    }

    const body = statusRes.json();
    status = body.status as string;
    console.log(`Poll #${attempt}: status=${status}, stage=${body.progress?.stage ?? "unknown"}`);
    if (status === "completed" || status === "failed") {
      break;
    }
    await sleep(100);
  }

  const resultRes = await app.inject({
    method: "GET",
    url: `/rebuild/jobs/${jobId}/result`,
  });

  if (status !== "completed" || resultRes.statusCode !== 200) {
    console.log("Result unavailable or job failed.");
    console.log(resultRes.body);
    await app.close();
    process.exit(1);
  }

  const resultBody = resultRes.json();
  const pdfPath = resultBody.result.pdfPath as string;
  const summary = resultBody.result.confidenceSummary as {
    overallConfidence: number;
    lowConfidenceBlocks: number;
    lowConfidenceLines?: number;
    totalBlocks: number;
  };

  console.log("Demo completed.");
  console.log(`PDF: ${pdfPath}`);
  console.log(
    `Confidence: overall=${summary.overallConfidence}, lowConfidenceBlocks=${summary.lowConfidenceBlocks}/${summary.totalBlocks}, lowConfidenceLines=${summary.lowConfidenceLines ?? 0}`,
  );
  await tryOpenFile(pdfPath);
  await app.close();
}

main().catch((error) => {
  console.error("Local demo failed:", error);
  process.exit(1);
});
