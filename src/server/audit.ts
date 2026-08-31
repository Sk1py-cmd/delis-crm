import { db } from "@/db";
import * as s from "@/db/schema";

export type AuditEventType = "auth" | "security" | "business" | "system";
export type AuditSeverity = "info" | "warning" | "critical";
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditActor {
  id: number;
  name: string;
  login?: string;
}

function limit(value: string, max: number) {
  return value.slice(0, max);
}

const SENSITIVE_METADATA_KEY = /pass(word)?|pwd|token|secret|credential|authorization|cookie|session|api[_-]?key|totp|otp|recovery/i;

export function safeAuditMetadata(metadata: AuditMetadata | undefined): AuditMetadata {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
      .slice(0, 30)
      .map(([key, value]) => [limit(key, 80), typeof value === "string" ? limit(value, 500) : value]),
  );
}

/**
 * Writes a durable audit event. Metadata is deliberately primitive-only and
 * credential, session, TOTP, and recovery-code key names are removed as defence in depth.
 */
export async function recordAuditEvent(input: {
  actor?: AuditActor | null;
  actorName?: string;
  action: string;
  entity?: string;
  entityType?: string;
  entityId?: number | null;
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  ip?: string;
  metadata?: AuditMetadata;
}) {
  const [event] = await db
    .insert(s.activity)
    .values({
      actorUserId: input.actor?.id ?? null,
      actor: limit(input.actor?.name ?? input.actorName ?? "Система", 120),
      action: limit(input.action, 240),
      entity: limit(input.entity ?? "", 300),
      entityType: limit(input.entityType ?? "", 80),
      entityId: input.entityId ?? null,
      eventType: input.eventType ?? "business",
      severity: input.severity ?? "info",
      ip: limit(input.ip ?? "", 80),
      metadata: safeAuditMetadata(input.metadata),
    })
    .returning();
  return event;
}
