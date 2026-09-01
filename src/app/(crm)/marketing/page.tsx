import { requireAccess } from "@/server/guard";
import { getMarketingData } from "@/server/queries";
import { MarketingClient } from "./MarketingClient";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const user = await requireAccess("/marketing");
  const data = await getMarketingData();

  return (
    <MarketingClient
      promos={data.promos.map((p) => ({
        id: p.id,
        code: p.code,
        discountType: p.discountType,
        discountValue: String(p.discountValue),
        minOrderAmount: String(p.minOrderAmount),
        maxUses: p.maxUses,
        usedCount: p.usedCount,
        status: p.status,
        validUntil: p.validUntil ? String(p.validUntil) : null,
        createdAt: String(p.createdAt),
      }))}
      triggers={data.triggers.map((t) => ({
        id: t.id,
        title: t.title,
        eventKey: t.eventKey,
        actionType: t.actionType,
        messageBody: t.messageBody,
        discountBonus: t.discountBonus,
        isActive: t.isActive,
        triggeredCount: t.triggeredCount,
      }))}
      campaigns={data.campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        channel: c.channel,
        recipients: c.recipients,
        delivered: c.delivered,
        status: c.status,
        createdAt: String(c.createdAt),
      }))}
      recentRuns={data.recentRuns.map((run) => ({
        id: run.id,
        eventKey: run.eventKey,
        actionType: run.actionType,
        status: run.status,
        createdAt: String(run.createdAt),
        triggerTitle: run.triggerTitle,
        customerName: `${run.customerFirstName} ${run.customerLastName}`.trim(),
        customerSource: run.customerSource,
      }))}
      adChannels={data.adChannels}
      totalSales={data.totalSales}
      ordersCount={data.ordersCount}
      canRunAutomations={user.role === "owner"}
    />
  );
}
