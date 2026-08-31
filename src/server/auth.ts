import crypto from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { requestIp } from "@/server/request";

export const COOKIE = "delis_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 86400;

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax" as const,
    maxAge,
  };
}

/** Creates the durable session record; callers place the opaque token in an HttpOnly cookie. */
export async function createSessionForUser(userId: number, req: NextRequest) {
  await ensureSeed();
  const token = crypto.randomBytes(32).toString("base64url");
  const device = (req.headers.get("user-agent") ?? "").slice(0, 160);
  const ip = requestIp(req);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await db.delete(s.sessions).where(sql`${s.sessions.expiresAt} <= now()`);
  await db.insert(s.sessions).values({ token, userId, device, ip, expiresAt });
  await db
    .update(s.users)
    .set({ lastLoginAt: new Date(), lastIp: ip, device })
    .where(eq(s.users.id, userId));

  return { token, device, ip, expiresAt };
}

export interface SessionUser {
  id: number;
  name: string;
  login: string;
  email: string;
  role: string;
  agentId: number | null;
  twoFa: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    await ensureSeed();
    const token = (await cookies()).get(COOKIE)?.value;
    if (!token) return null;
    const rows = await db
      .select({ u: s.users })
      .from(s.sessions)
      .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
      .where(
        and(
          eq(s.sessions.token, token),
          gt(s.sessions.expiresAt, new Date()),
          eq(s.users.status, "active"),
        ),
      )
      .limit(1);
    const u = rows[0]?.u;
    return u
      ? {
        id: u.id,
        name: u.name,
        login: u.login,
        email: u.email,
        role: u.role,
        agentId: u.agentId,
        twoFa: u.twoFa,
      }
      : null;
  } catch {
    return null;
  }
}

/** Only the single Owner can issue, reset, or revoke employee credentials. */
export function canManageUsers(role: string) {
  return role === "owner";
}
