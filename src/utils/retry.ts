import { AppError } from "./app-error";

export async function withRetry<T>(params: {
  maxAttempts: number;
  operation: () => Promise<T>;
  onRetry?: (attempt: number, error: unknown) => void;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= params.maxAttempts; attempt += 1) {
    try {
      return await params.operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AppError ? error.retryable : false;
      if (!retryable || attempt === params.maxAttempts) {
        break;
      }
      params.onRetry?.(attempt, error);
    }
  }

  throw lastError;
}
