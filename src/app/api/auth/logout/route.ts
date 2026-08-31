import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { COOKIE, getSessionUser } from "@/server/auth";
import { rejectForeignWrite, requestIp } from "@/server/request";
import { recordAuditEvent } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  const user = await getSessionUser();
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) {
    await db.delete(s.sessions).where(eq(s.sessions.token, token));
  }
  if (user) {
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
  (await cookies()).set(COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
