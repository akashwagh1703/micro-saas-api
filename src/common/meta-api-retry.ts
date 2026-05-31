/** Shared retry logic for Meta Graph API calls (WhatsApp + Instagram). */

export interface MetaApiRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export function isRetryableMetaStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function metaApiRetryDelay(attempt: number, baseDelayMs = 500): number {
  const jitter = Math.floor(Math.random() * 200);
  return baseDelayMs * 2 ** attempt + jitter;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withMetaApiRetry<T>(
  fn: () => Promise<{ status: number; data: T }>,
  options: MetaApiRetryOptions = {},
): Promise<{ status: number; data: T; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let last: { status: number; data: T } = { status: 0, data: {} as T };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await fn();
    if (!isRetryableMetaStatus(last.status) || attempt === maxAttempts - 1) {
      return { ...last, attempts: attempt + 1 };
    }
    await sleep(metaApiRetryDelay(attempt, baseDelayMs));
  }

  return { ...last, attempts: maxAttempts };
}
