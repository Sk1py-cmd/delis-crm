import crypto from "crypto";
import QRCode from "qrcode";
import { and, eq, gt, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { verifyPassword } from "@/server/password";

export const TWO_FACTOR_CHALLENGE_COOKIE = "delis_2fa_challenge";
export const TWO_FACTOR_ENROLLMENT_COOKIE = "delis_2fa_enrollment";
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 10 * 60;
export const TWO_FACTOR_ENROLLMENT_TTL_SECONDS = 10 * 60;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_RECOVERY_CODE_COUNT = 8;

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class TwoFactorConfigurationError extends Error {}

type OwnerSubject = {
  id: number;
  name: string;
  login: string;
  role: string;
};

type TwoFactorUser = {
  id: number;
  name: string;
  login: string;
  email: string;
  role: string;
  agentId: number | null;
};

export type TwoFactorMethod = "totp" | "recovery";

function getEncryptionKey() {
  const configured = (process.env.TWO_FACTOR_ENCRYPTION_KEY ?? "").trim();
  if (!configured) {
    throw new TwoFactorConfigurationError("TWO_FACTOR_ENCRYPTION_KEY is not configured");
  }

  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new TwoFactorConfigurationError("TWO_FACTOR_ENCRYPTION_KEY must contain exactly 32 bytes");
  }
  return key;
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function base32Encode(bytes: Buffer) {
  let value = 0;
  let bits = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(value: string) {
  const normalized = value.replace(/[\s=-]/g, "").toUpperCase();
  if (!normalized) throw new TwoFactorConfigurationError("Empty TOTP secret");

  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new TwoFactorConfigurationError("Invalid TOTP secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    while (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totpForCounter(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3]
  ) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeTwoFactorCode(value: string) {
  return value.trim().replace(/[\s-]/g, "").toUpperCase();
}

export function verifyTotpCode(secret: string, rawCode: string, now = Date.now()) {
  const code = normalizeTwoFactorCode(rawCode);
  if (!/^\d{6}$/.test(code)) return false;

  const counter = Math.floor(now / (TOTP_PERIOD_SECONDS * 1000));
  for (let window = -1; window <= 1; window += 1) {
    if (constantTimeEqual(totpForCounter(secret, counter + window), code)) return true;
  }
  return false;
}

function encryptTotpSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptTotpSecret(encrypted: string) {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = encrypted.split(".");
  if (version !== "v1" || !ivEncoded || !tagEncoded || !ciphertextEncoded || extra) {
    throw new TwoFactorConfigurationError("Stored TOTP secret has an invalid format");
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof TwoFactorConfigurationError) throw error;
    throw new TwoFactorConfigurationError("Stored TOTP secret cannot be decrypted");
  }
}

function recoveryCodeHash(code: string) {
  // Derive a distinct HMAC key so encryption and recovery-code verification do not share a raw key.
  const hashKey = crypto
    .createHmac("sha256", getEncryptionKey())
    .update("delis-crm:two-factor-recovery-code:v1")
    .digest();
  return crypto.createHmac("sha256", hashKey).update(code).digest("hex");
}

function createRecoveryCodes() {
  const codes = new Set<string>();
  while (codes.size < TWO_FACTOR_RECOVERY_CODE_COUNT) {
    const bytes = crypto.randomBytes(10);
    let raw = "";
    for (const byte of bytes) raw += RECOVERY_ALPHABET[byte & 31];
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

function otpAuthUri(login: string, secret: string) {
  const issuer = "DELIS CRM";
  const label = encodeURIComponent(`${issuer}:${login}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function twoFactorCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "strict" as const,
    maxAge,
  };
}

export function clearTwoFactorCookie(response: { cookies: { set: (name: string, value: string, options: ReturnType<typeof twoFactorCookieOptions>) => void } }, name: string) {
  response.cookies.set(name, "", twoFactorCookieOptions(0));
}

async function clearExpiredArtifacts() {
  const now = new Date();
  await Promise.all([
    db.delete(s.twoFactorChallenges).where(lte(s.twoFactorChallenges.expiresAt, now)),
    db.delete(s.twoFactorEnrollments).where(lte(s.twoFactorEnrollments.expiresAt, now)),
  ]);
}

export async function issueTwoFactorChallenge(userId: number) {
  await ensureSeed();
  await clearExpiredArtifacts();
  const challengeToken = randomToken();
  const tokenHash = hashToken(challengeToken);
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_SECONDS * 1000);
  // The unique userId constraint makes a fresh password login replace, rather than parallel, a challenge.
  await db
    .insert(s.twoFactorChallenges)
    .values({ tokenHash, userId, attempts: 0, expiresAt })
    .onConflictDoUpdate({
      target: s.twoFactorChallenges.userId,
      set: { tokenHash, attempts: 0, expiresAt },
    });
  return challengeToken;
}

export async function cancelTwoFactorChallenge(challengeToken?: string) {
  if (!challengeToken) return;
  await db.delete(s.twoFactorChallenges).where(eq(s.twoFactorChallenges.tokenHash, hashToken(challengeToken)));
}

/** Returns only non-secret actor fields so a route can apply an IP/user limiter before code verification. */
export async function getTwoFactorChallengeOwner(challengeToken?: string) {
  if (!challengeToken) return null;
  await ensureSeed();
  const [owner] = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      login: s.users.login,
      role: s.users.role,
      status: s.users.status,
      twoFa: s.users.twoFa,
      secretEncrypted: s.users.twoFaSecretEncrypted,
    })
    .from(s.twoFactorChallenges)
    .innerJoin(s.users, eq(s.users.id, s.twoFactorChallenges.userId))
    .where(and(
      eq(s.twoFactorChallenges.tokenHash, hashToken(challengeToken)),
      gt(s.twoFactorChallenges.expiresAt, new Date()),
      lt(s.twoFactorChallenges.attempts, TWO_FACTOR_MAX_ATTEMPTS),
    ))
    .limit(1);
  if (!owner || owner.role !== "owner" || owner.status !== "active" || !owner.twoFa || !owner.secretEncrypted) return null;
  return { id: owner.id, name: owner.name, login: owner.login };
}

export async function verifyOwnerPasswordForTwoFactor(userId: number, password: string) {
  await ensureSeed();
  const [user] = await db
    .select({ id: s.users.id, role: s.users.role, status: s.users.status, passwordHash: s.users.passwordHash })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  return Boolean(user && user.role === "owner" && user.status === "active" && verifyPassword(password, user.passwordHash));
}

export async function beginTwoFactorEnrollment(owner: OwnerSubject) {
  if (owner.role !== "owner") throw new Error("Two-factor authentication is available only to Owner");
  await ensureSeed();
  await clearExpiredArtifacts();

  const secret = generateTotpSecret();
  const enrollmentToken = randomToken();
  const enrollmentTokenHash = hashToken(enrollmentToken);
  const expiresAt = new Date(Date.now() + TWO_FACTOR_ENROLLMENT_TTL_SECONDS * 1000);
  const secretEncrypted = encryptTotpSecret(secret);

  // Lock the Owner row while replacing setup, so a concurrent confirmation cannot leave a second QR secret behind.
  const stored = await db.transaction(async (tx) => {
    const [availableOwner] = await tx
      .update(s.users)
      .set({ twoFa: false })
      .where(and(
        eq(s.users.id, owner.id),
        eq(s.users.role, "owner"),
        eq(s.users.status, "active"),
        eq(s.users.twoFa, false),
      ))
      .returning({ id: s.users.id });
    if (!availableOwner) return false;

    await tx
      .insert(s.twoFactorEnrollments)
      .values({
        tokenHash: enrollmentTokenHash,
        userId: owner.id,
        secretEncrypted,
        attempts: 0,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: s.twoFactorEnrollments.userId,
        set: { tokenHash: enrollmentTokenHash, secretEncrypted, attempts: 0, expiresAt },
      });
    return true;
  });
  if (!stored) throw new Error("Two-factor authentication is already enabled");

  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUri(owner.login, secret), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
  return { enrollmentToken, manualKey: secret, qrCodeDataUrl, expiresAt };
}

export async function cancelTwoFactorEnrollment(userId: number, enrollmentToken?: string) {
  if (!enrollmentToken) return;
  await db
    .delete(s.twoFactorEnrollments)
    .where(and(eq(s.twoFactorEnrollments.userId, userId), eq(s.twoFactorEnrollments.tokenHash, hashToken(enrollmentToken))));
}

export async function confirmTwoFactorEnrollment(userId: number, enrollmentToken: string | undefined, rawCode: string) {
  if (!enrollmentToken) return { status: "expired" as const };
  await ensureSeed();
  await clearExpiredArtifacts();

  const tokenHash = hashToken(enrollmentToken);
  const [enrollment] = await db
    .select()
    .from(s.twoFactorEnrollments)
    .where(and(
      eq(s.twoFactorEnrollments.userId, userId),
      eq(s.twoFactorEnrollments.tokenHash, tokenHash),
      gt(s.twoFactorEnrollments.expiresAt, new Date()),
      lt(s.twoFactorEnrollments.attempts, TWO_FACTOR_MAX_ATTEMPTS),
    ))
    .limit(1);
  if (!enrollment) return { status: "expired" as const };

  if (!verifyTotpCode(decryptTotpSecret(enrollment.secretEncrypted), rawCode)) {
    // Increment atomically: concurrent requests must not turn five database attempts into more guesses.
    const [updated] = await db
      .update(s.twoFactorEnrollments)
      .set({ attempts: sql`${s.twoFactorEnrollments.attempts} + 1` })
      .where(and(
        eq(s.twoFactorEnrollments.id, enrollment.id),
        eq(s.twoFactorEnrollments.tokenHash, tokenHash),
        gt(s.twoFactorEnrollments.expiresAt, new Date()),
        lt(s.twoFactorEnrollments.attempts, TWO_FACTOR_MAX_ATTEMPTS),
      ))
      .returning({ attempts: s.twoFactorEnrollments.attempts });
    if (!updated) return { status: "expired" as const };

    if (updated.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
      await db.delete(s.twoFactorEnrollments).where(and(
        eq(s.twoFactorEnrollments.id, enrollment.id),
        eq(s.twoFactorEnrollments.tokenHash, tokenHash),
        eq(s.twoFactorEnrollments.attempts, updated.attempts),
      ));
    }
    return {
      status: "invalid" as const,
      attemptsRemaining: Math.max(0, TWO_FACTOR_MAX_ATTEMPTS - updated.attempts),
    };
  }

  const recoveryCodes = createRecoveryCodes();
  const backupRows = recoveryCodes.map((code) => ({ userId, codeHash: recoveryCodeHash(normalizeTwoFactorCode(code)) }));
  const completed = await db.transaction(async (tx) => {
    // Take a row lock before consuming the enrollment token. This serializes setup and confirmation.
    const [availableOwner] = await tx
      .update(s.users)
      .set({ twoFa: false })
      .where(and(
        eq(s.users.id, userId),
        eq(s.users.role, "owner"),
        eq(s.users.status, "active"),
        eq(s.users.twoFa, false),
      ))
      .returning({ id: s.users.id });
    if (!availableOwner) return false;

    const [consumed] = await tx
      .delete(s.twoFactorEnrollments)
      .where(and(
        eq(s.twoFactorEnrollments.id, enrollment.id),
        eq(s.twoFactorEnrollments.tokenHash, tokenHash),
        gt(s.twoFactorEnrollments.expiresAt, new Date()),
      ))
      .returning({ id: s.twoFactorEnrollments.id });
    if (!consumed) return false;

    await tx
      .update(s.users)
      .set({ twoFa: true, twoFaSecretEncrypted: enrollment.secretEncrypted, twoFaEnabledAt: new Date() })
      .where(eq(s.users.id, userId));
    await tx.delete(s.twoFactorBackupCodes).where(eq(s.twoFactorBackupCodes.userId, userId));
    await tx.insert(s.twoFactorBackupCodes).values(backupRows);
    return true;
  });

  return completed ? { status: "ok" as const, recoveryCodes } : { status: "expired" as const };
}

async function verifyTwoFactorCode(userId: number, rawCode: string): Promise<{ valid: false } | { valid: true; method: TwoFactorMethod }> {
  const [user] = await db
    .select({ twoFa: s.users.twoFa, secretEncrypted: s.users.twoFaSecretEncrypted })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!user?.twoFa || !user.secretEncrypted) return { valid: false };

  const code = normalizeTwoFactorCode(rawCode);
  if (verifyTotpCode(decryptTotpSecret(user.secretEncrypted), code)) return { valid: true, method: "totp" };

  if (!/^[A-Z2-9]{10}$/.test(code)) return { valid: false };
  const codeHash = recoveryCodeHash(code);
  const [backupCode] = await db
    .select({ id: s.twoFactorBackupCodes.id })
    .from(s.twoFactorBackupCodes)
    .where(and(
      eq(s.twoFactorBackupCodes.userId, userId),
      eq(s.twoFactorBackupCodes.codeHash, codeHash),
      isNull(s.twoFactorBackupCodes.usedAt),
    ))
    .limit(1);
  if (!backupCode) return { valid: false };

  const [used] = await db
    .update(s.twoFactorBackupCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(s.twoFactorBackupCodes.id, backupCode.id), isNull(s.twoFactorBackupCodes.usedAt)))
    .returning({ id: s.twoFactorBackupCodes.id });
  return used ? { valid: true, method: "recovery" } : { valid: false };
}

export async function completeTwoFactorLogin(challengeToken: string | undefined, rawCode: string) {
  if (!challengeToken) return { status: "expired" as const };
  await ensureSeed();
  await clearExpiredArtifacts();

  const tokenHash = hashToken(challengeToken);
  const [row] = await db
    .select({
      challengeId: s.twoFactorChallenges.id,
      attempts: s.twoFactorChallenges.attempts,
      userId: s.users.id,
      userName: s.users.name,
      login: s.users.login,
      email: s.users.email,
      role: s.users.role,
      agentId: s.users.agentId,
      status: s.users.status,
      twoFa: s.users.twoFa,
      secretEncrypted: s.users.twoFaSecretEncrypted,
    })
    .from(s.twoFactorChallenges)
    .innerJoin(s.users, eq(s.users.id, s.twoFactorChallenges.userId))
    .where(and(
      eq(s.twoFactorChallenges.tokenHash, tokenHash),
      gt(s.twoFactorChallenges.expiresAt, new Date()),
      lt(s.twoFactorChallenges.attempts, TWO_FACTOR_MAX_ATTEMPTS),
    ))
    .limit(1);
  if (!row || row.status !== "active" || row.role !== "owner" || !row.twoFa || !row.secretEncrypted) {
    return { status: "expired" as const };
  }

  const user: TwoFactorUser = {
    id: row.userId,
    name: row.userName,
    login: row.login,
    email: row.email,
    role: row.role,
    agentId: row.agentId,
  };
  const verification = await verifyTwoFactorCode(row.userId, rawCode);
  if (!verification.valid) {
    // The database, not only the in-process IP limiter, is authoritative for challenge attempts.
    const [updated] = await db
      .update(s.twoFactorChallenges)
      .set({ attempts: sql`${s.twoFactorChallenges.attempts} + 1` })
      .where(and(
        eq(s.twoFactorChallenges.id, row.challengeId),
        eq(s.twoFactorChallenges.tokenHash, tokenHash),
        gt(s.twoFactorChallenges.expiresAt, new Date()),
        lt(s.twoFactorChallenges.attempts, TWO_FACTOR_MAX_ATTEMPTS),
      ))
      .returning({ attempts: s.twoFactorChallenges.attempts });
    if (!updated) return { status: "expired" as const };

    if (updated.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
      await db.delete(s.twoFactorChallenges).where(and(
        eq(s.twoFactorChallenges.id, row.challengeId),
        eq(s.twoFactorChallenges.tokenHash, tokenHash),
        eq(s.twoFactorChallenges.attempts, updated.attempts),
      ));
    }
    return {
      status: "invalid" as const,
      user,
      attemptsRemaining: Math.max(0, TWO_FACTOR_MAX_ATTEMPTS - updated.attempts),
    };
  }

  const [consumed] = await db
    .delete(s.twoFactorChallenges)
    .where(and(
      eq(s.twoFactorChallenges.id, row.challengeId),
      eq(s.twoFactorChallenges.tokenHash, tokenHash),
      gt(s.twoFactorChallenges.expiresAt, new Date()),
      lt(s.twoFactorChallenges.attempts, TWO_FACTOR_MAX_ATTEMPTS),
    ))
    .returning({ id: s.twoFactorChallenges.id });
  if (!consumed) return { status: "expired" as const };

  return { status: "ok" as const, user, method: verification.method };
}

export async function regenerateTwoFactorRecoveryCodes(userId: number, rawCode: string) {
  await ensureSeed();
  const verification = await verifyTwoFactorCode(userId, rawCode);
  if (!verification.valid) return { status: "invalid" as const };

  const recoveryCodes = createRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.delete(s.twoFactorBackupCodes).where(eq(s.twoFactorBackupCodes.userId, userId));
    await tx.insert(s.twoFactorBackupCodes).values(
      recoveryCodes.map((code) => ({ userId, codeHash: recoveryCodeHash(normalizeTwoFactorCode(code)) })),
    );
  });
  return { status: "ok" as const, recoveryCodes, method: verification.method };
}

export async function disableTwoFactor(userId: number, rawCode: string) {
  await ensureSeed();
  const verification = await verifyTwoFactorCode(userId, rawCode);
  if (!verification.valid) return { status: "invalid" as const };

  await db.transaction(async (tx) => {
    await tx
      .update(s.users)
      .set({ twoFa: false, twoFaSecretEncrypted: "", twoFaEnabledAt: null })
      .where(eq(s.users.id, userId));
    await tx.delete(s.twoFactorBackupCodes).where(eq(s.twoFactorBackupCodes.userId, userId));
    await tx.delete(s.twoFactorEnrollments).where(eq(s.twoFactorEnrollments.userId, userId));
    await tx.delete(s.twoFactorChallenges).where(eq(s.twoFactorChallenges.userId, userId));
  });
  return { status: "ok" as const, method: verification.method };
}
