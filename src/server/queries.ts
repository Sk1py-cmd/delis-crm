import { db } from "@/db";
import * as s from "@/db/schema";
import { bootstrapWarehouseStocks, ensureSeed } from "@/db/seed";
import {
  InventoryError,
  type InventoryTx,
  initializeProductInventory,
  receiveReferencedInventory,
  reserveOrderInventory,
  resolveOrderInventoryReservations,
  restockFulfilledOrderInventory,
} from "@/server/inventory";
import { desc, eq, sql, and, gte, inArray } from "drizzle-orm";
import { runCustomerAutomationEvent, VIP_THRESHOLD } from "@/server/automation";
import { channelMeta } from "@/shared/config/channels";

export type Product = typeof s.products.$inferSelect;
export type Order = typeof s.orders.$inferSelect;
export type Customer = typeof s.customers.$inferSelect;
export type Agent = typeof s.agents.$inferSelect;
export type Message = typeof s.messages.$inferSelect;

export async function init() {
  await ensureSeed();
}

export async function getCompanyOS() {
  await init();
  const [counts] = await db
    .select({
      products: sql<string>`(select count(*) from products)`,
      orders: sql<string>`(select count(*) from orders)`,
      customers: sql<string>`(select count(*) from customers)`,
      agents: sql<string>`(select count(*) from agents)`,
      unread: sql<string>`(select count(*) from messages where from_admin = false and read_at is null)`,
      lowStock: sql<string>`(select count(*) from products where stock < low_stock)`,
      openOrders: sql<string>`(select count(*) from orders where status not in ('delivered','cancelled','returned'))`,
      todayRevenue: sql<string>`(select coalesce(sum(total),0) from orders where created_at >= current_date)`,
    })
    .from(sql`(select 1) t`);

  const sync = await db.select().from(s.syncEvents).orderBy(desc(s.syncEvents.createdAt)).limit(12);
  const modules = [
    { key: "crm", label: "CRM", status: "online", latency: 18, color: "#8b5cf6", items: Number(counts.orders) + Number(counts.customers) },
    { key: "telegram_bot", label: "Telegram Bot", status: "online", latency: 42, color: "#0ea5e9", items: Number(counts.unread) },
    { key: "miniapp", label: "Telegram Mini App", status: "online", latency: 36, color: "#3b82f6", items: Number(counts.products) },
    { key: "website", label: "Официальный сайт", status: "online", latency: 54, color: "#22c55e", items: Number(counts.products) },
    { key: "warehouse", label: "Склад", status: Number(counts.lowStock) > 0 ? "attention" : "online", latency: 24, color: "#f97316", items: Number(counts.lowStock) },
    { key: "finance", label: "Финансы", status: "online", latency: 29, color: "#14b8a6", items: Number(counts.todayRevenue) },
    { key: "agents", label: "Агенты продаж", status: "online", latency: 63, color: "#ec4899", items: Number(counts.agents) },
    { key: "marketing", label: "Маркетинг", status: "online", latency: 48, color: "#a855f7", items: 6 },
  ];
  return { counts, sync, modules };
}

export async function recordSyncEvent(input: {
  source?: string;
  target?: string;
  entity: string;
  action: string;
  status?: string;
  payload?: Record<string, string | number | boolean>;
}) {
  const [event] = await db
    .insert(s.syncEvents)
    .values({
      source: input.source ?? "crm",
      target: input.target ?? "all",
      entity: input.entity,
      action: input.action,
      status: input.status ?? "synced",
      payload: input.payload ?? {},
    })
    .returning();
  return event;
}

export async function syncEverything(actor: string) {
  await recordSyncEvent({
    source: "crm",
    target: "all",
    entity: "company_os",
    action: "manual_full_sync",
    payload: { actor, modules: 8 },
  });
  await db.insert(s.activity).values({ actor, action: "запустил полную синхронизацию Company OS", entity: "CRM · Bot · Mini App · Site · Warehouse · Finance" });
}

