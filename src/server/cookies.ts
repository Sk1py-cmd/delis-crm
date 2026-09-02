export const SESSION_MAX_AGE_SECONDS = 30 * 86400;

/**
 * Embedded, TLS-protected clients such as an approved preview may explicitly
 * opt into cross-site cookie delivery. Production remains restrictive by default.
 */
export function embeddedCookieMode() {
  return process.env.SESSION_COOKIE_SAME_SITE === "none";
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  const embedded = embeddedCookieMode();
  return {
    httpOnly: true,
    // SameSite=None is valid only with Secure; production keeps Secure too.
    secure: process.env.NODE_ENV === "production" || embedded,
    path: "/",
    sameSite: (embedded ? "none" : "lax") as "none" | "lax",
    maxAge,
  };
}

export function twoFactorCookieOptions(maxAge: number) {
  const embedded = embeddedCookieMode();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || embedded,
    path: "/",
    sameSite: (embedded ? "none" : "strict") as "none" | "strict",
    maxAge,
  };
}
