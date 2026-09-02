import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/server/auth";
import { requireApiCapability } from "@/server/apiAuth";
import { recordAuditEvent } from "@/server/audit";
import { canAttemptLogin, clearLoginAttempts, registerFailedLogin } from "@/server/loginRateLimit";
import { requestIp } from "@/server/request";
import { revokeUserSessions } from "@/server/security";
import {
  beginTwoFactorEnrollment,
  cancelTwoFactorEnrollment,
  clearTwoFactorCookie,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  regenerateTwoFactorRecoveryCodes,
  TWO_FACTOR_ENROLLMENT_COOKIE,
  TWO_FACTOR_ENROLLMENT_TTL_SECONDS,
  twoFactorCookieOptions,
  TwoFactorConfigurationError,
  verifyOwnerPasswordForTwoFactor,
} from "@/server/twoFactor";

export const dynamic = "force-dynamic";

type TwoFactorRequest = {
  password?: unknown;
  code?: unknown;
  action?: unknown;
};

async function readBody(req: NextRequest): Promise<TwoFactorRequest | null> {
  try {
    return (await req.json()) as TwoFactorRequest;
  } catch {
    return null;
  }
}

function configurationError() {
  return NextResponse.json(
    { error: "Двухфакторная защита временно недоступна. Обратитесь к администратору инфраструктуры." },
    { status: 503 },
  );
}

function clearEnrollmentResponse(error: string, status = 400) {
  const response = NextResponse.json({ error }, { status });
  clearTwoFactorCookie(response, TWO_FACTOR_ENROLLMENT_COOKIE);
  return response;
}

function protectedCodeAttempt(userId: number, ip: string) {
  return canAttemptLogin(`two-factor-settings:${ip}:${userId}`);
}

function tooManyCodeAttempts(retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: "Слишком много попыток кода. Попробуйте позже." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds ?? 60) } },
  );
}

