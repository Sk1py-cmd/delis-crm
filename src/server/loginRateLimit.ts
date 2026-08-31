const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();

function activeAttempt(key: string): Attempt | null {
  const attempt = attempts.get(key);
  if (!attempt) return null;
  if (attempt.resetAt <= Date.now()) {
    attempts.delete(key);
    return null;
  }
  return attempt;
}

/** In-process protection. Use Redis or another shared limiter when horizontally scaling. */
export function canAttemptLogin(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const attempt = activeAttempt(key);
  if (!attempt || attempt.count < MAX_ATTEMPTS) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((attempt.resetAt - Date.now()) / 1000) };
}

export function registerFailedLogin(key: string) {
  const current = activeAttempt(key);
  attempts.set(key, {
    count: (current?.count ?? 0) + 1,
    resetAt: current?.resetAt ?? Date.now() + WINDOW_MS,
  });
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