export async function getDashboard() {
  await init();
  const [totals] = await db
    .select({
      revenue: sql<string>`coalesce(sum(total),0)`,
      profit: sql<string>`coalesce(sum(profit),0)`,
      orders: sql<string>`count(*)`,
      avg: sql<string>`coalesce(avg(total),0)`,
      cancelled: sql<string>`count(*) filter (where status = 'cancelled')`,
      delivered: sql<string>`count(*) filter (where status = 'delivered')`,
      returned: sql<string>`count(*) filter (where status = 'returned')`,
    })
    .from(s.orders);

  const [counts] = await db
    .select({
      products: sql<string>`(select count(*) from products)`,
      customers: sql<string>`(select count(*) from customers)`,
      agents: sql<string>`(select count(*) from agents)`,
      stock: sql<string>`(select coalesce(sum(stock),0) from products)`,
      expenses: sql<string>`(select coalesce(sum(amount),0) from transactions where kind = 'expense')`,
      lowStock: sql<string>`(select count(*) from products where stock < low_stock)`,
    })
    .from(sql`(select 1) t`);

  const [todayVs] = await db
    .select({
      todayOrders: sql<string>`count(*) filter (where created_at >= current_date)`,
      todayRevenue: sql<string>`coalesce(sum(total) filter (where created_at >= current_date),0)`,
      yesterdayOrders: sql<string>`count(*) filter (where created_at >= current_date - interval '1 day' and created_at < current_date)`,
      yesterdayRevenue: sql<string>`coalesce(sum(total) filter (where created_at >= current_date - interval '1 day' and created_at < current_date),0)`,
    })
    .from(s.orders);

  const byDay = await db
    .select({
      day: sql<string>`to_char(created_at, 'DD.MM')`,
      revenue: sql<string>`sum(total)`,
      profit: sql<string>`sum(profit)`,
      orders: sql<string>`count(*)`,
    })
    .from(s.orders)
    .where(gte(s.orders.createdAt, sql`now() - interval '30 days'`))
    .groupBy(sql`1, date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);

  const byChannel = await db
    .select({ name: s.orders.channel, value: sql<string>`sum(total)` })
    .from(s.orders)
    .groupBy(s.orders.channel);

  const byStatus = await db
    .select({ name: s.orders.status, value: sql<string>`count(*)` })
    .from(s.orders)
    .groupBy(s.orders.status);

  const topProducts = await db
    .select()
    .from(s.products)
    .orderBy(desc(s.products.sold))
    .limit(6);

  const lowStock = await db
    .select()
    .from(s.products)
    .where(sql`stock < low_stock * 2`)
    .orderBy(s.products.stock)
    .limit(6);

  const recentOrders = await recentOrdersList(7);
  const recentCustomers = await db.select().from(s.customers).orderBy(desc(s.customers.createdAt)).limit(5);
  const recentMessages = await db
    .select({
      id: s.messages.id,
      body: s.messages.body,
      createdAt: s.messages.createdAt,
      fromAdmin: s.messages.fromAdmin,
      customer: sql<string>`c.first_name || ' ' || c.last_name`,
    })
    .from(s.messages)
    .innerJoin(sql`customers c`, sql`c.id = ${s.messages.customerId}`)
    .orderBy(desc(s.messages.createdAt))
    .limit(5);
  const acts = await db.select().from(s.activity).orderBy(desc(s.activity.createdAt)).limit(6);
  const agents = await db.select().from(s.agents).orderBy(desc(s.agents.fact)).limit(5);

  return { totals, counts, todayVs, byDay, byChannel, byStatus, topProducts, lowStock, recentOrders, recentCustomers, recentMessages, acts, agents };
}

export async function recentOrdersList(limit = 100) {
  return db
    .select({
      id: s.orders.id,
      number: s.orders.number,
      status: s.orders.status,
      total: s.orders.total,
      profit: s.orders.profit,
      channel: s.orders.channel,
      payment: s.orders.payment,
      createdAt: s.orders.createdAt,
      customerId: s.orders.customerId,
      customer: sql<string>`c.first_name || ' ' || c.last_name`,
      city: sql<string>`c.city`,
      agent: sql<string>`coalesce(a.name, '—')`,
    })
    .from(s.orders)
    .leftJoin(sql`customers c`, sql`c.id = ${s.orders.customerId}`)
    .leftJoin(sql`agents a`, sql`a.id = ${s.orders.agentId}`)
    .orderBy(desc(s.orders.createdAt))
    .limit(limit);
}

export type OrderRow = Awaited<ReturnType<typeof recentOrdersList>>[number];

export async function getOrdersLite() {
  await init();
  return recentOrdersList(12);
}

export async function getOrder(id: number) {
  await init();
  const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
  if (!order) return null;
  const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
  const customer = order.customerId
    ? (await db.select().from(s.customers).where(eq(s.customers.id, order.customerId)))[0]
    : undefined;
  return { order, items, customer };
}

export async function getCustomerOrders(customerId: number) {
  await init();
  return db
    .select()
    .from(s.orders)
    .where(eq(s.orders.customerId, customerId))
    .orderBy(s.orders.createdAt);
}

export async function getProduct(id: number) {
  await init();
  const rows = await db
    .select({
      id: s.products.id,
      name: s.products.name,
      slug: s.products.slug,
      sku: s.products.sku,
      barcode: s.products.barcode,
      description: s.products.description,
      brand: s.products.brand,
      country: s.products.country,
      volume: s.products.volume,
      weight: s.products.weight,
      price: s.products.price,
      cost: s.products.cost,
      vat: s.products.vat,
      discount: s.products.discount,
      stock: s.products.stock,
      lowStock: s.products.lowStock,
      image: s.products.image,
      images: s.products.images,
      color: s.products.color,
      isPopular: s.products.isPopular,
      isNew: s.products.isNew,
      isFeatured: s.products.isFeatured,
      status: s.products.status,
      sold: s.products.sold,
      categoryId: s.products.categoryId,
      category: sql<string>`coalesce(cat.name, 'Без категории')`,
    })
    .from(s.products)
    .leftJoin(sql`categories cat`, sql`cat.id = ${s.products.categoryId}`)
    .where(eq(s.products.id, id))
    .limit(1);

  const product = rows[0];
  if (!product) return null;

  const recentOrders = await db
    .select({
      id: s.orders.id,
      number: s.orders.number,
      status: s.orders.status,
      total: s.orders.total,
      qty: s.orderItems.qty,
      createdAt: s.orders.createdAt,
      customer: sql<string>`c.first_name || ' ' || c.last_name`,
    })
    .from(s.orderItems)
    .innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId))
    .leftJoin(sql`customers c`, sql`c.id = ${s.orders.customerId}`)
    .where(eq(s.orderItems.productId, id))
    .orderBy(desc(s.orders.createdAt))
    .limit(10);

  return { product, category: product.category, recentOrders };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export async function getProducts() {
  await init();
  return db
    .select({
      id: s.products.id,
      name: s.products.name,
      sku: s.products.sku,
      barcode: s.products.barcode,
      price: s.products.price,
      cost: s.products.cost,
      stock: s.products.stock,
      lowStock: s.products.lowStock,
      image: s.products.image,
      images: s.products.images,
      volume: s.products.volume,
      status: s.products.status,
      sold: s.products.sold,
      isNew: s.products.isNew,
      isPopular: s.products.isPopular,
      isFeatured: s.products.isFeatured,
      brand: s.products.brand,
      description: s.products.description,
      category: sql<string>`coalesce(cat.name, 'Без категории')`,
      categoryId: s.products.categoryId,
    })
    .from(s.products)
    .leftJoin(sql`categories cat`, sql`cat.id = ${s.products.categoryId}`)
    .orderBy(desc(s.products.sold));
}

export type ProductRow = Awaited<ReturnType<typeof getProducts>>[number];

export async function getCustomers() {
  await init();
  return db.select().from(s.customers).orderBy(desc(s.customers.totalSpent));
}

export async function getCustomer(id: number) {
  await init();
  const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, id));
  if (!customer) return null;
  const orders = await db.select().from(s.orders).where(eq(s.orders.customerId, id)).orderBy(desc(s.orders.createdAt));
  const msgs = await db.select().from(s.messages).where(eq(s.messages.customerId, id)).orderBy(s.messages.createdAt);
  return { customer, orders, msgs };
}

export async function getAgents() {
  await init();
  return db.select().from(s.agents).orderBy(desc(s.agents.fact));
}

export class AgentStoreOrderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AgentStoreOrderError";
  }
}

/**
 * Creates a B2B order independently from a GPS visit. The database transaction
 * makes an offline replay all-or-nothing: order rows, stock moves, agent fact and
 * activity cannot be committed only partially.
 */
export async function createAgentStoreOrder(input: {
  agentId: number;
  storeName: string;
  storeAddress: string;
  items: { productId: number; qty: number }[];
  notes: string;
  actor: string;
  actorUserId?: number | null;
  syncKey?: string | null;
}) {
  await init();
  const ids = input.items.map((item) => item.productId).filter(Boolean);
  if (!ids.length) throw new AgentStoreOrderError("Добавьте хотя бы одну позицию");

  const created = await db.transaction(async (tx) => {
    if (input.syncKey) {
      const [existing] = await tx.select().from(s.orders).where(eq(s.orders.syncKey, input.syncKey)).limit(1);
      if (existing) {
        if (existing.agentId !== input.agentId) throw new AgentStoreOrderError("Идентификатор офлайн-операции уже использован", 409);
        return { order: existing, duplicate: true, total: Number(existing.total) };
      }
    }

    const prods = await tx
      .select()
      .from(s.products)
      .where(inArray(s.products.id, [...new Set(ids)]));
    const productsById = new Map(prods.map((product) => [product.id, product]));
    if (productsById.size !== new Set(ids).size) {
      throw new AgentStoreOrderError("Один или несколько товаров не найдены");
    }

    let total = 0;
    let costTotal = 0;
    const rows: { productId: number; name: string; qty: number; price: string }[] = [];
    for (const item of input.items) {
      const product = productsById.get(item.productId);
      // The set-size validation above ensures this is always present.
      if (!product) continue;
      const qty = Math.max(1, item.qty);
      total += Number(product.price) * qty;
      costTotal += Number(product.cost) * qty;
      rows.push({ productId: product.id, name: product.name, qty, price: product.price });
    }

    const [count] = await tx.select({ count: sql<string>`count(*)` }).from(s.orders);
    const orderNumber = `DLS-${24000 + Number(count.count) + 1}`;
    const [order] = await tx
      .insert(s.orders)
      .values({
        number: orderNumber,
        agentId: input.agentId,
        status: "confirmed",
        channel: "agent",
        payment: "bank",
        syncKey: input.syncKey ?? null,
        total: String(total),
        profit: String(total - costTotal),
        comment: `B2B Торговая точка: ${input.storeName} (${input.storeAddress})`,
        timeline: [{ status: "confirmed", at: new Date().toISOString(), by: input.actor }],
      })
      .onConflictDoNothing()
      .returning();

    if (!order) {
      const [existing] = input.syncKey
        ? await tx.select().from(s.orders).where(eq(s.orders.syncKey, input.syncKey)).limit(1)
        : [];
      if (existing?.agentId === input.agentId) return { order: existing, duplicate: true, total: Number(existing.total) };
      if (existing) throw new AgentStoreOrderError("Идентификатор офлайн-операции уже использован", 409);
      throw new AgentStoreOrderError("Не удалось сохранить заказ", 500);
    }

    await tx.insert(s.orderItems).values(rows.map((row) => ({ ...row, orderId: order.id })));
    await reserveOrderInventory(tx, {
      orderId: order.id,
      items: rows.map(({ productId, qty }) => ({ productId, qty })),
      actor: { id: input.actorUserId ?? null, name: input.actor },
      reason: `B2B заказ агента ${orderNumber}`,
    });

    // A sales order is not a GPS-verified field visit. A separate real-location
    // check-in is required for visit counters and photo-report history.
    await tx
      .update(s.agents)
      .set({ fact: sql`${s.agents.fact} + ${total}` })
      .where(eq(s.agents.id, input.agentId));
    await tx.insert(s.activity).values({
      actorUserId: input.actorUserId ?? null,
      actor: input.actor,
      action: `оформил заказ от торговой точки «${input.storeName}»`,
      entity: `${orderNumber} на сумму ${total} сум`,
      entityType: "order",
      entityId: order.id,
      eventType: "business",
      metadata: { agentId: input.agentId, positions: rows.length, total },
    });

    return { order, duplicate: false, total };
  });

  if (!created.duplicate) {
    await recordSyncEvent({
      source: "crm",
      target: "all",
      entity: "agent_order",
      action: "agent_order_created",
      payload: { agentId: input.agentId, orderNumber: created.order.number, total: created.total },
    });
  }
  return created.order;
}

export async function getWarehouse() {
  await init();
  const products = await getProducts();
  const moves = await db
    .select({
      id: s.stockMoves.id,
      kind: s.stockMoves.kind,
      qty: s.stockMoves.qty,
      note: s.stockMoves.note,
      createdAt: s.stockMoves.createdAt,
      product: sql<string>`p.name`,
    })
    .from(s.stockMoves)
    .innerJoin(sql`products p`, sql`p.id = ${s.stockMoves.productId}`)
    .orderBy(desc(s.stockMoves.createdAt))
    .limit(40);
  return { products, moves };
}

export async function getFinance() {
  await init();
  const tx = await db.select().from(s.transactions).orderBy(desc(s.transactions.createdAt)).limit(60);
  const [agg] = await db
    .select({
      income: sql<string>`coalesce(sum(amount) filter (where kind='income'),0)`,
      expense: sql<string>`coalesce(sum(amount) filter (where kind='expense'),0)`,
    })
    .from(s.transactions);
  const byAccount = await db
    .select({ name: s.transactions.account, value: sql<string>`sum(amount)` })
    .from(s.transactions)
    .where(eq(s.transactions.kind, "income"))
    .groupBy(s.transactions.account);
  const byCategory = await db
    .select({ name: s.transactions.category, value: sql<string>`sum(amount)` })
    .from(s.transactions)
    .where(eq(s.transactions.kind, "expense"))
    .groupBy(s.transactions.category);
  const byDay = await db
    .select({
      day: sql<string>`to_char(created_at,'DD.MM')`,
      income: sql<string>`coalesce(sum(amount) filter (where kind='income'),0)`,
      expense: sql<string>`coalesce(sum(amount) filter (where kind='expense'),0)`,
    })
    .from(s.transactions)
    .groupBy(sql`1, date_trunc('day', created_at)`)
    .orderBy(sql`date_trunc('day', created_at)`);
  return { tx, agg, byAccount, byCategory, byDay };
}

export async function getAnalytics() {
  await init();
  const dash = await getDashboard();
  const byCity = await db
    .select({ name: s.customers.city, value: sql<string>`coalesce(sum(o.total),0)` })
    .from(s.customers)
    .leftJoin(sql`orders o`, sql`o.customer_id = ${s.customers.id}`)
    .groupBy(s.customers.city);
  const bySource = await db
    .select({ name: s.customers.source, value: sql<string>`count(*)` })
    .from(s.customers)
    .groupBy(s.customers.source);
  const topCustomers = await db.select().from(s.customers).orderBy(desc(s.customers.totalSpent)).limit(6);
  return { ...dash, byCity, bySource, topCustomers };
}

export async function getChatThreads() {
  await init();
  return db
    .select({
      id: s.customers.id,
      name: sql<string>`${s.customers.firstName} || ' ' || ${s.customers.lastName}`,
      username: s.customers.username,
      city: s.customers.city,
      isVip: s.customers.isVip,
      source: s.customers.source,
      last: sql<string>`(select body from messages m where m.customer_id = ${s.customers.id} order by created_at desc limit 1)`,
      lastAt: sql<string>`(select created_at from messages m where m.customer_id = ${s.customers.id} order by created_at desc limit 1)`,
      unread: sql<string>`(select count(*) from messages m where m.customer_id = ${s.customers.id} and m.from_admin = false and m.read_at is null)`,
    })
    .from(s.customers)
    .orderBy(desc(sql`(select created_at from messages m where m.customer_id = ${s.customers.id} order by created_at desc limit 1)`));
}

export type ChatThread = Awaited<ReturnType<typeof getChatThreads>>[number];

export async function getMessages(customerId: number) {
  await init();
  return db.select().from(s.messages).where(eq(s.messages.customerId, customerId)).orderBy(s.messages.createdAt);
}

export async function getTemplates() {
  await init();
  return db.select().from(s.templates);
}

export async function getBroadcastData() {
  await init();
  const customers = await db
    .select({
      id: s.customers.id,
      firstName: s.customers.firstName,
      lastName: s.customers.lastName,
      username: s.customers.username,
      city: s.customers.city,
      source: s.customers.source,
      isVip: s.customers.isVip,
      bonus: s.customers.bonus,
      marketingConsent: s.customers.marketingConsent,
      ordersCount: s.customers.ordersCount,
      totalSpent: s.customers.totalSpent,
      lastActiveAt: s.customers.lastActiveAt,
    })
    .from(s.customers);
  const templates = await getTemplates();
  const history = await db
    .select()
    .from(s.broadcasts)
    .orderBy(desc(s.broadcasts.sentAt))
    .limit(8);
  return { customers, templates, history };
}

export type BroadcastCustomer = Awaited<ReturnType<typeof getBroadcastData>>["customers"][number];

export async function recordBroadcast(data: {
  title: string;
  body: string;
  recipientIds: number[];
  channel: "telegram" | "miniapp" | "all";
  status?: "scheduled" | "queued";
  scheduledAt?: Date | null;
  actor: { id: number; name: string; ip: string };
}) {
  const recipientIds = [...new Set(data.recipientIds)].filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 5_000);
  if (!recipientIds.length) throw new Error("Выберите хотя бы одного клиента с согласием на маркетинг");

  return db.transaction(async (tx) => {
    const recipients = await tx
      .select({ id: s.customers.id })
      .from(s.customers)
      .where(and(inArray(s.customers.id, recipientIds), eq(s.customers.marketingConsent, true)));
    if (!recipients.length) throw new Error("Ни один выбранный клиент не подтвердил согласие на маркетинг");

    const [broadcast] = await tx
      .insert(s.broadcasts)
      .values({
        title: data.title.slice(0, 120),
        body: data.body.slice(0, 8_000),
        recipients: recipients.length,
        channel: data.channel,
        status: data.status ?? "queued",
        scheduledAt: data.scheduledAt ?? null,
        createdBy: data.actor.name.slice(0, 160),
        sentAt: new Date(),
      })
      .returning();
    if (!broadcast) throw new Error("Не удалось создать рассылку");

    await tx.insert(s.broadcastRecipients).values(recipients.map((recipient) => ({
      broadcastId: broadcast.id,
      customerId: recipient.id,
      channel: data.channel,
      status: data.status === "scheduled" ? "scheduled" : "queued",
    })));
    await tx.insert(s.activity).values({
      actorUserId: data.actor.id,
      actor: data.actor.name.slice(0, 120),
      action: "создал рассылку с согласием клиентов",
      entity: `${broadcast.title} · ${recipients.length} получателей`,
      entityType: "broadcast",
      entityId: broadcast.id,
      eventType: "business",
      ip: data.actor.ip.slice(0, 80),
      metadata: { recipients: recipients.length, channel: data.channel, status: broadcast.status },
    });
    await tx.insert(s.syncEvents).values({
      source: "crm",
      target: data.channel === "all" ? "marketing" : data.channel,
      entity: "broadcast",
      action: data.status === "scheduled" ? "broadcast_scheduled" : "broadcast_queued",
      payload: { broadcastId: broadcast.id, recipients: recipients.length },
    });
    return broadcast;
  });
}

/** Deliberately excludes credential hashes and all 2FA fields from user-list callers. */
export async function getUsers() {
  await init();
  return db
    .select({
      id: s.users.id,
      name: s.users.name,
      login: s.users.login,
      email: s.users.email,
      role: s.users.role,
      status: s.users.status,
      lastIp: s.users.lastIp,
      device: s.users.device,
      agentId: s.users.agentId,
      lastLoginAt: s.users.lastLoginAt,
    })
    .from(s.users);
}

export async function getActivity() {
  await init();
  return db.select().from(s.activity).orderBy(desc(s.activity.createdAt)).limit(30);
}

export async function getContent(surface: string) {
  await init();
  return db.select().from(s.contentBlocks).where(eq(s.contentBlocks.surface, surface));
}

export async function search(q: string) {
  await init();
  const like = `%${q}%`;
  const [prods, ords, custs, ags] = await Promise.all([
    db.select().from(s.products).where(sql`name ilike ${like} or sku ilike ${like} or barcode ilike ${like}`).limit(5),
    db
      .select()
      .from(s.orders)
      .where(sql`number ilike ${like} or status ilike ${like}`)
      .limit(5),
    db
      .select()
      .from(s.customers)
      .where(sql`first_name ilike ${like} or last_name ilike ${like} or username ilike ${like} or phone ilike ${like}`)
      .limit(5),
    db.select().from(s.agents).where(sql`name ilike ${like} or region ilike ${like}`).limit(4),
  ]);
  return [
    ...prods.map((p) => ({ type: "Товар", title: p.name, subtitle: `${p.sku} · остаток ${p.stock}`, href: `/products?id=${p.id}` })),
    ...ords.map((o) => ({ type: "Заказ", title: o.number, subtitle: `${o.status} · ${o.total} сум`, href: `/orders/${o.id}` })),
    ...custs.map((c) => ({
      type: "Клиент",
      title: `${c.firstName} ${c.lastName}`,
      subtitle: `@${c.username} · ${c.phone}`,
      href: `/customers/${c.id}`,
    })),
    ...ags.map((a) => ({ type: "Агент", title: a.name, subtitle: a.region, href: `/agents` })),
  ];
}

function settlementAccount(payment: string) {
  return ["cash", "click", "payme", "uzum", "bank"].includes(payment) ? payment : "click";
}

/** Creates one finance income record for a fulfilled order, never a duplicate. */
async function recordOrderRevenue(tx: InventoryTx, order: Order, actor: { id?: number | null; name: string }) {
  const [existing] = await tx
    .select({ id: s.transactions.id })
    .from(s.transactions)
    .where(and(
      eq(s.transactions.referenceType, "order"),
      eq(s.transactions.referenceId, order.id),
      eq(s.transactions.kind, "income"),
    ))
    .limit(1);
  if (existing) return false;
  await tx.insert(s.transactions).values({
    kind: "income",
    category: "sales",
    account: settlementAccount(order.payment),
    amount: order.total,
    referenceType: "order",
    referenceId: order.id,
    channel: order.channel,
    actorUserId: actor.id ?? null,
    actorName: actor.name.slice(0, 160),
    note: `Выручка по заказу ${order.number}`,
  });
  return true;
}

export async function setOrderStatus(id: number, status: string, by = "Отабек Delis", actorUserId?: number | null) {
  await init();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select ${s.orders.id} from ${s.orders} where ${s.orders.id} = ${id} for update`);
    const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, id)).limit(1);
    if (!order) return null;
    if (order.status === status) return { order, changed: false };

    const timeline = [...order.timeline, { status, at: new Date().toISOString(), by }];
    const [updated] = await tx.update(s.orders).set({ status, timeline }).where(eq(s.orders.id, id)).returning();
    if (!updated) throw new Error("Не удалось обновить заказ");
    if (status === "cancelled" || status === "returned") {
      await resolveOrderInventoryReservations(tx, {
        orderId: order.id,
        resolution: "released",
        actor: { id: actorUserId ?? null, name: by },
        note: `Снятие резерва: заказ ${order.number} (${status})`,
      });
    } else if (status === "shipped" || status === "delivered") {
      await resolveOrderInventoryReservations(tx, {
        orderId: order.id,
        resolution: "fulfilled",
        actor: { id: actorUserId ?? null, name: by },
        note: `Отгрузка заказа ${order.number}`,
      });
      await recordOrderRevenue(tx, updated, { id: actorUserId ?? null, name: by });
    }
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor: by,
      action: `изменил статус на «${status}»`,
      entity: order.number,
      entityType: "order",
      entityId: order.id,
      eventType: "business",
      severity: status === "cancelled" || status === "returned" ? "warning" : "info",
      metadata: { status },
    });
    return { order: updated, changed: true };
  });
  if (!result) return null;
  if (result.changed) {
    await recordSyncEvent({ source: "crm", target: "telegram_bot", entity: "order", action: "order_status_changed", payload: { order: result.order.number, status } });
    await recordSyncEvent({ source: "crm", target: "miniapp", entity: "order", action: "customer_order_updated", payload: { order: result.order.number, status } });
  }
  return result.order;
}

