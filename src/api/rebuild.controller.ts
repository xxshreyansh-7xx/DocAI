import type { FastifyReply, FastifyRequest } from "fastify";
import { SubmitRebuildJobSchema } from "../types/api";
import type { JobRunnerService } from "../services/jobs/job-runner";
import { AppError } from "../utils/app-error";

export class RebuildController {
  constructor(private readonly jobs: JobRunnerService) {}

  submit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parseResult = SubmitRebuildJobSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.flatten(),
        },
      });
      return;
    }

    const idempotencyKey = request.headers["idempotency-key"] as string | undefined;

    try {
      const job = await this.jobs.submitJob(parseResult.data, idempotencyKey);
      reply.status(202).send({
        jobId: job.jobId,
        acceptedAt: job.createdAt,
        status: job.status,
      });
    } catch (error) {
      this.handleError(error, reply);
    }
  };

  status = async (
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      const job = await this.jobs.getJob(request.params.jobId);
      reply.send({
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        error: job.error ?? null,
        updatedAt: job.updatedAt,
      });
    } catch (error) {
      this.handleError(error, reply);
    }
  };

  result = async (
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    try {
      const job = await this.jobs.getJob(request.params.jobId);
      if (job.status !== "completed" || !job.result) {
        reply.status(409).send({
          error: {
            code: "CONFLICT",
            message: "Result is not available yet",
          },
        });
        return;
      }
      reply.send({
        jobId: job.jobId,
        status: job.status,
        result: job.result,
      });
    } catch (error) {
      this.handleError(error, reply);
    }
  };

  private handleError(error: unknown, reply: FastifyReply): void {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected error",
      },
    });
  }
}
