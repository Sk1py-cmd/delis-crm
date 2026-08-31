import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE } from "@/server/auth";
import { requireApiCapability } from "@/server/apiAuth";
import { recordAuditEvent } from "@/server/audit";
import { getActiveSessions, getSecurityUser, revokeAllEmployeeSessions, revokeSession, revokeUserSessions } from "@/server/security";
import { requestIp } from "@/server/request";

export const dynamic = "force-dynamic";

type SessionDeleteRequest = {
  mode?: unknown;
  sessionId?: unknown;
  userId?: unknown;
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 0,
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "security:manage");
  if (!auth.ok) return auth.response;

  const currentToken = (await cookies()).get(COOKIE)?.value;
  const sessions = await getActiveSessions(currentToken);
  return NextResponse.json({ sessions });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiCapability(req, "security:manage", { write: true });
  if (!auth.ok) return auth.response;

  let body: SessionDeleteRequest;
  try {
    body = (await req.json()) as SessionDeleteRequest;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const currentToken = (await cookies()).get(COOKIE)?.value;
  const mode = body.mode;
  const ip = requestIp(req);

  if (mode === "session") {
    const sessionId = positiveInteger(body.sessionId);
    if (!sessionId) return NextResponse.json({ error: "Некорректная сессия" }, { status: 400 });

    const target = await revokeSession(sessionId);
    if (!target) return NextResponse.json({ error: "Активная сессия не найдена" }, { status: 404 });

    await recordAuditEvent({
      actor: auth.user,
      action: "завершил активную сессию",
      entity: `@${target.login}`,
      entityType: "session",
      entityId: target.id,
      eventType: "security",
      severity: "warning",
      ip,
      metadata: { targetUserId: target.userId, targetRole: target.role, mode: "single" },
    });

    const response = NextResponse.json({ ok: true, currentSessionRevoked: target.token === currentToken });
    if (target.token === currentToken) clearSessionCookie(response);
    return response;
  }

  if (mode === "user") {
    const userId = positiveInteger(body.userId);
    if (!userId) return NextResponse.json({ error: "Некорректный сотрудник" }, { status: 400 });

    const target = await getSecurityUser(userId);
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (target.role === "owner" && target.id !== auth.user.id) {
      return NextResponse.json({ error: "Нельзя завершить сессии другого Owner" }, { status: 403 });
    }

    // Do not accidentally lock the Owner out of the security centre: preserve this tab's session.
    const revoked = await revokeUserSessions(userId, userId === auth.user.id ? currentToken : undefined);
    await recordAuditEvent({
      actor: auth.user,
      action: "завершил все сессии пользователя",
      entity: `@${target.login}`,
      entityType: "user",
      entityId: userId,
      eventType: "security",
      severity: "warning",
      ip,
      metadata: { targetRole: target.role, endedCount: revoked.length, mode: "user" },
    });
    return NextResponse.json({ ok: true, revokedSessions: revoked.length });
  }

  if (mode === "allEmployees") {
    const revoked = await revokeAllEmployeeSessions(auth.user.id);
    await recordAuditEvent({
      actor: auth.user,
      action: "завершил все сессии сотрудников",
      entity: "Все сотрудники",
      entityType: "session",
      eventType: "security",
      severity: "critical",
      ip,
      metadata: { endedCount: revoked.length, mode: "allEmployees" },
    });
    return NextResponse.json({ ok: true, revokedSessions: revoked.length });
  }

  return NextResponse.json({ error: "Неизвестный режим завершения сессии" }, { status: 400 });
}