export async function addMessage(customerId: number, body: string, fromAdmin = true, kind = "text") {
  const [m] = await db.insert(s.messages).values({ customerId, body, fromAdmin, kind }).returning();
  await recordSyncEvent({ source: fromAdmin ? "crm" : "telegram_bot", target: fromAdmin ? "telegram_bot" : "crm", entity: "message", action: fromAdmin ? "message_sent" : "message_received", payload: { customerId, kind } });
  return m;
}

export async function upsertProduct(data: Partial<Product> & { id?: number }) {
  await init();
  const { id, stock: requestedStock, ...rest } = data;
  if (id) {
    // Product data remains editable here, but an aggregate stock value is no
    // longer a safe write once stock can live in multiple warehouses.
    const [p] = await db.update(s.products).set(rest).where(eq(s.products.id, id)).returning();
    if (!p) throw new Error("Товар не найден");
    await recordSyncEvent({ source: "crm", target: "site", entity: "product", action: "product_updated", payload: { productId: id, sku: p.sku } });
    await recordSyncEvent({ source: "crm", target: "miniapp", entity: "product", action: "catalog_updated", payload: { productId: id, sku: p.sku } });
    return p;
  }

  const p = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(s.products)
      .values({
        name: rest.name ?? "Новый товар",
        slug: (rest.name ?? "new-product").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        sku: rest.sku ?? `DLS-${Math.floor(Math.random() * 9000 + 1000)}`,
        ...rest,
        stock: typeof requestedStock === "number" && Number.isSafeInteger(requestedStock) && requestedStock >= 0 ? requestedStock : 0,
      })
      .returning();
    if (!created) throw new Error("Не удалось создать товар");
    await initializeProductInventory(tx, created.id);
    return created;
  });
  await recordSyncEvent({ source: "crm", target: "site", entity: "product", action: "product_created", payload: { productId: p.id, sku: p.sku } });
  await recordSyncEvent({ source: "crm", target: "miniapp", entity: "product", action: "catalog_updated", payload: { productId: p.id, sku: p.sku } });
  return p;
}

