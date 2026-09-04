/**
 * HTTP fetching with a request timeout and bounded retry of transient failures.
 *
 * "Transient" means the request has a reasonable chance of succeeding if
 * repeated: a network error, a timeout, a 5xx, or an explicit 429. A 4xx is the
 * source telling us the request itself is wrong, so repeating it only wastes
 * the collection window.
 *
 * Backoff is deterministic rather than jittered. Jitter exists to desynchronise
 * many clients hammering one server; there is a single collector here, and a
 * deterministic schedule is worth more because it makes runs reproducible.
 */

export interface RetryOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs?: number;
}

export interface AttemptLog {
  attempt: number;
  url: string;
  status?: number;
  error?: string;
  retried: boolean;
}

export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly attempts: number = 1,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * @param onAttempt called once per attempt so the caller can record retries in
 *                  the collection run's statistics.
 */
export async function fetchWithRetry(
  url: string,
  options: RetryOptions,
  onAttempt?: (log: AttemptLog) => void,
): Promise<Response> {
  const baseDelay = options.retryBaseDelayMs ?? 100;
  const totalAttempts = options.maxRetries + 1;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
      });

      if (isRetryableStatus(response.status) && attempt < totalAttempts) {
        onAttempt?.({ attempt, url, status: response.status, retried: true });
        await sleep(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      onAttempt?.({ attempt, url, status: response.status, retried: false });

      if (!response.ok) {
        throw new HttpRequestError(
          `${url} responded ${response.status} ${response.statusText}`,
          url,
          response.status,
          attempt,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof HttpRequestError) {
        throw error;
      }

      const isTimeout = error instanceof Error && error.name === 'AbortError';
      lastError = new Error(
        isTimeout ? `${url} timed out after ${options.timeoutMs}ms` : `${url} failed: ${describeError(error)}`,
      );

      if (attempt < totalAttempts) {
        onAttempt?.({ attempt, url, error: lastError.message, retried: true });
        await sleep(baseDelay * 2 ** (attempt - 1));
        continue;
      }

      onAttempt?.({ attempt, url, error: lastError.message, retried: false });
    } finally {
      clearTimeout(timer);
    }
  }

  throw new HttpRequestError(
    `${lastError?.message ?? 'request failed'} (after ${totalAttempts} attempts)`,
    url,
    undefined,
    totalAttempts,
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    // fetch wraps the useful detail one level down.
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  return String(error);
}
