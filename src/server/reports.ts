import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1_000;
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1_000;
const MAX_REPORT_DAYS = 366;

export interface ReportRange {
  from: Date;
  toExclusive: Date;
  fromKey: string;
  toKey: string;
}

function dateKey(date: Date) {
  return new Date(date.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) - TASHKENT_OFFSET_MS);
  return Number.isNaN(date.getTime()) || dateKey(date) !== value ? null : date;
}

/** Resolves a bounded inclusive date range; invalid URL values safely fall back to 30 days. */
export function resolveReportRange(rawFrom?: string, rawTo?: string, now = new Date()): ReportRange {
  const tashkentNow = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const today = new Date(Date.UTC(
    tashkentNow.getUTCFullYear(),
    tashkentNow.getUTCMonth(),
    tashkentNow.getUTCDate(),
  ) - TASHKENT_OFFSET_MS);
  const defaultTo = new Date(today.getTime() + DAY_MS);
  const defaultFrom = new Date(defaultTo.getTime() - 30 * DAY_MS);
  const from = parseDateKey(rawFrom) ?? defaultFrom;
  const requestedTo = parseDateKey(rawTo);
  const toExclusive = requestedTo ? new Date(requestedTo.getTime() + DAY_MS) : defaultTo;

  if (toExclusive <= from || toExclusive.getTime() - from.getTime() > MAX_REPORT_DAYS * DAY_MS) {
    return { from: defaultFrom, toExclusive: defaultTo, fromKey: dateKey(defaultFrom), toKey: dateKey(today) };
  }
  return { from, toExclusive, fromKey: dateKey(from), toKey: dateKey(new Date(toExclusive.getTime() - DAY_MS)) };
}

/** Owner-level, date-bounded operating report based only on durable CRM documents. */
export async function getOwnerReport(range: ReportRange) {
  await ensureSeed();
  const salesWhere = and(
    gte(s.orders.createdAt, range.from),
    lt(s.orders.createdAt, range.toExclusive),
    sql`${s.orders.status} not in ('cancelled', 'returned')`,
  );
  const financeWhere = and(gte(s.transactions.createdAt, range.from), lt(s.transactions.createdAt, range.toExclusive));

  const [
    [sales],
    [finance],
    [newCustomers],
    [automation],
    [returns],
    [security],
    byDay,
    byChannel,
    channelSpend,
    byStatus,
    topCustomers,
  ] = await Promise.all([
    db
      .select({
        revenue: sql<string>`coalesce(sum(${s.orders.total}), 0)`,
        profit: sql<string>`coalesce(sum(${s.orders.profit}), 0)`,
        orders: sql<string>`count(*)`,
        customers: sql<string>`count(distinct ${s.orders.customerId})`,
        delivered: sql<string>`count(*) filter (where ${s.orders.status} = 'delivered')`,
      })
      .from(s.orders)
      .where(salesWhere),
    db
      .select({
        income: sql<string>`coalesce(sum(${s.transactions.amount}) filter (where ${s.transactions.kind} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${s.transactions.amount}) filter (where ${s.transactions.kind} = 'expense'), 0)`,
        marketing: sql<string>`coalesce(sum(${s.transactions.amount}) filter (where ${s.transactions.kind} = 'expense' and ${s.transactions.category} = 'marketing'), 0)`,
      })
      .from(s.transactions)
      .where(financeWhere),
    db
      .select({ count: sql<string>`count(*)` })
      .from(s.customers)
      .where(and(gte(s.customers.createdAt, range.from), lt(s.customers.createdAt, range.toExclusive))),
    db
      .select({
        runs: sql<string>`count(*)`,
        queued: sql<string>`count(*) filter (where ${s.automationRuns.status} = 'queued')`,
      })
      .from(s.automationRuns)
      .where(and(gte(s.automationRuns.createdAt, range.from), lt(s.automationRuns.createdAt, range.toExclusive))),
    db
      .select({ count: sql<string>`count(*)`, refunds: sql<string>`coalesce(sum(${s.returns.refundAmount}), 0)` })
      .from(s.returns)
      .where(and(gte(s.returns.createdAt, range.from), lt(s.returns.createdAt, range.toExclusive))),
    db
      .select({
        events: sql<string>`count(*)`,
        warnings: sql<string>`count(*) filter (where ${s.activity.severity} in ('warning', 'critical'))`,
      })
      .from(s.activity)
      .where(and(
        gte(s.activity.createdAt, range.from),
        lt(s.activity.createdAt, range.toExclusive),
        sql`${s.activity.eventType} in ('security', 'auth')`,
      )),
    db
      .select({
        day: sql<string>`to_char(${s.orders.createdAt}, 'DD.MM')`,
        revenue: sql<string>`coalesce(sum(${s.orders.total}), 0)`,
        profit: sql<string>`coalesce(sum(${s.orders.profit}), 0)`,
        orders: sql<string>`count(*)`,
      })
      .from(s.orders)
      .where(salesWhere)
      .groupBy(sql`1, date_trunc('day', ${s.orders.createdAt})`)
      .orderBy(sql`date_trunc('day', ${s.orders.createdAt})`),
    db
      .select({
        channel: s.orders.channel,
        revenue: sql<string>`coalesce(sum(${s.orders.total}), 0)`,
        profit: sql<string>`coalesce(sum(${s.orders.profit}), 0)`,
        orders: sql<string>`count(*)`,
      })
      .from(s.orders)
      .where(salesWhere)
      .groupBy(s.orders.channel),
    db
      .select({ channel: s.transactions.channel, spent: sql<string>`coalesce(sum(${s.transactions.amount}), 0)` })
      .from(s.transactions)
      .where(and(
        financeWhere,
        eq(s.transactions.kind, "expense"),
        eq(s.transactions.category, "marketing"),
      ))
      .groupBy(s.transactions.channel),
    db
      .select({ status: s.orders.status, count: sql<string>`count(*)` })
      .from(s.orders)
      .where(and(gte(s.orders.createdAt, range.from), lt(s.orders.createdAt, range.toExclusive)))
      .groupBy(s.orders.status),
    db
      .select({
        id: s.customers.id,
        firstName: s.customers.firstName,
        lastName: s.customers.lastName,
        orders: sql<string>`count(*)`,
        revenue: sql<string>`coalesce(sum(${s.orders.total}), 0)`,
      })
      .from(s.orders)
      .innerJoin(s.customers, eq(s.orders.customerId, s.customers.id))
      .where(salesWhere)
      .groupBy(s.customers.id, s.customers.firstName, s.customers.lastName)
      .orderBy(sql`sum(${s.orders.total}) desc`)
      .limit(8),
  ]);

  const spendByChannel = new Map(channelSpend.map((row) => [row.channel, Number(row.spent)]));
  const salesByChannel = new Map(byChannel.map((row) => [row.channel, row]));
  const channelKeys = new Set([...salesByChannel.keys(), ...spendByChannel.keys()]);
  const channels = [...channelKeys]
    .map((channel) => {
      const sales = salesByChannel.get(channel);
      const revenue = Number(sales?.revenue ?? 0);
      const spent = spendByChannel.get(channel) ?? 0;
      return {
        channel,
        revenue,
        profit: Number(sales?.profit ?? 0),
        orders: Number(sales?.orders ?? 0),
        spent,
        roi: spent > 0 ? ((revenue - spent) / spent) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.spent - a.spent);

  return {
    range,
    sales,
    finance,
    newCustomers,
    automation,
    returns,
    security,
    byDay,
    channels,
    unallocatedMarketingSpend: spendByChannel.get("") ?? 0,
    byStatus,
    topCustomers,
  };
}
