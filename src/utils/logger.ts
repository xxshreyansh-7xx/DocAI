import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export interface StageLogContext {
  jobId: string;
  stage: string;
  durationMs: number;
  outcome: "success" | "failed";
  details?: Record<string, unknown>;
}

export function logStage(ctx: StageLogContext): void {
  logger.info(
    {
      jobId: ctx.jobId,
      stage: ctx.stage,
      durationMs: ctx.durationMs,
      outcome: ctx.outcome,
      ...ctx.details,
    },
    "job-stage",
  );
}
