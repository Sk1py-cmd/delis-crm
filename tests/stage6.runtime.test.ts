import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const TEST_OWNER_LOGIN = "runtime-owner";
const TEST_OWNER_PASSWORD = randomBytes(24).toString("base64url");

function restoreEnvironment(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test("seeded PostgreSQL runtime honours consent, inventory, finance, and report invariants", { timeout: 60_000 }, async () => {
  let embedded: PGlite | undefined;
  let server: PGLiteSocketServer | undefined;
  const useExternalDatabase = process.env.RUN_EXTERNAL_DATABASE_TESTS === "true";
  let databaseUrl = useExternalDatabase ? process.env.TEST_DATABASE_URL : undefined;
  if (useExternalDatabase && !databaseUrl) throw new Error("RUN_EXTERNAL_DATABASE_TESTS requires TEST_DATABASE_URL");
  const previousEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    ownerLogin: process.env.OWNER_LOGIN,
    ownerPassword: process.env.OWNER_PASSWORD,
    seedDemoData: process.env.SEED_DEMO_DATA,
  };
  let closePool: (() => Promise<void>) | undefined;

  try {
    // Local runs use an embedded PostgreSQL-compatible engine. CI opts in explicitly
    // before this suite is permitted to mutate its disposable PostgreSQL service.
    if (!databaseUrl) {
      embedded = new PGlite();
      server = new PGLiteSocketServer({
        db: embedded,
        host: "127.0.0.1",
        port: 0,
        maxConnections: 16,
      });
      await server.start();
      databaseUrl = `postgresql://postgres@${server.getServerConn()}/postgres`;
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.OWNER_LOGIN = TEST_OWNER_LOGIN;
    process.env.OWNER_PASSWORD = TEST_OWNER_PASSWORD;
    process.env.SEED_DEMO_DATA = "true";

    // Import after configuring DATABASE_URL: application modules create their pool at import time.
    const { ensureSeed } = await import("@/db/seed");
    await ensureSeed();
    const { db, pool } = await import("@/db");
    closePool = () => pool.end();
    const s = await import("@/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    const {
      approveReturn,
      assignDelivery,
      completeDelivery,
      createMultiOrder,
      createReturn,
      getBroadcastData,
      getMarketingData,
      recordBroadcast,
    } = await import("@/server/queries");
    const { runCustomerAutomationEvent } = await import("@/server/automation");
    const { getOwnerReport, resolveReportRange } = await import("@/server/reports");

    const broadcastData = await getBroadcastData();
    const optedIn = broadcastData.customers.find((customer) => customer.marketingConsent);
    const optedOut = broadcastData.customers.find((customer) => !customer.marketingConsent);
    assert.ok(optedIn, "demo seed must contain a customer with explicit marketing consent");
    assert.ok(optedOut, "demo seed must contain a customer without marketing consent");

    await assert.rejects(
      recordBroadcast({
        title: "No consent",
        body: "This must never be queued.",
        recipientIds: [optedOut.id],
        channel: "telegram",
        actor: { id: 1, name: "Runtime check", ip: "127.0.0.1" },
      }),
      /Ни один выбранный клиент/,
    );

    const broadcast = await recordBroadcast({
      title: "Consent snapshot",
      body: "Queued, not delivered.",
      recipientIds: [optedIn.id, optedIn.id, optedOut.id, 999_999],
      channel: "telegram",
      actor: { id: 1, name: "Runtime check", ip: "127.0.0.1" },
    });
    assert.equal(broadcast.recipients, 1, "only a current opt-in may enter the immutable snapshot");
    assert.equal(broadcast.status, "queued");
    const recipientRows = await db
      .select()
      .from(s.broadcastRecipients)
      .where(eq(s.broadcastRecipients.broadcastId, broadcast.id));
    assert.deepEqual(recipientRows.map((row) => row.customerId), [optedIn.id]);
    assert.equal(recipientRows[0]?.status, "queued");

    await db
      .update(s.customers)
      .set({ marketingConsent: false, marketingConsentAt: null })
      .where(eq(s.customers.id, optedIn.id));
    const snapshotAfterOptOut = await db
      .select()
      .from(s.broadcastRecipients)
      .where(eq(s.broadcastRecipients.broadcastId, broadcast.id));
    assert.equal(snapshotAfterOptOut.length, 1, "a later consent change cannot rewrite a sent audience snapshot");

    const [optedOutCustomer] = await db.select().from(s.customers).where(eq(s.customers.id, optedOut.id));
    assert.ok(optedOutCustomer);
    const automationResult = await db.transaction((tx) =>
      runCustomerAutomationEvent(tx, optedOutCustomer, "sleeping_customer"),
    );
    assert.deepEqual(automationResult, { runs: 0, messages: 0, bonusGranted: 0 });

    // A CRM order reserves a merged SKU quantity, delivery fulfills it exactly once,
    // and an approved return restores that physical stock while retaining attribution.
    const [customerBefore] = await db.select().from(s.customers).where(eq(s.customers.id, optedOut.id));
    const [courier] = await db
      .insert(s.couriers)
      .values({ name: "Runtime courier", phone: "+998900000000", vehicle: "car", zone: "Tashkent" })
      .returning();
    const [warehouse] = await db
      .select()
      .from(s.warehouses)
      .where(and(eq(s.warehouses.isDefault, true), eq(s.warehouses.status, "active")))
      .limit(1);
    const [product] = await db
      .select()
      .from(s.products)
      .where(and(eq(s.products.status, "active"), sql`${s.products.stock} >= 3`))
      .limit(1);
    assert.ok(customerBefore, "demo seed must contain the selected customer");
    assert.ok(courier, "demo seed must contain a courier");
    assert.ok(warehouse, "demo seed must contain an active default warehouse");
    assert.ok(product, "demo seed must contain a sellable product with stock");
    const [balanceBefore] = await db
      .select()
      .from(s.warehouseStocks)
      .where(and(eq(s.warehouseStocks.warehouseId, warehouse.id), eq(s.warehouseStocks.productId, product.id)))
      .limit(1);
    assert.ok(balanceBefore, "demo seed must initialize warehouse stock balances");
    assert.ok(balanceBefore.onHand - balanceBefore.reserved >= 3, "selected SKU needs free stock");

    const order = await createMultiOrder(
      customerBefore.id,
      [{ productId: product.id, qty: 1 }, { productId: product.id, qty: 2 }],
      "Runtime check",
      1,
    );
    assert.equal(order.channel, "crm");
    assert.equal(order.status, "new");
    assert.equal(Number(order.total), Number(product.price) * 3);

    const orderItems = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, order.id));
    assert.equal(orderItems.length, 2, "the sales document retains submitted positions");
    assert.equal(orderItems.reduce((total, item) => total + item.qty, 0), 3);
    const reservations = await db.select().from(s.stockReservations).where(eq(s.stockReservations.orderId, order.id));
    assert.equal(reservations.length, 1, "inventory reservation merges duplicate SKU lines");
    assert.equal(reservations[0]?.qty, 3);
    assert.equal(reservations[0]?.status, "active");
    const [reservedBalance] = await db
      .select()
      .from(s.warehouseStocks)
      .where(and(eq(s.warehouseStocks.warehouseId, warehouse.id), eq(s.warehouseStocks.productId, product.id)))
      .limit(1);
    assert.equal(reservedBalance?.onHand, balanceBefore.onHand, "a reservation cannot consume physical stock");
    assert.equal(reservedBalance?.reserved, balanceBefore.reserved + 3);
    const [customerAfterOrder] = await db.select().from(s.customers).where(eq(s.customers.id, customerBefore.id));
    assert.equal(customerAfterOrder?.ordersCount, customerBefore.ordersCount + 1);
    assert.equal(Number(customerAfterOrder?.totalSpent), Number(customerBefore.totalSpent) + Number(product.price) * 3);

    const delivery = await assignDelivery({
      orderId: order.id,
      courierId: courier.id,
      address: "Runtime check address",
      city: "Tashkent",
      notes: "",
      actor: "Runtime check",
    });
    const deliveryResult = await completeDelivery(delivery.id, "Runtime check", 1);
    assert.deepEqual(deliveryResult, { ok: true, alreadyDelivered: false });
    const [fulfilledReservation] = await db.select().from(s.stockReservations).where(eq(s.stockReservations.id, reservations[0]!.id));
    assert.equal(fulfilledReservation?.status, "fulfilled");
    const [fulfilledBalance] = await db
      .select()
      .from(s.warehouseStocks)
      .where(and(eq(s.warehouseStocks.warehouseId, warehouse.id), eq(s.warehouseStocks.productId, product.id)))
      .limit(1);
    assert.equal(fulfilledBalance?.onHand, balanceBefore.onHand - 3);
    assert.equal(fulfilledBalance?.reserved, balanceBefore.reserved);
    const orderRevenue = await db
      .select()
      .from(s.transactions)
      .where(and(eq(s.transactions.referenceType, "order"), eq(s.transactions.referenceId, order.id)));
    assert.equal(orderRevenue.length, 1, "a completed delivery posts revenue once");
    assert.equal(orderRevenue[0]?.channel, "crm");
    assert.equal(orderRevenue[0]?.kind, "income");

    const createdReturn = await createReturn({
      orderId: order.id,
      reason: "Runtime check",
      notes: "Return lifecycle check",
      actor: "Runtime check",
      actorUserId: 1,
    });
    const approvedReturn = await approveReturn(createdReturn.id, true, "Runtime check", 1);
    assert.deepEqual(approvedReturn, { ok: true, restocked: 1 });
    const [releasedReservation] = await db.select().from(s.stockReservations).where(eq(s.stockReservations.id, reservations[0]!.id));
    assert.equal(releasedReservation?.status, "released");
    const [restockedBalance] = await db
      .select()
      .from(s.warehouseStocks)
      .where(and(eq(s.warehouseStocks.warehouseId, warehouse.id), eq(s.warehouseStocks.productId, product.id)))
      .limit(1);
    assert.equal(restockedBalance?.onHand, balanceBefore.onHand, "approved restock restores fulfilled physical stock");
    assert.equal(restockedBalance?.reserved, balanceBefore.reserved);
    const refundTransactions = await db
      .select()
      .from(s.transactions)
      .where(and(eq(s.transactions.referenceType, "return"), eq(s.transactions.referenceId, createdReturn.id)));
    assert.equal(refundTransactions.length, 1);
    assert.equal(refundTransactions[0]?.kind, "expense");
    assert.equal(refundTransactions[0]?.channel, "crm", "refund attribution must follow the source order");

    await db.insert(s.transactions).values({
      kind: "expense",
      category: "marketing",
      account: "bank",
      amount: "123456",
      channel: "facebook",
      actorName: "Runtime check",
      note: "Attribution runtime test",
    });
    const marketing = await getMarketingData();
    const facebookMarketing = marketing.adChannels.find((channel) => channel.key === "facebook");
    assert.equal(facebookMarketing?.spent, 123456, "marketing dashboard must retain a spend-only channel");

    const report = await getOwnerReport(resolveReportRange(undefined, undefined, new Date()));
    const facebookReport = report.channels.find((channel) => channel.channel === "facebook");
    assert.equal(facebookReport?.spent, 123456, "Owner report must retain a spend-only channel");
    assert.ok(report.range.from < report.range.toExclusive);

    const fixedRange = resolveReportRange("2026-08-30", "2026-08-31", new Date("2026-09-01T00:00:00.000Z"));
    assert.equal(fixedRange.from.toISOString(), "2026-08-29T19:00:00.000Z");
    assert.equal(fixedRange.toExclusive.toISOString(), "2026-08-31T19:00:00.000Z");
    const invalidRange = resolveReportRange("2026-02-30", "2026-02-30", new Date("2026-09-01T00:00:00.000Z"));
    assert.equal(invalidRange.toExclusive.getTime() - invalidRange.from.getTime(), 30 * 24 * 60 * 60 * 1_000);
  } finally {
    await closePool?.();
    await server?.stop();
    await embedded?.close();
    restoreEnvironment("DATABASE_URL", previousEnvironment.databaseUrl);
    restoreEnvironment("OWNER_LOGIN", previousEnvironment.ownerLogin);
    restoreEnvironment("OWNER_PASSWORD", previousEnvironment.ownerPassword);
    restoreEnvironment("SEED_DEMO_DATA", previousEnvironment.seedDemoData);
  }
});
