import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { verifyPassword } from "@/server/password";
import { COOKIE, createSessionForUser, sessionCookieOptions } from "@/server/auth";
import { canAttemptLogin, clearLoginAttempts, registerFailedLogin } from "@/server/loginRateLimit";
import { rejectForeignWrite, requestIp } from "@/server/request";
import { recordAuditEvent } from "@/server/audit";
import {
  clearTwoFactorCookie,
  issueTwoFactorChallenge,
  TWO_FACTOR_CHALLENGE_COOKIE,
  TWO_FACTOR_ENROLLMENT_COOKIE,
  TWO_FACTOR_CHALLENGE_TTL_SECONDS,
  twoFactorCookieOptions,
} from "@/server/twoFactor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  try {
    await ensureSeed();
  } catch {
    return NextResponse.json(
      { error: "CRM ещё не настроена. Проверьте OWNER_LOGIN и OWNER_PASSWORD в переменных окружения." },
      { status: 503 },
    );
  }

  let body: { login?: string; password?: string };
  try {
    body = (await req.json()) as { login?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const login = (body.login ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!login || !password) {
    return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });
  }

  const ip = requestIp(req);
  const attemptKey = `${ip}:${login}`;
  const attempt = canAttemptLogin(attemptKey);
  if (!attempt.allowed) {
    await recordAuditEvent({
      actorName: "Неизвестный пользователь",
      action: "вход отклонён ограничением попыток",
      entity: `@${login}`,
      entityType: "user",
      eventType: "auth",
      severity: "warning",
      ip,
      metadata: { reason: "rate_limited" },
    });
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds ?? 60) } },
    );
  }

  const rows = await db
    .select()
    .from(s.users)
    .where(and(sql`lower(${s.users.login}) = ${login}`, eq(s.users.status, "active")))
    .limit(1);
  const user = rows[0];

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(attemptKey);
    await recordAuditEvent({
      actor: user ? { id: user.id, name: user.name, login: user.login } : null,
      actorName: "Неизвестный пользователь",
      action: "неудачная попытка входа",
      entity: user ? `@${user.login}` : `@${login}`,
      entityType: "user",
      entityId: user?.id ?? null,
      eventType: "auth",
      severity: "warning",
      ip,
      metadata: { reason: user ? "invalid_password" : "unknown_or_blocked_login" },
    });
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  clearLoginAttempts(attemptKey);

  if (user.role === "owner" && user.twoFa) {
    if (!user.twoFaSecretEncrypted) {
      await recordAuditEvent({
        actor: { id: user.id, name: user.name, login: user.login },
        action: "вход Owner отклонён: 2FA настроена некорректно",
        entity: `@${user.login}`,
        entityType: "user",
        entityId: user.id,
        eventType: "security",
        severity: "critical",
        ip,
        metadata: { reason: "missing_totp_secret" },
      });
      return NextResponse.json(
        { error: "Двухфакторная защита настроена некорректно. Обратитесь к администратору инфраструктуры." },
        { status: 503 },
      );
    }

    const challengeToken = await issueTwoFactorChallenge(user.id);
    await recordAuditEvent({
      actor: { id: user.id, name: user.name, login: user.login },
      action: "подтвердил пароль, ожидается код 2FA",
      entity: "DELIS CRM",
      entityType: "session",
      eventType: "auth",
      severity: "info",
      ip,
      metadata: { factor: "totp" },
    });

    const response = NextResponse.json({ requiresTwoFactor: true });
    response.cookies.set(
      TWO_FACTOR_CHALLENGE_COOKIE,
      challengeToken,
      twoFactorCookieOptions(TWO_FACTOR_CHALLENGE_TTL_SECONDS),
    );
    return response;
  }

  const session = await createSessionForUser(user.id, req);
  await recordAuditEvent({
    actor: { id: user.id, name: user.name, login: user.login },
    action: "вошёл в систему",
    entity: "DELIS CRM",
    entityType: "session",
    eventType: "auth",
    severity: "info",
    ip,
    metadata: { role: user.role },
  });

  const response = NextResponse.json({ ok: true, name: user.name, role: user.role });
  response.cookies.set(COOKIE, session.token, sessionCookieOptions());
  clearTwoFactorCookie(response, TWO_FACTOR_CHALLENGE_COOKIE);
  clearTwoFactorCookie(response, TWO_FACTOR_ENROLLMENT_COOKIE);
  return response;
}