/** Ledger-backed goods cannot be physically deleted; hide them from active catalogues instead. */
export async function deleteProduct(id: number) {
  await init();
  const [product] = await db
    .update(s.products)
    .set({ status: "inactive" })
    .where(eq(s.products.id, id))
    .returning();
  if (!product) throw new Error("Товар не найден");
  await recordSyncEvent({ source: "crm", target: "site", entity: "product", action: "product_archived", payload: { productId: id, sku: product.sku } });
  await recordSyncEvent({ source: "crm", target: "miniapp", entity: "product", action: "catalog_updated", payload: { productId: id, sku: product.sku } });
  return product;
}

/**
 * Legacy callers must migrate to the inventory API. Keeping an explicit error
 * here is safer than silently mutating products.stock without warehouse data.
 */
export async function adjustStock(_productId: number, _kind: string, _qty: number, _note: string): Promise<never> {
  throw new InventoryError("Используйте складские операции с выбранным складом");
}

export async function createOrderQuick(
  customerId: number,
  productId: number,
  qty: number,
  payment = "click",
  actor = "CRM",
  actorUserId?: number | null,
) {
  await init();
  if (!Number.isSafeInteger(customerId) || customerId < 1) throw new Error("Клиент не найден");
  if (!Number.isSafeInteger(productId) || productId < 1) throw new Error("Товар не найден");
  if (!Number.isSafeInteger(qty) || qty < 1) throw new Error("Некорректное количество");

  const created = await db.transaction(async (tx) => {
    const [customer] = await tx.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    const [product] = await tx.select().from(s.products).where(eq(s.products.id, productId)).limit(1);
    const [count] = await tx.select({ c: sql<string>`count(*)` }).from(s.orders);
    if (!customer) throw new Error("Клиент не найден");
    if (!product) throw new Error("Товар не найден");

    const total = Number(product.price) * qty;
    const [order] = await tx
      .insert(s.orders)
      .values({
        number: `DLS-${24000 + Number(count.c) + 1}`,
        customerId,
        status: "new",
        channel: "crm",
        payment,
        total: String(total),
        profit: String(total - Number(product.cost) * qty),
        timeline: [{ status: "new", at: new Date().toISOString(), by: actor }],
      })
      .returning();
    if (!order) throw new Error("Не удалось создать заказ");

    await tx.insert(s.orderItems).values({ orderId: order.id, productId, name: product.name, qty, price: product.price });
    await reserveOrderInventory(tx, {
      orderId: order.id,
      items: [{ productId, qty }],
      actor: { id: actorUserId ?? null, name: actor },
      reason: `Резерв под заказ ${order.number}`,
    });
    await tx.update(s.products).set({ sold: sql`${s.products.sold} + ${qty}` }).where(eq(s.products.id, productId));
    await tx
      .update(s.customers)
      .set({
        ordersCount: sql`${s.customers.ordersCount} + 1`,
        totalSpent: sql`${s.customers.totalSpent} + ${total}`,
        lastActiveAt: new Date(),
      })
      .where(eq(s.customers.id, customerId));
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor,
      action: "создал заказ и резерв",
      entity: order.number,
      entityType: "order",
      entityId: order.id,
      eventType: "business",
      metadata: { positions: 1, total },
    });
    if (!customer.isVip && Number(customer.totalSpent) + total >= VIP_THRESHOLD) {
      await runCustomerAutomationEvent(tx, customer, "vip_threshold");
    }
    await tx.insert(s.syncEvents).values([
      { source: "crm", target: "telegram_bot", entity: "order", action: "order_created", payload: { order: order.number, customerId } },
      { source: "crm", target: "finance", entity: "order", action: "revenue_planned", payload: { order: order.number, total } },
    ]);
    return { order, productName: product.name };
  });

  await notifyOwnerAboutOrder(created.order.number, String(created.order.total), payment, created.productName);
  return created.order;
}

export async function createMultiOrder(
  customerId: number,
  items: { productId: number; qty: number }[],
  actor = "CRM",
  actorUserId?: number | null,
) {
  await init();
  if (!Number.isSafeInteger(customerId) || customerId < 1) throw new Error("Клиент не найден");
  if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");
  for (const item of items) {
    if (!Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.qty) || item.qty < 1) {
      throw new Error("Некорректные позиции заказа");
    }
  }

  return db.transaction(async (tx) => {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const [customer] = await tx.select().from(s.customers).where(eq(s.customers.id, customerId)).limit(1);
    const products = await tx.select().from(s.products).where(inArray(s.products.id, productIds));
    const [count] = await tx.select({ c: sql<string>`count(*)` }).from(s.orders);
    if (!customer) throw new Error("Клиент не найден");
    if (products.length !== productIds.length) throw new Error("Один или несколько товаров не найдены");

    const productsById = new Map(products.map((product) => [product.id, product]));
    const qtyByProduct = new Map<number, number>();
    let total = 0;
    let costTotal = 0;
    const orderItems: { productId: number; name: string; qty: number; price: string }[] = [];
    for (const item of items) {
      const product = productsById.get(item.productId)!;
      total += Number(product.price) * item.qty;
      costTotal += Number(product.cost) * item.qty;
      orderItems.push({ productId: product.id, name: product.name, qty: item.qty, price: product.price });
      qtyByProduct.set(product.id, (qtyByProduct.get(product.id) ?? 0) + item.qty);
    }

    const [order] = await tx
      .insert(s.orders)
      .values({
        number: `DLS-${24000 + Number(count.c) + 1}`,
        customerId,
        status: "new",
        channel: "crm",
        total: String(total),
        profit: String(total - costTotal),
        timeline: [{ status: "new", at: new Date().toISOString(), by: actor }],
      })
      .returning();
    if (!order) throw new Error("Не удалось создать заказ");

    await tx.insert(s.orderItems).values(orderItems.map((item) => ({ ...item, orderId: order.id })));
    await reserveOrderInventory(tx, {
      orderId: order.id,
      items: [...qtyByProduct].map(([productId, qty]) => ({ productId, qty })),
      actor: { id: actorUserId ?? null, name: actor },
      reason: `Резерв под заказ ${order.number}`,
    });
    for (const [productId, orderedQty] of qtyByProduct) {
      await tx.update(s.products).set({ sold: sql`${s.products.sold} + ${orderedQty}` }).where(eq(s.products.id, productId));
    }
    await tx
      .update(s.customers)
      .set({
        ordersCount: sql`${s.customers.ordersCount} + 1`,
        totalSpent: sql`${s.customers.totalSpent} + ${total}`,
        lastActiveAt: new Date(),
      })
      .where(eq(s.customers.id, customerId));
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor,
      action: "создал заказ и резерв",
      entity: order.number,
      entityType: "order",
      entityId: order.id,
      eventType: "business",
      metadata: { positions: items.length, total },
    });
    if (!customer.isVip && Number(customer.totalSpent) + total >= VIP_THRESHOLD) {
      await runCustomerAutomationEvent(tx, customer, "vip_threshold");
    }
    await tx.insert(s.syncEvents).values([
      { source: "crm", target: "telegram_bot", entity: "order", action: "order_created", payload: { order: order.number, customerId, items: items.length } },
      { source: "crm", target: "finance", entity: "order", action: "revenue_planned", payload: { order: order.number, total } },
    ]);
    return order;
  });
}

