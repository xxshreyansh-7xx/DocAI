import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "../src/app";

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "application/octet-stream";
}

async function tryOpenFile(pdfPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    await execFileAsync("open", [pdfPath]);
  } catch {
    // Non-fatal.
  }
}

function parseImageArg(argv: string[]): string {
  const imageArg = argv.find((arg) => arg.startsWith("--image="));
  if (imageArg) {
    return imageArg.slice("--image=".length);
  }

  const index = argv.indexOf("--image");
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }

  throw new Error(
    "Missing image path. Usage: npm run demo:image -- --image /absolute/path/to/document.png",
  );
}

async function main(): Promise<void> {
  const imagePath = parseImageArg(process.argv.slice(2));
  const imageBuffer = await readFile(imagePath);
  const imageBase64 = imageBuffer.toString("base64");
  const mimeType = inferMimeType(imagePath);
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "docai-image-demo-"));

  const app = buildApp({
    forceOcrProvider: "google-vision",
    artifactsDir,
  });
  await app.ready();

  console.log(`Using image: ${imagePath}`);
  console.log(`Artifacts directory: ${artifactsDir}`);

  const submit = await app.inject({
    method: "POST",
    url: "/rebuild/jobs",
    headers: { "idempotency-key": `image-demo-${Date.now()}` },
    payload: {
      documentId: path.basename(imagePath),
      pages: [{ pageNumber: 1, base64Data: imageBase64, mimeType }],
      options: { confidenceThreshold: 0.85 },
    },
  });

  if (submit.statusCode !== 202) {
    throw new Error(`Submit failed: ${submit.statusCode} ${submit.body}`);
  }

  const jobId = (submit.json() as { jobId: string }).jobId;
  console.log(`Job accepted: ${jobId}`);

  let finalStatus = "queued";
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const statusRes = await app.inject({
      method: "GET",
      url: `/rebuild/jobs/${jobId}`,
    });
    if (statusRes.statusCode !== 200) {
      throw new Error(`Status failed: ${statusRes.statusCode} ${statusRes.body}`);
    }

    const body = statusRes.json() as { status: string; progress?: { stage?: string } };
    finalStatus = body.status;
    console.log(`Poll #${attempt}: status=${body.status}, stage=${body.progress?.stage ?? "unknown"}`);

    if (body.status === "completed" || body.status === "failed") {
      break;
    }

    await sleep(250);
  }

  const resultRes = await app.inject({
    method: "GET",
    url: `/rebuild/jobs/${jobId}/result`,
  });

  if (finalStatus !== "completed" || resultRes.statusCode !== 200) {
    console.log("Job failed or result unavailable.");
    console.log(resultRes.body);
    await app.close();
    process.exit(1);
  }

  const resultBody = resultRes.json() as {
    result: {
      pdfPath: string;
      structuredBlocks: Array<unknown>;
      confidenceSummary: {
        overallConfidence: number;
        lowConfidenceBlocks: number;
        lowConfidenceLines?: number;
        totalBlocks: number;
      };
    };
  };

  console.log("Image demo completed.");
  console.log(`PDF: ${resultBody.result.pdfPath}`);
  console.log(`Blocks: ${resultBody.result.structuredBlocks.length}`);
  console.log(
    `Confidence: overall=${resultBody.result.confidenceSummary.overallConfidence}, lowConfidenceBlocks=${resultBody.result.confidenceSummary.lowConfidenceBlocks}/${resultBody.result.confidenceSummary.totalBlocks}, lowConfidenceLines=${resultBody.result.confidenceSummary.lowConfidenceLines ?? 0}`,
  );

  await tryOpenFile(resultBody.result.pdfPath);
  await app.close();
}

main().catch((error) => {
  console.error("Image demo failed:", error);
  console.error(
    "Tip: set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON before running this command.",
  );
  process.exit(1);
});
