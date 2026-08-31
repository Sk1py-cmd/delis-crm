import { cookies } from "next/headers";
import { COOKIE } from "@/server/auth";
import { requireAccess } from "@/server/guard";
import { getActiveSessions, getAuditEvents } from "@/server/security";
import { SecurityClient } from "./SecurityClient";

export const dynamic = "force-dynamic";

/** Owner-only page; API mutations repeat the authorization check server-side. */
export default async function SecurityPage() {
  const owner = await requireAccess("/security");
  const currentToken = (await cookies()).get(COOKIE)?.value;
  const [sessions, audit] = await Promise.all([getActiveSessions(currentToken), getAuditEvents(100)]);

  return (
    <SecurityClient
      twoFactorEnabled={owner.twoFa}
      sessions={sessions.map((session) => ({
        ...session,
        createdAt: String(session.createdAt),
        expiresAt: String(session.expiresAt),
      }))}
      audit={audit.map((event) => ({
        id: event.id,
        actor: event.actor,
        action: event.action,
        entity: event.entity,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        severity: event.severity,
        ip: event.ip,
        createdAt: String(event.createdAt),
      }))}
    />
  );
}
