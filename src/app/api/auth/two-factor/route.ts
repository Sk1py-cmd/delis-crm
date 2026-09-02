import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, createSessionForUser, sessionCookieOptions } from "@/server/auth";
import { recordAuditEvent } from "@/server/audit";
import { canAttemptLogin, clearLoginAttempts, registerFailedLogin } from "@/server/loginRateLimit";
import { rejectForeignWrite, requestIp } from "@/server/request";
import {
  cancelTwoFactorChallenge,
  clearTwoFactorCookie,
  completeTwoFactorLogin,
  getTwoFactorChallengeOwner,
  TWO_FACTOR_CHALLENGE_COOKIE,
  TwoFactorConfigurationError,
} from "@/server/twoFactor";

export const dynamic = "force-dynamic";

function expiredChallengeResponse() {
  const response = NextResponse.json(
    { error: "Сеанс двухфакторной проверки истёк. Войдите с логином и паролем ещё раз." },
    { status: 401 },
  );
  clearTwoFactorCookie(response, TWO_FACTOR_CHALLENGE_COOKIE);
  return response;
}

export async function POST(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  let body: { code?: unknown };
  try {
    body = (await req.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (typeof body.code !== "string" || body.code.length > 64) {
    return NextResponse.json({ error: "Введите код из приложения или recovery-код" }, { status: 400 });
  }

  const challengeToken = (await cookies()).get(TWO_FACTOR_CHALLENGE_COOKIE)?.value;
  const ip = requestIp(req);
  const challengeOwner = await getTwoFactorChallengeOwner(challengeToken);
  if (!challengeOwner) return expiredChallengeResponse();

  // This limiter survives fresh password/challenge requests in the same process,
  // so the per-challenge counter cannot be reset to brute-force TOTP codes.
  const attemptKey = `two-factor:${ip}:${challengeOwner.id}`;
  const attempt = canAttemptLogin(attemptKey);
  if (!attempt.allowed) {
    await recordAuditEvent({
      actor: challengeOwner,
      action: "двухфакторная проверка отклонена ограничением попыток",
      entity: `@${challengeOwner.login}`,
      entityType: "user",
      entityId: challengeOwner.id,
      eventType: "auth",
      severity: "warning",
      ip,
      metadata: { reason: "two_factor_rate_limited" },
    });
    return NextResponse.json(
      { error: "Слишком много попыток кода. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds ?? 60) } },
    );
  }

  let result: Awaited<ReturnType<typeof completeTwoFactorLogin>>;
  try {
    result = await completeTwoFactorLogin(challengeToken, body.code);
  } catch (error) {
    if (error instanceof TwoFactorConfigurationError) {
      return NextResponse.json(
        { error: "Двухфакторная проверка временно недоступна. Обратитесь к администратору инфраструктуры." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Не удалось подтвердить двухфакторный код" }, { status: 500 });
  }
  if (result.status === "expired") return expiredChallengeResponse();

  if (result.status === "invalid") {
    registerFailedLogin(attemptKey);
    await recordAuditEvent({
      actor: result.user,
      action: "неудачная двухфакторная проверка Owner",
      entity: `@${result.user.login}`,
      entityType: "user",
      entityId: result.user.id,
      eventType: "auth",
      severity: "warning",
      ip,
      metadata: { attemptsRemaining: result.attemptsRemaining },
    });
    if (result.attemptsRemaining === 0) return expiredChallengeResponse();
    return NextResponse.json({ error: "Неверный код. Попробуйте ещё раз." }, { status: 401 });
  }

  clearLoginAttempts(attemptKey);
  const session = await createSessionForUser(result.user.id, req);
  await recordAuditEvent({
    actor: result.user,
    action: "вошёл в систему с двухфакторной защитой",
    entity: "DELIS CRM",
    entityType: "session",
    eventType: "auth",
    severity: "info",
    ip,
    metadata: { factor: result.method },
  });

  const response = NextResponse.json({ ok: true, name: result.user.name, role: result.user.role });
  response.cookies.set(COOKIE, session.token, sessionCookieOptions());
  clearTwoFactorCookie(response, TWO_FACTOR_CHALLENGE_COOKIE);
  return response;
}

export async function DELETE(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  const challengeToken = (await cookies()).get(TWO_FACTOR_CHALLENGE_COOKIE)?.value;
  await cancelTwoFactorChallenge(challengeToken);
  const response = NextResponse.json({ ok: true });
  clearTwoFactorCookie(response, TWO_FACTOR_CHALLENGE_COOKIE);
  return response;
}
