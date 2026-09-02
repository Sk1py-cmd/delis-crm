import { and, desc, eq, gt, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";

export interface ActiveSession {
  id: number;
  userId: number;
  userName: string;
  login: string;
  role: string;
  status: string;
  device: string;
  ip: string;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export async function getActiveSessions(currentToken?: string): Promise<ActiveSession[]> {
  await ensureSeed();
  await db.delete(s.sessions).where(lte(s.sessions.expiresAt, new Date()));

  const rows = await db
    .select({
      id: s.sessions.id,
      token: s.sessions.token,
      userId: s.sessions.userId,
      userName: s.users.name,
      login: s.users.login,
      role: s.users.role,
      status: s.users.status,
      device: s.sessions.device,
      ip: s.sessions.ip,
      createdAt: s.sessions.createdAt,
      expiresAt: s.sessions.expiresAt,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(gt(s.sessions.expiresAt, new Date()))
    .orderBy(desc(s.sessions.createdAt));

  return rows.map(({ token, ...session }) => ({
    ...session,
    isCurrent: Boolean(currentToken && token === currentToken),
  }));
}

export async function revokeSession(sessionId: number) {
  const [session] = await db
    .select({
      id: s.sessions.id,
      token: s.sessions.token,
      userId: s.sessions.userId,
      userName: s.users.name,
      login: s.users.login,
      role: s.users.role,
      device: s.sessions.device,
      ip: s.sessions.ip,
    })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, sessionId), gt(s.sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;

  await db.delete(s.sessions).where(eq(s.sessions.id, sessionId));
  return session;
}

export async function getSecurityUser(userId: number) {
  await ensureSeed();
  const [user] = await db
    .select({ id: s.users.id, name: s.users.name, login: s.users.login, role: s.users.role, status: s.users.status })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  return user ?? null;
}

export async function revokeUserSessions(userId: number, exceptToken?: string) {
  const where = exceptToken
    ? and(eq(s.sessions.userId, userId), gt(s.sessions.expiresAt, new Date()), ne(s.sessions.token, exceptToken))
    : and(eq(s.sessions.userId, userId), gt(s.sessions.expiresAt, new Date()));
  return db.delete(s.sessions).where(where).returning({ id: s.sessions.id });
}

/** Keeps the Owner's current session intact while ending all employee sessions. */
export async function revokeAllEmployeeSessions(ownerUserId: number) {
  return db
    .delete(s.sessions)
    .where(and(ne(s.sessions.userId, ownerUserId), gt(s.sessions.expiresAt, new Date())))
    .returning({ id: s.sessions.id });
}

export async function getAuditEvents(limit = 100) {
  await ensureSeed();
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 250));
  return db.select().from(s.activity).orderBy(desc(s.activity.createdAt)).limit(safeLimit);
}
