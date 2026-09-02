import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { COOKIE, getSessionUser, sessionCookieOptions } from "@/server/auth";
import { recordAuditEvent } from "@/server/audit";
import { rejectForeignWrite, requestIp } from "@/server/request";
import {
  cancelTwoFactorChallenge,
  cancelTwoFactorEnrollment,
  clearTwoFactorCookie,
  TWO_FACTOR_CHALLENGE_COOKIE,
  TWO_FACTOR_ENROLLMENT_COOKIE,
} from "@/server/twoFactor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  const user = await getSessionUser();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  const enrollmentToken = cookieStore.get(TWO_FACTOR_ENROLLMENT_COOKIE)?.value;
  const challengeToken = cookieStore.get(TWO_FACTOR_CHALLENGE_COOKIE)?.value;
  if (token) {
    await db.delete(s.sessions).where(eq(s.sessions.token, token));
  }
  if (user) {
    await cancelTwoFactorEnrollment(user.id, enrollmentToken);
    await recordAuditEvent({
      actor: user,
      action: "вышел из системы",
      entity: "DELIS CRM",
      entityType: "session",
      eventType: "auth",
      severity: "info",
      ip: requestIp(req),
    });
  }
  await cancelTwoFactorChallenge(challengeToken);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE, "", sessionCookieOptions(0));
  clearTwoFactorCookie(response, TWO_FACTOR_CHALLENGE_COOKIE);
  clearTwoFactorCookie(response, TWO_FACTOR_ENROLLMENT_COOKIE);
  return response;
}
