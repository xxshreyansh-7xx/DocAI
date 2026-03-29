export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  OCR_TRANSIENT_FAILURE: "OCR_TRANSIENT_FAILURE",
  OCR_PERMANENT_FAILURE: "OCR_PERMANENT_FAILURE",
  STAGE_TIMEOUT: "STAGE_TIMEOUT",
  JOB_FAILED: "JOB_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorShape {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
