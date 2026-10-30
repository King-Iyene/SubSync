// Fetch wrapper for GHL data calls: retries 429 and 5xx with exponential backoff and jitter,
// honouring Retry-After. The docs give no 429 guidance, so this is our own policy.
// Limits are per app per location (100 requests per 10 seconds, 200,000 per day), and each
// response carries X-RateLimit-* headers we can read to slow down before hitting them.

export type RateLimitInfo = {
  dailyRemaining: number | null;
  burstRemaining: number | null;
  burstIntervalMs: number | null;
};

export function readRateLimit(headers: Headers): RateLimitInfo {
  const num = (name: string) => {
    const value = headers.get(name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    dailyRemaining: num("X-RateLimit-Daily-Remaining"),
    burstRemaining: num("X-RateLimit-Remaining"),
    burstIntervalMs: num("X-RateLimit-Interval-Milliseconds"),
  };
}

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function ghlFetch(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const {
    maxRetries = 4,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, init);
    // Close to the burst limit: pause for the rest of the window instead of waiting to be refused.
    const limit = readRateLimit(response.headers);
    if (limit.burstRemaining !== null && limit.burstRemaining <= 5 && limit.burstIntervalMs !== null) {
      await sleep(Math.min(maxDelayMs, limit.burstIntervalMs));
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= maxRetries) return response;

    const retryAfter = Number(response.headers.get("Retry-After"));
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jitter = backoff * 0.25 * random();
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(maxDelayMs, retryAfter * 1000)
      : backoff + jitter;
    await sleep(delay);
  }
}
