import type { ErrorCode } from "../types/errors";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(params: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    retryable?: boolean;
  }) {
    super(params.message);
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.details = params.details;
    this.retryable = params.retryable ?? false;
  }
}