export async function markThreadRead(customerId: number) {
  await db
    .update(s.messages)
    .set({ readAt: new Date() })
    .where(and(eq(s.messages.customerId, customerId), eq(s.messages.fromAdmin, false)));
}

// ── Returns ──
export async function getReturnsData() {
  await init();
  const rows = await db
    .select({
      id: s.returns.id, orderId: s.returns.orderId, reason: s.returns.reason,
      status: s.returns.status, refundAmount: s.returns.refundAmount,
      restockItems: s.returns.restockItems, notes: s.returns.notes,
      createdBy: s.returns.createdBy, createdAt: s.returns.createdAt,
      orderNumber: sql<string>`o.number`,
      customerName: sql<string>`coalesce(c.first_name || ' ' || c.last_name, '—')`,
    })
    .from(s.returns)
    .leftJoin(sql`orders o`, sql`o.id = ${s.returns.orderId}`)
    .leftJoin(sql`customers c`, sql`c.id = ${s.returns.customerId}`)
    .orderBy(desc(s.returns.createdAt))
    .limit(40);
  return rows;
}

export async function createReturn(input: { orderId: number; reason: string; notes: string; actor: string; actorUserId?: number | null }) {
  await init();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${s.orders.id} from ${s.orders} where ${s.orders.id} = ${input.orderId} for update`);
    const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, input.orderId)).limit(1);
    if (!order) throw new Error("Заказ не найден");
    if (order.status === "cancelled") throw new Error("Нельзя оформить возврат для отменённого заказа");
    const [existingReturn] = await tx
      .select({ id: s.returns.id })
      .from(s.returns)
      .where(eq(s.returns.orderId, input.orderId))
      .limit(1);
    if (existingReturn) throw new Error("Возврат по этому заказу уже оформлен");

    const [ret] = await tx
      .insert(s.returns)
      .values({
        orderId: input.orderId,
        customerId: order.customerId,
        reason: input.reason,
        refundAmount: order.total,
        notes: input.notes,
        createdBy: input.actor,
      })
      .returning();
    if (!ret) throw new Error("Не удалось оформить возврат");

    const timeline = [...order.timeline, { status: "returned", at: new Date().toISOString(), by: input.actor }];
    await tx.update(s.orders).set({ status: "returned", timeline }).where(eq(s.orders.id, input.orderId));
    await resolveOrderInventoryReservations(tx, {
      orderId: order.id,
      resolution: "released",
      actor: { id: input.actorUserId ?? null, name: input.actor },
      note: `Снятие резерва: возврат ${order.number}`,
    });
    await tx.insert(s.activity).values({
      actorUserId: input.actorUserId ?? null,
      actor: input.actor,
      action: "оформил возврат",
      entity: order.number,
      entityType: "return",
      entityId: ret.id,
      eventType: "business",
      severity: "warning",
      metadata: { orderId: order.id },
    });
    await tx.insert(s.syncEvents).values({
      source: "crm",
      target: "finance",
      entity: "return",
      action: "return_created",
      payload: { order: order.number },
    });
    return ret;
  });
}

export async function approveReturn(id: number, restock: boolean, actor: string, actorUserId?: number | null) {
  await init();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${s.returns.id} from ${s.returns} where ${s.returns.id} = ${id} for update`);
    const [ret] = await tx.select().from(s.returns).where(eq(s.returns.id, id)).limit(1);
    if (!ret) throw new Error("Возврат не найден");
    if (ret.status === "refunded") throw new Error("Этот возврат уже обработан");

    const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, ret.orderId)).limit(1);
    if (!order) throw new Error("Заказ возврата не найден");
    const items = await tx.select().from(s.orderItems).where(eq(s.orderItems.orderId, ret.orderId));
    await tx.update(s.returns).set({ status: "refunded", restockItems: restock }).where(eq(s.returns.id, id));

    let restocked = 0;
    if (restock) {
      const [reservation] = await tx
        .select({ id: s.stockReservations.id })
        .from(s.stockReservations)
        .where(eq(s.stockReservations.orderId, ret.orderId))
        .limit(1);
      if (reservation) {
        const result = await restockFulfilledOrderInventory(tx, {
          orderId: ret.orderId,
          returnId: ret.id,
          actor: { id: actorUserId ?? null, name: actor },
          note: `Возврат заказа ${order.number}`,
        });
        restocked = result.restocked;
      } else if (items.length) {
        // Orders created before multi-warehouse accounting had no reservation.
        const result = await receiveReferencedInventory(tx, {
          items: items.map((item) => ({ productId: item.productId, qty: item.qty })),
          actor: { id: actorUserId ?? null, name: actor },
          referenceType: "return",
          referenceId: ret.id,
          note: `Возврат архивного заказа ${order.number}`,
        });
        restocked = result.items;
      }
    }

    await tx.insert(s.transactions).values({
      kind: "expense",
      category: "logistics",
      account: "click",
      amount: ret.refundAmount,
      referenceType: "return",
      referenceId: ret.id,
      channel: order.channel,
      actorUserId: actorUserId ?? null,
      actorName: actor.slice(0, 160),
      note: `Возврат по заказу #${ret.orderId}`,
    });
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor,
      action: `одобрил возврат${restock ? " с возвратом на склад" : ""}`,
      entity: `#${ret.orderId}`,
      entityType: "return",
      entityId: ret.id,
      eventType: "business",
      severity: "warning",
      metadata: { orderId: ret.orderId, restock, restocked },
    });
    return { ok: true, restocked };
  });
}

// ── Delivery ──
export async function getDeliveryData() {
  await init();
  const [couriersAll, deliveriesAll] = await Promise.all([
    db.select().from(s.couriers).orderBy(s.couriers.name),
    db.select({
      id: s.deliveries.id, orderId: s.deliveries.orderId, courierId: s.deliveries.courierId,
      status: s.deliveries.status, address: s.deliveries.address, city: s.deliveries.city,
      scheduledAt: s.deliveries.scheduledAt, deliveredAt: s.deliveries.deliveredAt,
      notes: s.deliveries.notes, createdAt: s.deliveries.createdAt,
      orderNumber: sql<string>`o.number`, orderTotal: sql<string>`o.total`,
      customerName: sql<string>`coalesce(c.first_name || ' ' || c.last_name, '—')`,
      courierName: sql<string>`coalesce(cr.name, '—')`,
    })
    .from(s.deliveries)
    .leftJoin(sql`orders o`, sql`o.id = ${s.deliveries.orderId}`)
    .leftJoin(sql`customers c`, sql`c.id = o.customer_id`)
    .leftJoin(sql`couriers cr`, sql`cr.id = ${s.deliveries.courierId}`)
    .orderBy(desc(s.deliveries.createdAt))
    .limit(50),
  ]);
  return { couriers: couriersAll, deliveries: deliveriesAll };
}

export async function addCourier(input: { name: string; phone: string; vehicle: string; zone: string; actor: string }) {
  const colors = ["#3b82f6", "#8b5cf6", "#22c55e", "#f97316", "#ec4899", "#14b8a6"];
  const [c] = await db.insert(s.couriers).values({ ...input, avatarColor: colors[Math.floor(Math.random() * colors.length)] }).returning();
  await db.insert(s.activity).values({ actor: input.actor, action: "добавил курьера", entity: c.name });
  return c;
}

export async function assignDelivery(input: { orderId: number; courierId: number; address: string; city: string; notes: string; actor: string }) {
  const [d] = await db.insert(s.deliveries).values({
    orderId: input.orderId, courierId: input.courierId,
    status: "assigned", address: input.address, city: input.city, notes: input.notes,
    scheduledAt: new Date(Date.now() + 4 * 3600_000),
  }).returning();
  await db.update(s.couriers).set({ status: "busy", activeDeliveries: sql`active_deliveries + 1` }).where(eq(s.couriers.id, input.courierId));
  await db.update(s.orders).set({ status: "courier" }).where(eq(s.orders.id, input.orderId));
  await db.insert(s.activity).values({ actor: input.actor, action: "назначил доставку курьеру", entity: `Заказ #${input.orderId}` });
  await recordSyncEvent({ source: "crm", target: "telegram_bot", entity: "delivery", action: "delivery_assigned", payload: { orderId: input.orderId } });
  return d;
}

