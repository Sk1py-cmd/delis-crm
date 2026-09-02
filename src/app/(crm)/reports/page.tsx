import { requireAccess } from "@/server/guard";
import { getOwnerReport, resolveReportRange } from "@/server/reports";
import { OwnerReportsClient } from "./OwnerReportsClient";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function OwnerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  // /reports is deliberately absent from every staff allow-list.
  await requireAccess("/reports");
  const params = await searchParams;
  const range = resolveReportRange(firstValue(params.from), firstValue(params.to));
  const report = await getOwnerReport(range);

  return (
    <OwnerReportsClient
      range={{ from: range.fromKey, to: range.toKey }}
      sales={{
        revenue: Number(report.sales.revenue),
        profit: Number(report.sales.profit),
        orders: Number(report.sales.orders),
        customers: Number(report.sales.customers),
        delivered: Number(report.sales.delivered),
      }}
      finance={{
        income: Number(report.finance.income),
        expense: Number(report.finance.expense),
        marketing: Number(report.finance.marketing),
      }}
      newCustomers={Number(report.newCustomers.count)}
      automation={{ runs: Number(report.automation.runs), queued: Number(report.automation.queued) }}
      returns={{ count: Number(report.returns.count), refunds: Number(report.returns.refunds) }}
      security={{ events: Number(report.security.events), warnings: Number(report.security.warnings) }}
      byDay={report.byDay.map((row) => ({
        day: row.day,
        revenue: Number(row.revenue),
        profit: Number(row.profit),
        orders: Number(row.orders),
      }))}
      channels={report.channels}
      unallocatedMarketingSpend={report.unallocatedMarketingSpend}
      byStatus={report.byStatus.map((row) => ({ status: row.status, count: Number(row.count) }))}
      topCustomers={report.topCustomers.map((row) => ({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        orders: Number(row.orders),
        revenue: Number(row.revenue),
      }))}
    />
  );
}
