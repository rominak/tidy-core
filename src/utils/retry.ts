/**
 * Retry with exponential backoff and jitter.
 *
 * Usage:
 *   const data = await withRetry(() => fetch(url), { maxAttempts: 3 });
 */

export interface RetryOptions {
  maxAttempts?: number;     // Default: 3
  baseDelayMs?: number;     // Default: 1000
  maxDelayMs?: number;      // Default: 10000
  backoffFactor?: number;   // Default: 2
  retryOn?: (error: unknown) => boolean; // Optional filter — return true to retry
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 10_000;
  const backoffFactor = options?.backoffFactor ?? 2;
  const retryOn = options?.retryOn;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts) break;

      // If a filter is provided, only retry when it returns true
      if (retryOn && !retryOn(err)) break;

      const exponentialDelay = baseDelayMs * Math.pow(backoffFactor, attempt - 1);
      const jitter = Math.random() * baseDelayMs * 0.5;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      console.warn(
        `[retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
