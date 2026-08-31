import crypto from "crypto";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export function passwordValidationError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Пароль не должен быть длиннее ${MAX_PASSWORD_LENGTH} символов`;
  }
  return null;
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const test = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}
