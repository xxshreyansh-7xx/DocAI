import "dotenv/config";

export interface AppConfig {
  port: number;
  ocrProvider: "google-vision" | "mock";
  confidenceThreshold: number;
  stageTimeoutMs: number;
  maxOcrRetries: number;
  artifactsDir: string;
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 8080),
    ocrProvider: (process.env.OCR_PROVIDER as "google-vision" | "mock") ?? "google-vision",
    confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD ?? 0.85),
    stageTimeoutMs: Number(process.env.STAGE_TIMEOUT_MS ?? 15000),
    maxOcrRetries: Number(process.env.MAX_OCR_RETRIES ?? 2),
    artifactsDir: process.env.ARTIFACTS_DIR ?? "artifacts",
  };
}
