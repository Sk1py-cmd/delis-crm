import assert from "node:assert/strict";
import test from "node:test";
import { sessionCookieOptions, twoFactorCookieOptions } from "@/server/cookies";

function restoreEnvironment(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test("session and two-factor cookies use restrictive defaults", () => {
  const previous = process.env.SESSION_COOKIE_SAME_SITE;
  delete process.env.SESSION_COOKIE_SAME_SITE;

  try {
    assert.equal(sessionCookieOptions().sameSite, "lax");
    assert.equal(twoFactorCookieOptions(60).sameSite, "strict");
    assert.equal(sessionCookieOptions().partitioned, false);
    assert.equal(twoFactorCookieOptions(60).partitioned, false);
  } finally {
    restoreEnvironment("SESSION_COOKIE_SAME_SITE", previous);
  }
});

test("embedded cookie delivery needs an explicit opt-in and always uses Secure", () => {
  const previous = process.env.SESSION_COOKIE_SAME_SITE;
  process.env.SESSION_COOKIE_SAME_SITE = "none";

  try {
    const session = sessionCookieOptions();
    const twoFactor = twoFactorCookieOptions(60);
    assert.equal(session.sameSite, "none");
    assert.equal(twoFactor.sameSite, "none");
    assert.equal(session.secure, true);
    assert.equal(twoFactor.secure, true);
    assert.equal(session.partitioned, true);
    assert.equal(twoFactor.partitioned, true);
  } finally {
    restoreEnvironment("SESSION_COOKIE_SAME_SITE", previous);
  }
});
