import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  passwordValidationError,
  verifyPassword,
} from "@/server/password";

test("password policy has explicit safe bounds", () => {
  assert.ok(passwordValidationError("a".repeat(MIN_PASSWORD_LENGTH - 1)));
  assert.equal(passwordValidationError("a".repeat(MIN_PASSWORD_LENGTH)), null);
  assert.equal(passwordValidationError("a".repeat(MAX_PASSWORD_LENGTH)), null);
  assert.ok(passwordValidationError("a".repeat(MAX_PASSWORD_LENGTH + 1)));
});

test("password hashes are salted and reject invalid or mismatched values", () => {
  const password = randomBytes(24).toString("base64url");
  const differentPassword = randomBytes(24).toString("base64url");
  const firstHash = hashPassword(password);
  const secondHash = hashPassword(password);

  assert.notEqual(firstHash, secondHash);
  assert.equal(verifyPassword(password, firstHash), true);
  assert.equal(verifyPassword(differentPassword, firstHash), false);
  assert.equal(verifyPassword(password, "not-a-valid-password-hash"), false);
});
