import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { and, eq, lt, sql } from "drizzle-orm";

export type AutomationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_MESSAGE_LENGTH = 4_000;

export const VIP_THRESHOLD = 5_000_000;

type CustomerForAutomation = Pick<
  typeof s.customers.$inferSelect,
  "id" | "firstName" | "lastName" | "username" | "source" | "isVip" | "marketingConsent"
>;

export type AutomationEvent = "vip_threshold" | "sleeping_customer" | "order_created";

export interface AutomationResult {
  runs: number;
  messages: number;
  bonusGranted: number;
}

function renderTemplate(template: string, customer: CustomerForAutomation) {
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  return template
    .replaceAll("{{firstName}}", customer.firstName)
    .replaceAll("{{lastName}}", customer.lastName)
    .replaceAll("{{fullName}}", fullName)
    .slice(0, MAX_MESSAGE_LENGTH);
}

function deliveryTarget(source: string) {
  if (source === "telegram") return "telegram_bot";
  if (source === "miniapp") return "miniapp";
  if (source === "website") return "website";
  if (source === "instagram") return "instagram";
  return "marketing";
}

/**
 * Queues eligible customer automations and their communication records inside
 * the caller's business transaction. The unique run key makes retry/replay
 * safe: each trigger can act on a customer for an event at most once.
 */
export async function runCustomerAutomationEvent(
  tx: AutomationTx,
  customer: CustomerForAutomation,
  eventKey: AutomationEvent,
): Promise<AutomationResult> {
  // A loyalty-status transition remains an operational fact even after a client
  // opts out; all other scenarios require explicit marketing consent.
  if (!customer.marketingConsent && eventKey !== "vip_threshold") {
    return { runs: 0, messages: 0, bonusGranted: 0 };
  }

  const triggers = await tx
    .select()
    .from(s.marketingTriggers)
    .where(and(eq(s.marketingTriggers.eventKey, eventKey), eq(s.marketingTriggers.isActive, true)));

  let runs = 0;
  let messages = 0;
  let bonusGranted = 0;
  for (const trigger of triggers) {
    const [run] = await tx
      .insert(s.automationRuns)
      .values({
        triggerId: trigger.id,
        customerId: customer.id,
        eventKey,
        actionType: trigger.actionType,
        status: "queued",
      })
      .onConflictDoNothing()
      .returning({ id: s.automationRuns.id });
    if (!run) continue;

    const message = renderTemplate(trigger.messageBody, customer);
    if (customer.marketingConsent && message) {
      await tx.insert(s.messages).values({
        customerId: customer.id,
        body: message,
        fromAdmin: true,
        kind: "automation",
      });
      messages += 1;
    }

    const granted = trigger.actionType === "bonus_points" ? Math.max(0, trigger.discountBonus) : 0;
    if (granted > 0 || eventKey === "vip_threshold") {
      await tx
        .update(s.customers)
        .set({
          ...(granted > 0 ? { bonus: sql`${s.customers.bonus} + ${granted}` } : {}),
          ...(eventKey === "vip_threshold" ? { isVip: true } : {}),
        })
        .where(eq(s.customers.id, customer.id));
      bonusGranted += granted;
    }

    await tx.update(s.marketingTriggers).set({ triggeredCount: sql`${s.marketingTriggers.triggeredCount} + 1` }).where(eq(s.marketingTriggers.id, trigger.id));
    if (customer.marketingConsent && message) {
      await tx.insert(s.syncEvents).values({
        source: "automation",
        target: deliveryTarget(customer.source),
        entity: "customer_automation",
        action: "automation_queued",
        payload: { triggerId: trigger.id, customerId: customer.id, eventKey },
      });
    }
    await tx.insert(s.activity).values({
      actor: "Автоматизация",
      action: "запустила сценарий для клиента",
      entity: trigger.title.slice(0, 300),
      entityType: "marketing_trigger",
      entityId: trigger.id,
      eventType: "business",
      metadata: { customerId: customer.id, eventKey, actionType: trigger.actionType, bonusGranted: granted, marketingConsent: customer.marketingConsent },
    });
    runs += 1;
  }

  return { runs, messages, bonusGranted };
}

/** Executes consent-based win-back scenarios for customers inactive for 30 days. */
export async function runSleepingCustomerAutomations(actor: { id: number; name: string; ip: string }) {
  await ensureSeed();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
  return db.transaction(async (tx) => {
    const customers = await tx
      .select({
        id: s.customers.id,
        firstName: s.customers.firstName,
        lastName: s.customers.lastName,
        username: s.customers.username,
        source: s.customers.source,
        isVip: s.customers.isVip,
        marketingConsent: s.customers.marketingConsent,
      })
      .from(s.customers)
      .where(and(lt(s.customers.lastActiveAt, cutoff), eq(s.customers.marketingConsent, true), sql`${s.customers.ordersCount} > 0`))
      .limit(1_000);

    const summary: AutomationResult = { runs: 0, messages: 0, bonusGranted: 0 };
    for (const customer of customers) {
      const result = await runCustomerAutomationEvent(tx, customer, "sleeping_customer");
      summary.runs += result.runs;
      summary.messages += result.messages;
      summary.bonusGranted += result.bonusGranted;
    }
    await tx.insert(s.activity).values({
      actorUserId: actor.id,
      actor: actor.name.slice(0, 120),
      action: "запустил автоматизацию возврата клиентов",
      entity: "Сценарий: неактивные 30 дней",
      entityType: "automation_run",
      eventType: "business",
      ip: actor.ip.slice(0, 80),
      metadata: { customers: customers.length, runs: summary.runs, messages: summary.messages },
    });
    return { ...summary, customers: customers.length, cutoff };
  });
}