export async function completeDelivery(id: number, actor: string, actorUserId?: number | null) {
  await init();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${s.deliveries.id} from ${s.deliveries} where ${s.deliveries.id} = ${id} for update`);
    const [delivery] = await tx.select().from(s.deliveries).where(eq(s.deliveries.id, id)).limit(1);
    if (!delivery) throw new Error("Доставка не найдена");
    if (delivery.status === "delivered") return { ok: true, alreadyDelivered: true };

    await tx.update(s.deliveries).set({ status: "delivered", deliveredAt: new Date() }).where(eq(s.deliveries.id, id));
    if (delivery.courierId) {
      await tx
        .update(s.couriers)
        .set({
          activeDeliveries: sql`greatest(0, ${s.couriers.activeDeliveries} - 1)`,
          completedToday: sql`${s.couriers.completedToday} + 1`,
          status: "available",
        })
        .where(eq(s.couriers.id, delivery.courierId));
    }
    await tx.execute(sql`select ${s.orders.id} from ${s.orders} where ${s.orders.id} = ${delivery.orderId} for update`);
    const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, delivery.orderId)).limit(1);
    if (order && order.status !== "delivered") {
      const timeline = [...order.timeline, { status: "delivered", at: new Date().toISOString(), by: actor }];
      await tx.update(s.orders).set({ status: "delivered", timeline }).where(eq(s.orders.id, order.id));
      await resolveOrderInventoryReservations(tx, {
        orderId: order.id,
        resolution: "fulfilled",
        actor: { id: actorUserId ?? null, name: actor },
        note: `Отгрузка по доставке заказа ${order.number}`,
      });
      await recordOrderRevenue(tx, order, { id: actorUserId ?? null, name: actor });
    }
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor,
      action: "подтвердил доставку",
      entity: `Заказ #${delivery.orderId}`,
      entityType: "delivery",
      entityId: delivery.id,
      eventType: "business",
      metadata: { orderId: delivery.orderId },
    });
    return { ok: true, alreadyDelivered: false };
  });
}

export async function getProcurementData() {
  await init();
  const [suppliers, orders] = await Promise.all([
    db.select().from(s.suppliers).orderBy(desc(s.suppliers.totalPurchased)),
    db
      .select({
        id: s.purchaseOrders.id,
        number: s.purchaseOrders.number,
        supplierId: s.purchaseOrders.supplierId,
        warehouseId: s.purchaseOrders.warehouseId,
        status: s.purchaseOrders.status,
        total: s.purchaseOrders.total,
        paid: s.purchaseOrders.paid,
        expectedAt: s.purchaseOrders.expectedAt,
        receivedAt: s.purchaseOrders.receivedAt,
        notes: s.purchaseOrders.notes,
        createdAt: s.purchaseOrders.createdAt,
        supplierName: sql<string>`sup.name`,
        warehouseName: s.warehouses.name,
      })
      .from(s.purchaseOrders)
      .leftJoin(sql`suppliers sup`, sql`sup.id = ${s.purchaseOrders.supplierId}`)
      .leftJoin(s.warehouses, eq(s.purchaseOrders.warehouseId, s.warehouses.id))
      .orderBy(desc(s.purchaseOrders.createdAt))
      .limit(40),
  ]);

  const lowStock = await db
    .select({
      id: s.products.id,
      name: s.products.name,
      sku: s.products.sku,
      stock: s.products.stock,
      lowStock: s.products.lowStock,
      cost: s.products.cost,
    })
    .from(s.products)
    .where(sql`stock < low_stock`)
    .orderBy(s.products.stock)
    .limit(12);

  return { suppliers, orders, lowStock };
}

export async function createSupplier(input: {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  city: string;
  category: string;
  leadTimeDays: number;
  actor: string;
}) {
  const [sup] = await db
    .insert(s.suppliers)
    .values({
      name: input.name,
      contactPerson: input.contactPerson,
      phone: input.phone,
      email: input.email,
      city: input.city,
      category: input.category,
      leadTimeDays: input.leadTimeDays,
    })
    .returning();
  await db.insert(s.activity).values({ actor: input.actor, action: "добавил поставщика", entity: sup.name });
  await recordSyncEvent({ source: "crm", target: "warehouse", entity: "supplier", action: "supplier_created", payload: { name: sup.name } });
  return sup;
}

export async function createPurchaseOrder(input: {
  supplierId: number;
  items: { productId: number; qty: number }[];
  notes: string;
  actor: string;
  actorUserId?: number | null;
  warehouseId?: number | null;
}) {
  await init();
  if (!Number.isSafeInteger(input.supplierId) || input.supplierId < 1) throw new Error("Поставщик не найден");
  if (input.warehouseId !== undefined && input.warehouseId !== null && (!Number.isSafeInteger(input.warehouseId) || input.warehouseId < 1)) {
    throw new InventoryError("Некорректный склад для закупки");
  }
  if (!input.items.length || input.items.length > 1_000) throw new Error("Добавьте от 1 до 1000 позиций");
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.productId) || item.productId < 1 || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 100_000) {
      throw new Error("Некорректные позиции закупки");
    }
  }

  return db.transaction(async (tx) => {
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const [supplier] = await tx.select().from(s.suppliers).where(eq(s.suppliers.id, input.supplierId)).limit(1);
    const products = await tx.select().from(s.products).where(inArray(s.products.id, productIds));
    const [targetWarehouse] = input.warehouseId
      ? await tx.select().from(s.warehouses).where(and(eq(s.warehouses.id, input.warehouseId), eq(s.warehouses.status, "active"))).limit(1)
      : [];
    const [count] = await tx.select({ c: sql<string>`count(*)` }).from(s.purchaseOrders);
    if (!supplier) throw new Error("Поставщик не найден");
    if (products.length !== productIds.length) throw new Error("Один или несколько товаров не найдены");
    if (input.warehouseId && !targetWarehouse) throw new InventoryError("Склад для закупки не найден или неактивен", 404);

    const productsById = new Map(products.map((product) => [product.id, product]));
    let total = 0;
    const rows: { productId: number; name: string; qty: number; price: string }[] = [];
    for (const item of input.items) {
      const product = productsById.get(item.productId)!;
      total += Number(product.cost) * item.qty;
      rows.push({ productId: product.id, name: product.name, qty: item.qty, price: product.cost });
    }
    const [po] = await tx
      .insert(s.purchaseOrders)
      .values({
        number: `PO-${1200 + Number(count.c) + 1}`,
        supplierId: input.supplierId,
        warehouseId: targetWarehouse?.id ?? null,
        status: "sent",
        total: String(total),
        expectedAt: new Date(Date.now() + supplier.leadTimeDays * 86400000),
        notes: input.notes.slice(0, 2_000),
        createdBy: input.actor.slice(0, 160),
      })
      .returning();
    if (!po) throw new Error("Не удалось создать закупку");
    await tx.insert(s.purchaseItems).values(rows.map((row) => ({ ...row, purchaseOrderId: po.id })));
    await tx.insert(s.activity).values({
      actorUserId: input.actorUserId ?? null,
      actor: input.actor,
      action: `создал закупку у «${supplier.name}»`,
      entity: `${po.number} · ${rows.length} позиций`,
      entityType: "purchase_order",
      entityId: po.id,
      eventType: "business",
      metadata: { supplierId: supplier.id, warehouseId: targetWarehouse?.id ?? null, positions: rows.length, total },
    });
    await tx.insert(s.syncEvents).values({
      source: "crm",
      target: "warehouse",
      entity: "purchase_order",
      action: "purchase_created",
      payload: {
        number: po.number,
        total,
        ...(targetWarehouse ? { warehouseId: targetWarehouse.id } : {}),
      },
    });
    return po;
  });
}

export async function receivePurchaseOrder(id: number, actor: string, actorUserId?: number | null) {
  await init();
  return db.transaction(async (tx) => {
    // The document lock makes a repeated click or concurrent request idempotent.
    await tx.execute(sql`select ${s.purchaseOrders.id} from ${s.purchaseOrders} where ${s.purchaseOrders.id} = ${id} for update`);
    const [po] = await tx.select().from(s.purchaseOrders).where(eq(s.purchaseOrders.id, id)).limit(1);
    if (!po) throw new Error("Закупка не найдена");
    if (po.status === "received") throw new Error("Эта партия уже принята на склад");
    if (po.status === "cancelled") throw new Error("Нельзя принять отменённую закупку");
    const items = await tx.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseOrderId, id));
    if (!items.length) throw new Error("В закупке нет позиций для приёмки");

    const received = await receiveReferencedInventory(tx, {
      items: items.map((item) => ({ productId: item.productId, qty: item.qty })),
      actor: { id: actorUserId ?? null, name: actor },
      referenceType: "purchase_order",
      referenceId: po.id,
      warehouseId: po.warehouseId ?? undefined,
      note: `Приход по закупке ${po.number}`,
    });
    await tx
      .update(s.purchaseOrders)
      .set({ status: "received", receivedAt: new Date(), paid: po.total })
      .where(eq(s.purchaseOrders.id, id));
    await tx
      .update(s.suppliers)
      .set({ totalPurchased: sql`${s.suppliers.totalPurchased} + ${po.total}` })
      .where(eq(s.suppliers.id, po.supplierId));
    await tx.insert(s.transactions).values({
      kind: "expense",
      category: "production",
      account: "bank",
      amount: po.total,
      referenceType: "purchase_order",
      referenceId: po.id,
      actorUserId: actorUserId ?? null,
      actorName: actor.slice(0, 160),
      note: `Оплата закупки ${po.number}`,
    });
    await tx.insert(s.activity).values({
      actorUserId: actorUserId ?? null,
      actor,
      action: "принял партию на склад",
      entity: `${po.number} · ${items.length} позиций`,
      entityType: "purchase_order",
      entityId: po.id,
      eventType: "business",
      metadata: { warehouseId: received.warehouseId, positions: received.items, total: Number(po.total) },
    });
    await tx.insert(s.syncEvents).values({
      source: "warehouse",
      target: "crm",
      entity: "purchase_order",
      action: "purchase_received",
      payload: { number: po.number, items: received.items, warehouseId: received.warehouseId },
    });
    return { ok: true, items: received.items, warehouseId: received.warehouseId };
  });
}