/** QR secrets and recovery codes are one-time sensitive responses; never allow intermediary/browser caching. */
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "security:manage", { write: true });
  if (!auth.ok) return auth.response;

  if (auth.user.twoFa) {
    return NextResponse.json({ error: "Двухфакторная защита уже включена" }, { status: 409 });
  }

  const body = await readBody(req);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 128) {
    return NextResponse.json({ error: "Подтвердите текущий пароль Owner" }, { status: 400 });
  }

  const ip = requestIp(req);
  if (!await verifyOwnerPasswordForTwoFactor(auth.user.id, password)) {
    await recordAuditEvent({
      actor: auth.user,
      action: "неудачно подтвердил пароль для настройки 2FA",
      entity: `@${auth.user.login}`,
      entityType: "user",
      entityId: auth.user.id,
      eventType: "security",
      severity: "warning",
      ip,
      metadata: { action: "begin_two_factor_enrollment" },
    });
    return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 403 });
  }

  try {
    const enrollment = await beginTwoFactorEnrollment(auth.user);
    await recordAuditEvent({
      actor: auth.user,
      action: "начал настройку двухфакторной защиты",
      entity: "Owner account",
      entityType: "user",
      entityId: auth.user.id,
      eventType: "security",
      severity: "info",
      ip,
      metadata: { factor: "totp", enrollmentTtlSeconds: TWO_FACTOR_ENROLLMENT_TTL_SECONDS },
    });

    // The QR image and manual key are intentionally shown once to the authenticated Owner.
    const response = NextResponse.json({
      qrCodeDataUrl: enrollment.qrCodeDataUrl,
      manualKey: enrollment.manualKey,
      expiresAt: enrollment.expiresAt,
    });
    response.cookies.set(
      TWO_FACTOR_ENROLLMENT_COOKIE,
      enrollment.enrollmentToken,
      twoFactorCookieOptions(TWO_FACTOR_ENROLLMENT_TTL_SECONDS),
    );
    return noStore(response);
  } catch (error) {
    if (error instanceof TwoFactorConfigurationError) return configurationError();
    return NextResponse.json({ error: "Не удалось начать настройку двухфакторной защиты" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiCapability(req, "security:manage", { write: true });
  if (!auth.ok) return auth.response;

  const body = await readBody(req);
  const action = body?.action;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code || code.length > 64) {
    return NextResponse.json({ error: "Введите код из приложения или recovery-код" }, { status: 400 });
  }

  const ip = requestIp(req);
  try {
    if (action === "confirmEnrollment") {
      const enrollmentToken = (await cookies()).get(TWO_FACTOR_ENROLLMENT_COOKIE)?.value;
      const result = await confirmTwoFactorEnrollment(auth.user.id, enrollmentToken, code);
      if (result.status === "expired") {
        return clearEnrollmentResponse("Сеанс настройки истёк. Начните настройку заново.", 410);
      }
      if (result.status === "invalid") {
        await recordAuditEvent({
          actor: auth.user,
          action: "неудачно подтвердил настройку 2FA",
          entity: "Owner account",
          entityType: "user",
          entityId: auth.user.id,
          eventType: "security",
          severity: "warning",
          ip,
          metadata: { attemptsRemaining: result.attemptsRemaining },
        });
        if (result.attemptsRemaining === 0) {
          return clearEnrollmentResponse("Лимит попыток исчерпан. Начните настройку заново.", 429);
        }
        return NextResponse.json({ error: "Неверный код из приложения" }, { status: 401 });
      }

      const currentToken = (await cookies()).get(COOKIE)?.value;
      const revoked = await revokeUserSessions(auth.user.id, currentToken);
      await recordAuditEvent({
        actor: auth.user,
        action: "включил двухфакторную защиту Owner",
        entity: "Owner account",
        entityType: "user",
        entityId: auth.user.id,
        eventType: "security",
        severity: "critical",
        ip,
        metadata: { factor: "totp", backupCodesIssued: result.recoveryCodes.length, otherDevicesClosed: revoked.length },
      });

      // Recovery codes are deliberately returned only in this one enrollment response.
      const response = NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes });
      clearTwoFactorCookie(response, TWO_FACTOR_ENROLLMENT_COOKIE);
      return noStore(response);
    }

    if (action === "regenerateRecoveryCodes") {
      const attempt = protectedCodeAttempt(auth.user.id, ip);
      if (!attempt.allowed) return tooManyCodeAttempts(attempt.retryAfterSeconds);

      const result = await regenerateTwoFactorRecoveryCodes(auth.user.id, code);
      if (result.status !== "ok") {
        registerFailedLogin(`two-factor-settings:${ip}:${auth.user.id}`);
        await recordAuditEvent({
          actor: auth.user,
          action: "неудачно подтвердил выпуск recovery-кодов",
          entity: "Owner account",
          entityType: "user",
          entityId: auth.user.id,
          eventType: "security",
          severity: "warning",
          ip,
        });
        return NextResponse.json({ error: "Неверный код двухфакторной защиты" }, { status: 401 });
      }

      clearLoginAttempts(`two-factor-settings:${ip}:${auth.user.id}`);
      await recordAuditEvent({
        actor: auth.user,
        action: "выпустил новые recovery-коды",
        entity: "Owner account",
        entityType: "user",
        entityId: auth.user.id,
        eventType: "security",
        severity: "warning",
        ip,
        metadata: { backupCodesIssued: result.recoveryCodes.length, verification: result.method },
      });
      return noStore(NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }));
    }
  } catch (error) {
    if (error instanceof TwoFactorConfigurationError) return configurationError();
    return NextResponse.json({ error: "Не удалось подтвердить двухфакторную защиту" }, { status: 500 });
  }

  return NextResponse.json({ error: "Неизвестная операция двухфакторной защиты" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiCapability(req, "security:manage", { write: true });
  if (!auth.ok) return auth.response;

  const body = await readBody(req);
  const action = body?.action;
  const ip = requestIp(req);

  if (action === "cancelEnrollment") {
    const enrollmentToken = (await cookies()).get(TWO_FACTOR_ENROLLMENT_COOKIE)?.value;
    await cancelTwoFactorEnrollment(auth.user.id, enrollmentToken);
    await recordAuditEvent({
      actor: auth.user,
      action: "отменил настройку двухфакторной защиты",
      entity: "Owner account",
      entityType: "user",
      entityId: auth.user.id,
      eventType: "security",
      severity: "info",
      ip,
    });
    const response = NextResponse.json({ ok: true });
    clearTwoFactorCookie(response, TWO_FACTOR_ENROLLMENT_COOKIE);
    return response;
  }

  if (action !== "disable") {
    return NextResponse.json({ error: "Неизвестная операция двухфакторной защиты" }, { status: 400 });
  }

  const code = typeof body?.code === "string" ? body.code : "";
  if (!code || code.length > 64) {
    return NextResponse.json({ error: "Введите код двухфакторной защиты" }, { status: 400 });
  }

  const attempt = protectedCodeAttempt(auth.user.id, ip);
  if (!attempt.allowed) return tooManyCodeAttempts(attempt.retryAfterSeconds);

  try {
    const result = await disableTwoFactor(auth.user.id, code);
    if (result.status !== "ok") {
      registerFailedLogin(`two-factor-settings:${ip}:${auth.user.id}`);
      await recordAuditEvent({
        actor: auth.user,
        action: "неудачно подтвердил отключение 2FA",
        entity: "Owner account",
        entityType: "user",
        entityId: auth.user.id,
        eventType: "security",
        severity: "warning",
        ip,
      });
      return NextResponse.json({ error: "Неверный код двухфакторной защиты" }, { status: 401 });
    }

    clearLoginAttempts(`two-factor-settings:${ip}:${auth.user.id}`);
    const currentToken = (await cookies()).get(COOKIE)?.value;
    const revoked = await revokeUserSessions(auth.user.id, currentToken);
    await recordAuditEvent({
      actor: auth.user,
      action: "отключил двухфакторную защиту Owner",
      entity: "Owner account",
      entityType: "user",
      entityId: auth.user.id,
      eventType: "security",
      severity: "critical",
      ip,
      metadata: { verification: result.method, otherDevicesClosed: revoked.length },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TwoFactorConfigurationError) return configurationError();
    return NextResponse.json({ error: "Не удалось отключить двухфакторную защиту" }, { status: 500 });
  }
}