export async function getMarketingData() {
  await init();
  const [promos, triggers, campaigns, recentRuns] = await Promise.all([
    db.select().from(s.promocodes).orderBy(desc(s.promocodes.createdAt)),
    db.select().from(s.marketingTriggers).orderBy(s.marketingTriggers.id),
    db.select().from(s.campaigns).orderBy(desc(s.campaigns.createdAt)).limit(8),
    db
      .select({
        id: s.automationRuns.id,
        eventKey: s.automationRuns.eventKey,
        actionType: s.automationRuns.actionType,
        status: s.automationRuns.status,
        createdAt: s.automationRuns.createdAt,
        triggerTitle: s.marketingTriggers.title,
        customerFirstName: s.customers.firstName,
        customerLastName: s.customers.lastName,
        customerSource: s.customers.source,
      })
      .from(s.automationRuns)
      .innerJoin(s.marketingTriggers, eq(s.automationRuns.triggerId, s.marketingTriggers.id))
      .innerJoin(s.customers, eq(s.automationRuns.customerId, s.customers.id))
      .orderBy(desc(s.automationRuns.createdAt))
      .limit(12),
  ]);

  const [ordersAgg] = await db
    .select({
      totalSales: sql<string>`coalesce(sum(total),0)`,
      ordersCount: sql<string>`count(*)`,
    })
    .from(s.orders)
    .where(sql`${s.orders.status} not in ('cancelled', 'returned')`);

  // Attribution is derived from real orders, customer sources, and finance entries.
  // Marketing expenses without a selected channel are deliberately shown as unallocated.
  const [ordersByChannel, leadsByChannel, spendByChannel] = await Promise.all([
    db
      .select({
        channel: s.orders.channel,
        revenue: sql<string>`coalesce(sum(${s.orders.total}), 0)`,
        profit: sql<string>`coalesce(sum(${s.orders.profit}), 0)`,
        orders: sql<string>`count(*)`,
      })
      .from(s.orders)
      .where(sql`${s.orders.status} not in ('cancelled', 'returned')`)
      .groupBy(s.orders.channel),
    db
      .select({ channel: s.customers.source, leads: sql<string>`count(*)` })
      .from(s.customers)
      .groupBy(s.customers.source),
    db
      .select({ channel: s.transactions.channel, spent: sql<string>`coalesce(sum(${s.transactions.amount}), 0)` })
      .from(s.transactions)
      .where(and(eq(s.transactions.kind, "expense"), eq(s.transactions.category, "marketing")))
      .groupBy(s.transactions.channel),
  ]);
  const channelKeys = new Set<string>([
    ...ordersByChannel.map((row) => row.channel),
    ...leadsByChannel.map((row) => row.channel),
    ...spendByChannel.map((row) => row.channel),
  ]);
  const ordersByKey = new Map(ordersByChannel.map((row) => [row.channel, row]));
  const leadsByKey = new Map(leadsByChannel.map((row) => [row.channel, Number(row.leads)]));
  const spendByKey = new Map(spendByChannel.map((row) => [row.channel, Number(row.spent)]));
  const adChannels = [...channelKeys]
    .map((channel) => {
      const order = ordersByKey.get(channel);
      const revenue = Number(order?.revenue ?? 0);
      const spent = spendByKey.get(channel) ?? 0;
      const leads = leadsByKey.get(channel) ?? 0;
      const meta = channelMeta(channel);
      return {
        key: channel,
        name: meta.label,
        color: meta.color,
        revenue,
        profit: Number(order?.profit ?? 0),
        spent,
        leads,
        orders: Number(order?.orders ?? 0),
        conversion: leads > 0 ? (Number(order?.orders ?? 0) / leads) * 100 : null,
        roi: spent > 0 ? ((revenue - spent) / spent) * 100 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.spent - a.spent);

  return {
    promos,
    triggers,
    campaigns,
    recentRuns,
    adChannels,
    totalSales: Number(ordersAgg.totalSales),
    ordersCount: Number(ordersAgg.ordersCount),
  };
}

export async function createPromocode(input: {
  code: string;
  discountType: string;
  discountValue: number;
  minOrderAmount: number;
  maxUses: number;
  validUntil?: Date | null;
  actor: string;
}) {
  const [promo] = await db
    .insert(s.promocodes)
    .values({
      code: input.code.toUpperCase().trim(),
      discountType: input.discountType,
      discountValue: String(input.discountValue),
      minOrderAmount: String(input.minOrderAmount),
      maxUses: input.maxUses,
      validUntil: input.validUntil ?? null,
    })
    .returning();

  await db.insert(s.activity).values({
    actor: input.actor,
    action: `создал промокод «${promo.code}»`,
    entity: `Скидка ${promo.discountType === "percent" ? `${promo.discountValue}%` : `${promo.discountValue} сум`}`,
  });

  await recordSyncEvent({
    source: "crm",
    target: "all",
    entity: "promocode",
    action: "promocode_created",
    payload: { code: promo.code, discountValue: Number(promo.discountValue) },
  });

  return promo;
}

// ═══ ИНТЕГРАЦИИ ═══
export async function getIntegrations() {
  await init();
  return db.select().from(s.integrations).orderBy(s.integrations.id);
}

export async function saveIntegration(input: {
  key: string;
  credentials: Record<string, string>;
  enabled: boolean;
  actor: string;
}) {
  const hasCreds = Object.values(input.credentials).some((v) => v && v.trim().length > 0);
  const [i] = await db
    .update(s.integrations)
    .set({
      credentials: input.credentials,
      enabled: input.enabled && hasCreds,
      status: hasCreds ? "connected" : "not_configured",
      lastCheckAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(s.integrations.key, input.key))
    .returning();

  await db.insert(s.activity).values({
    actor: input.actor,
    action: `${input.enabled ? "подключил" : "отключил"} интеграцию`,
    entity: i?.title ?? input.key,
  });
  await recordSyncEvent({ source: "crm", target: input.key, entity: "integration", action: "integration_updated", payload: { key: input.key, enabled: input.enabled } });
  return i;
}

export async function testTelegramBot(token: string) {
  if (!token.trim()) return { ok: false, error: "Токен пустой" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { ok?: boolean; result?: { username?: string; first_name?: string }; description?: string };
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username ?? "", name: data.result.first_name ?? "" };
    }
    return { ok: false, error: data.description ?? "Неверный токен" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ошибка соединения с Telegram" };
  }
}

export async function sendTelegramMessage(chatId: string, text: string) {
  const [tg] = await db.select().from(s.integrations).where(eq(s.integrations.key, "telegram_bot"));
  const token = tg?.credentials?.token;
  if (!tg?.enabled || !token) return { ok: false, error: "Telegram Bot не подключён в настройках" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.description ?? "Ошибка отправки" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ошибка сети" };
  }
}

// ═══ ПУБЛИКАЦИЯ КОНТЕНТА ═══
export async function publishSurface(target: string, actor: string) {
  await db.update(s.contentBlocks).set({ enabled: true, updatedAt: new Date() }).where(eq(s.contentBlocks.surface, target === "miniapp" ? "miniapp" : "site"));
  await db.insert(s.activity).values({ actor, action: `опубликовал изменения`, entity: target === "miniapp" ? "Telegram Mini App" : "Сайт delis.uz" });
  await recordSyncEvent({ source: "crm", target, entity: "content", action: "content_published", payload: { target } });
  return { ok: true };
}

export async function saveSeoSettings(seo: Record<string, string>, actor: string) {
  for (const [key, value] of Object.entries(seo)) {
    const existing = await db.select().from(s.contentBlocks).where(and(eq(s.contentBlocks.surface, "seo"), eq(s.contentBlocks.key, key))).limit(1);
    if (existing.length > 0) {
      await db.update(s.contentBlocks).set({ body: value, updatedAt: new Date() }).where(eq(s.contentBlocks.id, existing[0].id));
    } else {
      await db.insert(s.contentBlocks).values({ surface: "seo", key, title: key, body: value });
    }
  }
  await db.insert(s.activity).values({ actor, action: "обновил SEO-настройки сайта", entity: "delis.uz" });
  await recordSyncEvent({ source: "crm", target: "site", entity: "seo", action: "seo_updated", payload: {} });
  return { ok: true };
}

export async function createInstagramPost(input: {
  type: string; caption: string; mediaUrls: string[]; scheduledAt: string; actor: string;
}) {
  const [post] = await db.insert(s.contentBlocks).values({
    surface: "instagram",
    key: `post_${Date.now()}`,
    title: input.caption.slice(0, 60),
    body: JSON.stringify({ type: input.type, caption: input.caption, media: input.mediaUrls, scheduledAt: input.scheduledAt }),
    enabled: !input.scheduledAt,
  }).returning();

  await db.insert(s.activity).values({
    actor: input.actor,
    action: input.scheduledAt ? "запланировал публикацию в Instagram" : "опубликовал в Instagram",
    entity: `${input.type} · ${input.mediaUrls.length} медиа`,
  });
  await recordSyncEvent({ source: "crm", target: "instagram", entity: "post", action: "post_created", payload: { type: input.type, media: input.mediaUrls.length } });
  return post;
}

export async function saveMiniAppBanners(banners: string[], actor: string) {
  const existing = await db.select().from(s.contentBlocks).where(and(eq(s.contentBlocks.surface, "miniapp"), eq(s.contentBlocks.key, "banners"))).limit(1);
  const body = JSON.stringify(banners);
  if (existing.length > 0) {
    await db.update(s.contentBlocks).set({ body, updatedAt: new Date() }).where(eq(s.contentBlocks.id, existing[0].id));
  } else {
    await db.insert(s.contentBlocks).values({ surface: "miniapp", key: "banners", title: "Баннеры Mini App", body });
  }
  await db.insert(s.activity).values({ actor, action: `загрузил ${banners.length} баннеров в Mini App`, entity: "Telegram Mini App" });
  await recordSyncEvent({ source: "crm", target: "miniapp", entity: "banner", action: "banners_updated", payload: { count: banners.length } });
  return { ok: true };
}

// ═══ БАЗА ЗНАНИЙ ═══

// Уведомление владельца о новом заказе в Telegram
async function notifyOwnerAboutOrder(orderNumber: string, total: string, payment: string, productName: string) {
  const [tg] = await db.select().from(s.integrations).where(eq(s.integrations.key, "telegram_bot")).limit(1);
  const [tgConfig] = await db.select().from(s.contentBlocks).where(and(eq(s.contentBlocks.surface, "telegram"), eq(s.contentBlocks.key, "notifications"))).limit(1);

  let chatId: string | undefined;
  if (tgConfig && tgConfig.body) {
    try { chatId = JSON.parse(tgConfig.body).ownerChatId; } catch { /* ignore */ }
  }
  if (!chatId) chatId = tg?.credentials?.ownerChatId;
  if (!chatId) return; // Telegram не настроен — молча пропускаем

  const token = tg?.credentials?.token;
  if (!token) return;

  const paymentNames: Record<string, string> = { cash: "💵 Наличные", click: "🔵 Click", payme: "🟢 Payme", uzum: "🟣 Uzum", bank: "🏦 Банк", crm: "💻 CRM" };

  const text = `🔔 <b>Новый заказ ${orderNumber}</b>\n\n💰 Сумма: ${Number(total).toLocaleString("ru-RU")} сум\n💳 Оплата: ${paymentNames[payment] ?? payment}\n📦 Товар: ${productName}\n\n<a href="https://delis.uz/orders">Открыть в CRM</a>`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* ignore notification errors */
  }
}
export async function getKnowledgeBase() {
  await init();
  return db.select().from(s.knowledgeBase).orderBy(desc(s.knowledgeBase.isPinned), desc(s.knowledgeBase.views));
}

export async function saveArticle(input: {
  id?: number; title: string; category: string; content: string; icon: string; isPinned: boolean; actor: string;
}) {
  if (input.id) {
    const [a] = await db.update(s.knowledgeBase)
      .set({ title: input.title, category: input.category, content: input.content, icon: input.icon, isPinned: input.isPinned, updatedAt: new Date() })
      .where(eq(s.knowledgeBase.id, input.id)).returning();
    return a;
  }
  const [a] = await db.insert(s.knowledgeBase).values({
    title: input.title, category: input.category, content: input.content,
    icon: input.icon, isPinned: input.isPinned, createdBy: input.actor,
  }).returning();
  await db.insert(s.activity).values({ actor: input.actor, action: "добавил статью в базу знаний", entity: input.title });
  return a;
}

export async function deleteArticle(id: number) {
  await db.delete(s.knowledgeBase).where(eq(s.knowledgeBase.id, id));
  return { ok: true };
}

// ═══ P&L ОТЧЁТ ═══
export async function getPnLReport() {
  await init();

  const byCategory = await db
    .select({
      category: sql<string>`coalesce(cat.name, 'Без категории')`,
      revenue: sql<string>`coalesce(sum(oi.qty * oi.price), 0)`,
      cost: sql<string>`coalesce(sum(oi.qty * p.cost), 0)`,
      units: sql<string>`coalesce(sum(oi.qty), 0)`,
    })
    .from(sql`order_items oi`)
    .innerJoin(sql`products p`, sql`p.id = oi.product_id`)
    .leftJoin(sql`categories cat`, sql`cat.id = p.category_id`)
    .innerJoin(sql`orders o`, sql`o.id = oi.order_id`)
    .where(sql`o.status not in ('cancelled','returned')`)
    .groupBy(sql`cat.name`);

  const byChannel = await db
    .select({
      channel: s.orders.channel,
      revenue: sql<string>`coalesce(sum(total),0)`,
      profit: sql<string>`coalesce(sum(profit),0)`,
      orders: sql<string>`count(*)`,
    })
    .from(s.orders)
    .where(sql`status not in ('cancelled','returned')`)
    .groupBy(s.orders.channel);

  const byMonth = await db
    .select({
      month: sql<string>`to_char(created_at, 'MM.YYYY')`,
      revenue: sql<string>`coalesce(sum(total),0)`,
      profit: sql<string>`coalesce(sum(profit),0)`,
    })
    .from(s.orders)
    .where(sql`status not in ('cancelled','returned')`)
    .groupBy(sql`1, date_trunc('month', created_at)`)
    .orderBy(sql`date_trunc('month', created_at)`);

  const [expenses] = await db
    .select({
      total: sql<string>`coalesce(sum(amount),0)`,
      logistics: sql<string>`coalesce(sum(amount) filter (where category='logistics'),0)`,
      marketing: sql<string>`coalesce(sum(amount) filter (where category='marketing'),0)`,
      salary: sql<string>`coalesce(sum(amount) filter (where category='salary'),0)`,
      production: sql<string>`coalesce(sum(amount) filter (where category='production'),0)`,
      rent: sql<string>`coalesce(sum(amount) filter (where category='rent'),0)`,
    })
    .from(s.transactions)
    .where(eq(s.transactions.kind, "expense"));

  const topProducts = await db
    .select({
      name: s.products.name,
      revenue: sql<string>`coalesce(sum(oi.qty * oi.price),0)`,
      profit: sql<string>`coalesce(sum(oi.qty * (oi.price - p2.cost)),0)`,
      units: sql<string>`coalesce(sum(oi.qty),0)`,
    })
    .from(s.products)
    .innerJoin(sql`order_items oi`, sql`oi.product_id = ${s.products.id}`)
    .innerJoin(sql`products p2`, sql`p2.id = ${s.products.id}`)
    .groupBy(s.products.name)
    .orderBy(sql`sum(oi.qty * (oi.price - p2.cost)) desc`)
    .limit(10);

  return { byCategory, byChannel, byMonth, expenses, topProducts };
}

// ═══ СБРОС ДЕМО-ДАННЫХ ═══
export async function resetDemoData(actor: string, keepSettings = true) {
  await db.execute(sql`
    truncate table order_items, orders, messages, agent_messages, agent_route_stops, agent_routes, agent_visits,
      warehouse_stocks, stock_reservations, inventory_count_lines, inventory_counts,
      stock_moves, purchase_items, purchase_orders, returns, deliveries,
      transactions, campaigns, broadcasts, broadcast_recipients, automation_runs, sync_events, activity, tasks
    restart identity cascade
  `);
  await bootstrapWarehouseStocks();
  await db.execute(sql`update customers set orders_count = 0, total_spent = 0`);
  await db.execute(sql`update agents set fact = 0, visits = 0`);
  await db.execute(sql`update products set sold = 0`);
  await db.execute(sql`update couriers set active_deliveries = 0, completed_today = 0`);
  await db.execute(sql`update suppliers set total_purchased = 0`);
  if (!keepSettings) {
    await db.execute(sql`update integrations set enabled = false, credentials = '{}'::jsonb, status = 'not_configured'`);
  }
  await db.insert(s.activity).values({ actor, action: "очистил демо-данные системы", entity: "Полный сброс операций" });
  return { ok: true };
}

export async function getAgentMessages(agentId: number) {
  await init();
  return db.select().from(s.agentMessages).where(eq(s.agentMessages.agentId, agentId)).orderBy(s.agentMessages.createdAt).limit(50);
}

export async function sendAgentMessage(agentId: number, body: string, fromAdmin = true) {
  const [m] = await db.insert(s.agentMessages).values({ agentId, body, fromAdmin }).returning();
  await recordSyncEvent({ source: fromAdmin ? "crm" : "agent", target: fromAdmin ? "agent" : "crm", entity: "agent_message", action: "message_sent", payload: { agentId } });
  return m;
}

export async function toggleMarketingTrigger(id: number, isActive: boolean, actor: string) {
  const [trig] = await db
    .update(s.marketingTriggers)
    .set({ isActive })
    .where(eq(s.marketingTriggers.id, id))
    .returning();

  if (trig) {
    await db.insert(s.activity).values({
      actor,
      action: `${isActive ? "включил" : "выключил"} маркетинг-триггер`,
      entity: trig.title,
    });
    await recordSyncEvent({
      source: "crm",
      target: "telegram_bot",
      entity: "marketing_trigger",
      action: "trigger_status_changed",
      payload: { id, isActive },
    });
  }
  return trig;
}
