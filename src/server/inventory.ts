import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import type { SessionUser } from "@/server/auth";
import { safeAuditMetadata, type AuditMetadata } from "@/server/audit";
import {
  MAX_INVENTORY_NOTE_LENGTH,
  MAX_INVENTORY_QTY,
  canManageWarehouses,
  canOperateInventory,
} from "@/shared/config/inventory";

export class InventoryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "InventoryError";
  }
}

type Input = Record<string, unknown>;
export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type InventoryActor = { id?: number | null; name: string };
export type InventoryLine = { productId: number; qty: number };
type StockAdjustmentKind = "receipt" | "issue" | "writeoff" | "adjustment_gain" | "adjustment_loss";

function positiveId(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InventoryError(`Некорректный ${label}`);
  }
  return value;
}

function quantity(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_INVENTORY_QTY) {
    throw new InventoryError(`Количество должно быть целым числом от 1 до ${MAX_INVENTORY_QTY}`);
  }
  return value;
}

function text(value: unknown, max = MAX_INVENTORY_NOTE_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function assertInventoryOperator(actor: SessionUser) {
  if (!canOperateInventory(actor.role)) throw new InventoryError("Недостаточно прав для складских операций", 403);
}

function assertWarehouseManager(actor: SessionUser) {
  if (!canManageWarehouses(actor.role)) throw new InventoryError("Создавать склады может только руководитель", 403);
}

async function syncProductAvailability(tx: InventoryTx, productId: number) {
  const [aggregate] = await tx
    .select({ available: sql<string>`coalesce(sum(${s.warehouseStocks.onHand} - ${s.warehouseStocks.reserved}), 0)` })
    .from(s.warehouseStocks)
    .where(eq(s.warehouseStocks.productId, productId));
  const available = Math.max(0, Number(aggregate?.available ?? 0));
  await tx.update(s.products).set({ stock: available }).where(eq(s.products.id, productId));
  return available;
}

/**
 * Creates a missing balance row. The old aggregate stock is imported only into
 * the default warehouse; a newly created satellite location begins at zero.
 */
async function ensureBalance(
  tx: InventoryTx,
  warehouseId: number,
  productId: number,
  isDefaultWarehouse: boolean,
  legacyStock: number,
) {
  await tx
    .insert(s.warehouseStocks)
    .values({
      warehouseId,
      productId,
      onHand: isDefaultWarehouse ? legacyStock : 0,
      reserved: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  const [balance] = await tx
    .select()
    .from(s.warehouseStocks)
    .where(and(eq(s.warehouseStocks.warehouseId, warehouseId), eq(s.warehouseStocks.productId, productId)))
    .limit(1);
  if (!balance) throw new InventoryError("Не удалось подготовить остаток склада", 500);
  return balance;
}

/** Serializes stock mutations for a SKU, including mutations on different warehouses. */
async function lockProducts(tx: InventoryTx, productIds: number[]) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  await tx.execute(sql`
    select ${s.products.id}
    from ${s.products}
    where ${inArray(s.products.id, ids)}
    order by ${s.products.id}
    for update
  `);
}

async function getActiveDefaultWarehouse(tx: InventoryTx) {
  const [warehouse] = await tx
    .select()
    .from(s.warehouses)
    .where(and(eq(s.warehouses.isDefault, true), eq(s.warehouses.status, "active")))
    .limit(1);
  if (!warehouse) throw new InventoryError("Не назначен активный основной склад", 500);
  return warehouse;
}

function normalizeLines(lines: InventoryLine[]) {
  const byProduct = new Map<number, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.productId) || line.productId < 1 || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > MAX_INVENTORY_QTY) {
      throw new InventoryError(`Некорректная позиция склада`);
    }
    const total = (byProduct.get(line.productId) ?? 0) + line.qty;
    if (total > MAX_INVENTORY_QTY) throw new InventoryError(`Количество по товару не может превышать ${MAX_INVENTORY_QTY}`);
    byProduct.set(line.productId, total);
  }
  return [...byProduct].map(([productId, qty]) => ({ productId, qty }));
}

/** Writes the stock-operation audit row in the same transaction as the balance change. */
async function recordInventoryActivity(
  tx: InventoryTx,
  input: {
    actor: SessionUser;
    action: string;
    entity: string;
    entityType: string;
    entityId: number;
    severity: "info" | "warning" | "critical";
    ip: string;
    metadata: AuditMetadata;
  },
) {
  await tx.insert(s.activity).values({
    actorUserId: input.actor.id,
    actor: input.actor.name.slice(0, 120),
    action: input.action.slice(0, 240),
    entity: input.entity.slice(0, 300),
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: "business",
    severity: input.severity,
    ip: input.ip.slice(0, 80),
    metadata: safeAuditMetadata(input.metadata),
  });
}

export async function getInventoryData(actor: SessionUser) {
  await ensureSeed();
  assertInventoryOperator(actor);

  const [warehouses, balances, reservations, movements, counts] = await Promise.all([
    db.select().from(s.warehouses).orderBy(desc(s.warehouses.isDefault), asc(s.warehouses.name)),
    db
      .select({
        id: s.warehouseStocks.id,
        warehouseId: s.warehouseStocks.warehouseId,
        warehouseName: s.warehouses.name,
        warehouseCode: s.warehouses.code,
        productId: s.warehouseStocks.productId,
        productName: s.products.name,
        sku: s.products.sku,
        productImage: s.products.image,
        onHand: s.warehouseStocks.onHand,
        reserved: s.warehouseStocks.reserved,
        updatedAt: s.warehouseStocks.updatedAt,
      })
      .from(s.warehouseStocks)
      .innerJoin(s.warehouses, eq(s.warehouseStocks.warehouseId, s.warehouses.id))
      .innerJoin(s.products, eq(s.warehouseStocks.productId, s.products.id))
      .orderBy(asc(s.warehouses.name), asc(s.products.name)),
    db
      .select({
        id: s.stockReservations.id,
        orderId: s.stockReservations.orderId,
        warehouseId: s.stockReservations.warehouseId,
        warehouseName: s.warehouses.name,
        productId: s.stockReservations.productId,
        productName: s.products.name,
        qty: s.stockReservations.qty,
        status: s.stockReservations.status,
        reason: s.stockReservations.reason,
        expiresAt: s.stockReservations.expiresAt,
        createdByName: s.stockReservations.createdByName,
        createdAt: s.stockReservations.createdAt,
      })
      .from(s.stockReservations)
      .innerJoin(s.warehouses, eq(s.stockReservations.warehouseId, s.warehouses.id))
      .innerJoin(s.products, eq(s.stockReservations.productId, s.products.id))
      .where(eq(s.stockReservations.status, "active"))
      .orderBy(desc(s.stockReservations.createdAt))
      .limit(100),
    db
      .select({
        id: s.stockMoves.id,
        kind: s.stockMoves.kind,
        qty: s.stockMoves.qty,
        balanceAfter: s.stockMoves.balanceAfter,
        referenceType: s.stockMoves.referenceType,
        referenceId: s.stockMoves.referenceId,
        actorName: s.stockMoves.actorName,
        note: s.stockMoves.note,
        createdAt: s.stockMoves.createdAt,
        warehouseId: s.stockMoves.warehouseId,
        warehouseName: s.warehouses.name,
        productName: s.products.name,
      })
      .from(s.stockMoves)
      .leftJoin(s.warehouses, eq(s.stockMoves.warehouseId, s.warehouses.id))
      .innerJoin(s.products, eq(s.stockMoves.productId, s.products.id))
      .orderBy(desc(s.stockMoves.createdAt), desc(s.stockMoves.id))
      .limit(100),
    db
      .select({
        id: s.inventoryCounts.id,
        number: s.inventoryCounts.number,
        title: s.inventoryCounts.title,
        warehouseId: s.inventoryCounts.warehouseId,
        warehouseName: s.warehouses.name,
        status: s.inventoryCounts.status,
        startedByName: s.inventoryCounts.startedByName,
        postedByName: s.inventoryCounts.postedByName,
        startedAt: s.inventoryCounts.startedAt,
        postedAt: s.inventoryCounts.postedAt,
        createdAt: s.inventoryCounts.createdAt,
      })
      .from(s.inventoryCounts)
      .innerJoin(s.warehouses, eq(s.inventoryCounts.warehouseId, s.warehouses.id))
      .orderBy(desc(s.inventoryCounts.createdAt))
      .limit(40),
  ]);

  return {
    warehouses,
    balances: balances.map((balance) => ({ ...balance, available: Math.max(0, balance.onHand - balance.reserved) })),
    reservations,
    movements,
    counts,
  };
}

/** Creates a location; only a management role can change the warehouse topology. */
export async function createWarehouse(actor: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertWarehouseManager(actor);
  const code = text(input.code, 24).toUpperCase();
  const name = text(input.name, 160);
  if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code)) {
    throw new InventoryError("Код склада: 2–24 символа A–Z, цифры, дефис или подчёркивание");
  }
  if (!name) throw new InventoryError("Укажите название склада");
  const city = text(input.city, 120);
  const address = text(input.address, 400);
  const makeDefault = input.isDefault === true;

  const warehouse = await db.transaction(async (tx) => {
    if (makeDefault) {
      const [currentDefault] = await tx
        .select({ id: s.warehouses.id })
        .from(s.warehouses)
        .where(eq(s.warehouses.isDefault, true))
        .limit(1);
      if (currentDefault) {
        throw new InventoryError("Основной склад уже назначен; перенос статуса требует отдельной инвентаризационной процедуры", 409);
      }
    }
    const [created] = await tx
      .insert(s.warehouses)
      .values({ code, name, city, address, isDefault: makeDefault, status: "active", updatedAt: new Date() })
      .returning();
    if (!created) throw new InventoryError("Не удалось создать склад", 500);
    await recordInventoryActivity(tx, {
      actor,
      action: "создал склад",
      entity: `${created.code} · ${created.name}`,
      entityType: "warehouse",
      entityId: created.id,
      severity: "info",
      ip,
      metadata: { code: created.code, isDefault: created.isDefault },
    });
    return created;
  });
  return warehouse;
}

/** Adds/removes physical stock and synchronizes legacy `products.stock` as sellable availability. */
export async function adjustWarehouseStock(actor: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertInventoryOperator(actor);
  const warehouseId = positiveId(input.warehouseId, "склад");
  const productId = positiveId(input.productId, "товар");
  const qty = quantity(input.qty);
  const rawKind = text(input.kind, 32);
  const kind: StockAdjustmentKind | null = ["receipt", "issue", "writeoff", "adjustment_gain", "adjustment_loss"].includes(rawKind)
    ? rawKind as StockAdjustmentKind
    : null;
  if (!kind) throw new InventoryError("Некорректный тип складской операции");
  const note = text(input.note) || "Складская корректировка";
  const decreasesStock = kind === "issue" || kind === "writeoff" || kind === "adjustment_loss";
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [warehouse] = await tx.select().from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).limit(1);
    if (!warehouse || warehouse.status !== "active") throw new InventoryError("Склад не найден или неактивен", 404);
    await lockProducts(tx, [productId]);
    const [product] = await tx.select().from(s.products).where(eq(s.products.id, productId)).limit(1);
    const defaultWarehouse = await getActiveDefaultWarehouse(tx);
    if (!product) throw new InventoryError("Товар не найден", 404);

    // A product created after the migration may not have a row yet. Always
    // import its legacy aggregate into MAIN before touching a satellite store.
    if (defaultWarehouse.id !== warehouse.id) {
      await ensureBalance(tx, defaultWarehouse.id, product.id, true, product.stock);
    }
    const balance = await ensureBalance(tx, warehouse.id, product.id, warehouse.isDefault, product.stock);
    const [updated] = await tx
      .update(s.warehouseStocks)
      .set({
        onHand: decreasesStock ? sql`${s.warehouseStocks.onHand} - ${qty}` : sql`${s.warehouseStocks.onHand} + ${qty}`,
        updatedAt: now,
      })
      .where(and(
        eq(s.warehouseStocks.id, balance.id),
        decreasesStock ? sql`${s.warehouseStocks.onHand} - ${s.warehouseStocks.reserved} >= ${qty}` : sql`true`,
      ))
      .returning();
    if (!updated) throw new InventoryError("Недостаточно свободного остатка на выбранном складе", 409);

    const available = await syncProductAvailability(tx, product.id);
    const [movement] = await tx
      .insert(s.stockMoves)
      .values({
        productId: product.id,
        warehouseId: warehouse.id,
        kind,
        qty,
        balanceAfter: updated.onHand,
        referenceType: "manual",
        actorUserId: actor.id,
        actorName: actor.name,
        note,
      })
      .returning({ id: s.stockMoves.id });
    await tx.insert(s.syncEvents).values([
      { source: "warehouse", target: "crm", entity: "stock", action: "stock_changed", payload: { productId: product.id, warehouseId: warehouse.id, qty } },
      { source: "crm", target: "miniapp", entity: "stock", action: "availability_updated", payload: { productId: product.id, available } },
    ]);
    await recordInventoryActivity(tx, {
      actor,
      action: "провёл складскую операцию",
      entity: `${product.name} · ${warehouse.name}`,
      entityType: "stock_move",
      entityId: movement.id,
      severity: kind === "writeoff" || kind === "adjustment_loss" ? "warning" : "info",
      ip,
      metadata: { warehouseId, productId, kind, qty, available },
    });
    return { movementId: movement.id, product, warehouse, available, balanceAfter: updated.onHand };
  });
  return result;
}

/** Transfers only free stock; reservations always remain at their source warehouse. */
export async function transferWarehouseStock(actor: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertInventoryOperator(actor);
  const sourceWarehouseId = positiveId(input.sourceWarehouseId, "склад-источник");
  const destinationWarehouseId = positiveId(input.destinationWarehouseId, "склад-назначение");
  if (sourceWarehouseId === destinationWarehouseId) throw new InventoryError("Выберите другой склад назначения");
  const productId = positiveId(input.productId, "товар");
  const qty = quantity(input.qty);
  const note = text(input.note) || "Перемещение между складами";
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(s.warehouses).where(eq(s.warehouses.id, sourceWarehouseId)).limit(1);
    const [destination] = await tx.select().from(s.warehouses).where(eq(s.warehouses.id, destinationWarehouseId)).limit(1);
    if (!source || source.status !== "active" || !destination || destination.status !== "active") {
      throw new InventoryError("Склад-источник или склад-назначение недоступен", 404);
    }
    await lockProducts(tx, [productId]);
    const [product] = await tx.select().from(s.products).where(eq(s.products.id, productId)).limit(1);
    const defaultWarehouse = await getActiveDefaultWarehouse(tx);
    if (!product) throw new InventoryError("Товар не найден", 404);

    if (defaultWarehouse.id !== source.id && defaultWarehouse.id !== destination.id) {
      await ensureBalance(tx, defaultWarehouse.id, product.id, true, product.stock);
    }
    const sourceBalance = await ensureBalance(tx, source.id, product.id, source.isDefault, product.stock);
    const destinationBalance = await ensureBalance(tx, destination.id, product.id, destination.isDefault, product.stock);
    const [sourceUpdated] = await tx
      .update(s.warehouseStocks)
      .set({ onHand: sql`${s.warehouseStocks.onHand} - ${qty}`, updatedAt: now })
      .where(and(
        eq(s.warehouseStocks.id, sourceBalance.id),
        sql`${s.warehouseStocks.onHand} - ${s.warehouseStocks.reserved} >= ${qty}`,
      ))
      .returning();
    if (!sourceUpdated) throw new InventoryError("Недостаточно свободного остатка на складе-источнике", 409);
    const [destinationUpdated] = await tx
      .update(s.warehouseStocks)
      .set({ onHand: sql`${s.warehouseStocks.onHand} + ${qty}`, updatedAt: now })
      .where(eq(s.warehouseStocks.id, destinationBalance.id))
      .returning();
    if (!destinationUpdated) throw new InventoryError("Не удалось зачислить товар на склад назначения", 500);

    const available = await syncProductAvailability(tx, product.id);
    const [sourceMove] = await tx
      .insert(s.stockMoves)
      .values({
        productId: product.id,
        warehouseId: source.id,
        kind: "transfer_out",
        qty,
        balanceAfter: sourceUpdated.onHand,
        referenceType: "transfer",
        actorUserId: actor.id,
        actorName: actor.name,
        note,
      })
      .returning({ id: s.stockMoves.id });
    await tx.insert(s.stockMoves).values({
      productId: product.id,
      warehouseId: destination.id,
      kind: "transfer_in",
      qty,
      balanceAfter: destinationUpdated.onHand,
      referenceType: "transfer",
      referenceId: sourceMove.id,
      actorUserId: actor.id,
      actorName: actor.name,
      note,
    });
    await tx.insert(s.syncEvents).values([
      { source: "warehouse", target: "crm", entity: "stock", action: "stock_transferred", payload: { productId: product.id, qty, sourceWarehouseId: source.id, destinationWarehouseId: destination.id } },
      { source: "crm", target: "miniapp", entity: "stock", action: "availability_updated", payload: { productId: product.id, available } },
    ]);
    await recordInventoryActivity(tx, {
      actor,
      action: "переместил товар между складами",
      entity: `${product.name}: ${source.name} → ${destination.name}`,
      entityType: "stock_move",
      entityId: sourceMove.id,
      severity: "info",
      ip,
      metadata: { sourceWarehouseId, destinationWarehouseId, productId, qty, available },
    });
    return { source, destination, product, available, sourceBalanceAfter: sourceUpdated.onHand, destinationBalanceAfter: destinationUpdated.onHand, movementId: sourceMove.id };
  });
  return result;
}


/** Posts a full, optimistic-concurrency inventory count for one warehouse. */
export async function completeInventoryCount(actor: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertInventoryOperator(actor);
  const warehouseId = positiveId(input.warehouseId, "склад");
  const title = text(input.title, 220) || "Инвентаризация склада";
  const notes = text(input.notes, 2_000);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length || rawItems.length > 1_000) {
    throw new InventoryError("Инвентаризация должна содержать от 1 до 1000 позиций");
  }
  const items = rawItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new InventoryError("Некорректная позиция инвентаризации");
    }
    const row = item as Record<string, unknown>;
    const productId = positiveId(row.productId, "товар");
    const expectedOnHand = typeof row.expectedOnHand === "number" && Number.isSafeInteger(row.expectedOnHand) && row.expectedOnHand >= 0 && row.expectedOnHand <= MAX_INVENTORY_QTY
      ? row.expectedOnHand
      : null;
    const countedQty = typeof row.countedQty === "number" && Number.isSafeInteger(row.countedQty) && row.countedQty >= 0 && row.countedQty <= MAX_INVENTORY_QTY
      ? row.countedQty
      : null;
    if (expectedOnHand === null || countedQty === null) {
      throw new InventoryError(`Некорректное количество для товара #${productId}`);
    }
    return { productId, expectedOnHand, countedQty, note: text(row.note, 500) };
  });
  if (new Set(items.map((item) => item.productId)).size !== items.length) {
    throw new InventoryError("Товар нельзя указывать в инвентаризации дважды");
  }
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [warehouse] = await tx.select().from(s.warehouses).where(eq(s.warehouses.id, warehouseId)).limit(1);
    if (!warehouse || warehouse.status !== "active") throw new InventoryError("Склад не найден или неактивен", 404);

    const productIds = items.map((item) => item.productId);
    await lockProducts(tx, productIds);
    const products = await tx.select().from(s.products).where(inArray(s.products.id, productIds));
    const balances = await tx
      .select()
      .from(s.warehouseStocks)
      .where(and(eq(s.warehouseStocks.warehouseId, warehouseId), inArray(s.warehouseStocks.productId, productIds)));
    if (products.length !== productIds.length || balances.length !== productIds.length) {
      throw new InventoryError("Один или несколько товаров не найдены на выбранном складе", 404);
    }
    const productsById = new Map(products.map((product) => [product.id, product]));
    const balancesByProduct = new Map(balances.map((balance) => [balance.productId, balance]));

    for (const item of items) {
      const balance = balancesByProduct.get(item.productId)!;
      if (balance.onHand !== item.expectedOnHand) {
        throw new InventoryError(`Остаток «${productsById.get(item.productId)?.name ?? "товар"}» изменился. Обновите данные и пересчитайте позицию.`, 409);
      }
      if (item.countedQty < balance.reserved) {
        throw new InventoryError(`Фактический остаток «${productsById.get(item.productId)?.name ?? "товар"}» меньше уже зарезервированного (${balance.reserved})`, 409);
      }
    }

    const [countRow] = await tx
      .insert(s.inventoryCounts)
      .values({
        warehouseId,
        number: `INV-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
        title,
        status: "posted",
        notes,
        startedByUserId: actor.id,
        startedByName: actor.name,
        postedByUserId: actor.id,
        postedByName: actor.name,
        startedAt: now,
        postedAt: now,
        updatedAt: now,
      })
      .returning();
    if (!countRow) throw new InventoryError("Не удалось создать документ инвентаризации", 500);

    await tx.insert(s.inventoryCountLines).values(items.map((item) => {
      const balance = balancesByProduct.get(item.productId)!;
      return {
        inventoryCountId: countRow.id,
        productId: item.productId,
        systemQty: balance.onHand,
        countedQty: item.countedQty,
        difference: item.countedQty - balance.onHand,
        note: item.note,
        countedByUserId: actor.id,
        countedAt: now,
        updatedAt: now,
      };
    }));

    let adjustments = 0;
    for (const item of items) {
      const balance = balancesByProduct.get(item.productId)!;
      const difference = item.countedQty - balance.onHand;
      if (!difference) continue;
      adjustments += 1;
      const [updated] = await tx
        .update(s.warehouseStocks)
        .set({ onHand: item.countedQty, updatedAt: now })
        .where(and(
          eq(s.warehouseStocks.id, balance.id),
          eq(s.warehouseStocks.onHand, item.expectedOnHand),
        ))
        .returning();
      if (!updated) throw new InventoryError("Остаток изменился во время проведения инвентаризации", 409);
      await tx.insert(s.stockMoves).values({
        productId: item.productId,
        warehouseId,
        kind: difference > 0 ? "adjustment_gain" : "adjustment_loss",
        qty: Math.abs(difference),
        balanceAfter: updated.onHand,
        referenceType: "inventory_count",
        referenceId: countRow.id,
        actorUserId: actor.id,
        actorName: actor.name,
        note: item.note || `Инвентаризация ${countRow.number}`,
      });
    }

    for (const productId of productIds) await syncProductAvailability(tx, productId);
    await tx.insert(s.syncEvents).values([
      {
        source: "warehouse",
        target: "crm",
        entity: "inventory_count",
        action: "inventory_posted",
        payload: { inventoryCountId: countRow.id, warehouseId, items: items.length, adjustments },
      },
      {
        source: "crm",
        target: "miniapp",
        entity: "stock",
        action: "availability_reconciled",
        payload: { warehouseId, products: productIds.length },
      },
    ]);
    await recordInventoryActivity(tx, {
      actor,
      action: "провёл инвентаризацию",
      entity: `${countRow.number} · ${warehouse.name}`,
      entityType: "inventory_count",
      entityId: countRow.id,
      severity: adjustments > 0 ? "warning" : "info",
      ip,
      metadata: { warehouseId, positions: items.length, adjustments },
    });
    return { countRow, adjustments, warehouse };
  });
  return { id: result.countRow.id, number: result.countRow.number, adjustments: result.adjustments };
}

/**
 * Creates the MAIN balance for a newly created product. It deliberately writes
 * no movement: the supplied product.stock is its opening balance, not a later
 * receipt. Call this in the same transaction that creates the product.
 */
export async function initializeProductInventory(tx: InventoryTx, productId: number) {
  await lockProducts(tx, [productId]);
  const [product] = await tx.select().from(s.products).where(eq(s.products.id, productId)).limit(1);
  const defaultWarehouse = await getActiveDefaultWarehouse(tx);
  if (!product) throw new InventoryError("Товар не найден", 404);
  return ensureBalance(tx, defaultWarehouse.id, product.id, true, product.stock);
}

/** Holds free stock for an order in MAIN without reducing physical on-hand. */
export async function reserveOrderInventory(
  tx: InventoryTx,
  input: { orderId: number; items: InventoryLine[]; actor: InventoryActor; reason?: string },
) {
  if (!Number.isSafeInteger(input.orderId) || input.orderId < 1) throw new InventoryError("Некорректный заказ");
  const items = normalizeLines(input.items);
  if (!items.length) throw new InventoryError("Добавьте хотя бы одну позицию для резерва");
  await lockProducts(tx, items.map((item) => item.productId));
  const defaultWarehouse = await getActiveDefaultWarehouse(tx);
  const products = await tx.select().from(s.products).where(inArray(s.products.id, items.map((item) => item.productId)));
  const productsById = new Map(products.map((product) => [product.id, product]));
  if (productsById.size !== items.length) throw new InventoryError("Один или несколько товаров не найдены", 404);

  const now = new Date();
  const reservations: { id: number; productId: number; qty: number }[] = [];
  for (const item of items) {
    const product = productsById.get(item.productId)!;
    if (product.status !== "active") throw new InventoryError(`Товар «${product.name}» недоступен для продажи`, 409);
    const balance = await ensureBalance(tx, defaultWarehouse.id, product.id, true, product.stock);
    const [updated] = await tx
      .update(s.warehouseStocks)
      .set({ reserved: sql`${s.warehouseStocks.reserved} + ${item.qty}`, updatedAt: now })
      .where(and(
        eq(s.warehouseStocks.id, balance.id),
        sql`${s.warehouseStocks.onHand} - ${s.warehouseStocks.reserved} >= ${item.qty}`,
      ))
      .returning();
    if (!updated) {
      throw new InventoryError(`Недостаточно свободного остатка «${product.name}» на основном складе`, 409);
    }
    const [reservation] = await tx
      .insert(s.stockReservations)
      .values({
        orderId: input.orderId,
        warehouseId: defaultWarehouse.id,
        productId: product.id,
        qty: item.qty,
        status: "active",
        reason: (input.reason ?? "Резерв под заказ").slice(0, MAX_INVENTORY_NOTE_LENGTH),
        createdByUserId: input.actor.id ?? null,
        createdByName: input.actor.name.slice(0, 160),
      })
      .returning({ id: s.stockReservations.id });
    if (!reservation) throw new InventoryError("Не удалось создать резерв", 500);
    reservations.push({ id: reservation.id, productId: product.id, qty: item.qty });
    await tx.insert(s.stockMoves).values({
      productId: product.id,
      warehouseId: defaultWarehouse.id,
      kind: "reserve",
      qty: item.qty,
      balanceAfter: updated.onHand,
      referenceType: "order",
      referenceId: input.orderId,
      actorUserId: input.actor.id ?? null,
      actorName: input.actor.name.slice(0, 160),
      note: (input.reason ?? "Резерв под заказ").slice(0, MAX_INVENTORY_NOTE_LENGTH),
    });
  }
  for (const item of items) await syncProductAvailability(tx, item.productId);
  await tx.insert(s.syncEvents).values({
    source: "warehouse",
    target: "miniapp",
    entity: "stock_reservation",
    action: "order_stock_reserved",
    payload: { orderId: input.orderId, warehouseId: defaultWarehouse.id, items: items.length },
  });
  return { warehouseId: defaultWarehouse.id, reservations };
}

type ReservationResolution = "released" | "fulfilled" | "expired";

/** Releases or fulfills all still-active reservations for a single order. */
export async function resolveOrderInventoryReservations(
  tx: InventoryTx,
  input: { orderId: number; resolution: ReservationResolution; actor: InventoryActor; note?: string },
) {
  if (!Number.isSafeInteger(input.orderId) || input.orderId < 1) throw new InventoryError("Некорректный заказ");
  const candidates = await tx
    .select()
    .from(s.stockReservations)
    .where(and(eq(s.stockReservations.orderId, input.orderId), eq(s.stockReservations.status, "active")));
  if (!candidates.length) return { changed: 0, productIds: [] as number[] };

  await lockProducts(tx, candidates.map((reservation) => reservation.productId));
  const now = new Date();
  const changedProductIds = new Set<number>();
  let changed = 0;
  for (const reservation of candidates) {
    // Another transition can win while this transaction was waiting for SKU locks.
    const [claimed] = await tx
      .update(s.stockReservations)
      .set({ status: input.resolution, releasedAt: now })
      .where(and(eq(s.stockReservations.id, reservation.id), eq(s.stockReservations.status, "active")))
      .returning();
    if (!claimed) continue;

    const [updated] = input.resolution === "fulfilled"
      ? await tx
        .update(s.warehouseStocks)
        .set({
          onHand: sql`${s.warehouseStocks.onHand} - ${reservation.qty}`,
          reserved: sql`${s.warehouseStocks.reserved} - ${reservation.qty}`,
          updatedAt: now,
        })
        .where(and(
          eq(s.warehouseStocks.warehouseId, reservation.warehouseId),
          eq(s.warehouseStocks.productId, reservation.productId),
          sql`${s.warehouseStocks.onHand} >= ${reservation.qty}`,
          sql`${s.warehouseStocks.reserved} >= ${reservation.qty}`,
        ))
        .returning()
      : await tx
        .update(s.warehouseStocks)
        .set({ reserved: sql`${s.warehouseStocks.reserved} - ${reservation.qty}`, updatedAt: now })
        .where(and(
          eq(s.warehouseStocks.warehouseId, reservation.warehouseId),
          eq(s.warehouseStocks.productId, reservation.productId),
          sql`${s.warehouseStocks.reserved} >= ${reservation.qty}`,
        ))
        .returning();
    if (!updated) throw new InventoryError("Нарушена целостность резерва склада", 409);

    changed += 1;
    changedProductIds.add(reservation.productId);
    await tx.insert(s.stockMoves).values({
      productId: reservation.productId,
      warehouseId: reservation.warehouseId,
      kind: input.resolution === "fulfilled" ? "fulfillment" : "release",
      qty: reservation.qty,
      balanceAfter: updated.onHand,
      referenceType: "order",
      referenceId: input.orderId,
      actorUserId: input.actor.id ?? null,
      actorName: input.actor.name.slice(0, 160),
      note: (input.note ?? (input.resolution === "fulfilled" ? "Отгрузка заказа" : "Снятие резерва заказа")).slice(0, MAX_INVENTORY_NOTE_LENGTH),
    });
  }
  for (const productId of changedProductIds) await syncProductAvailability(tx, productId);
  if (changed) {
    await tx.insert(s.syncEvents).values({
      source: "warehouse",
      target: "miniapp",
      entity: "stock_reservation",
      action: input.resolution === "fulfilled" ? "order_stock_fulfilled" : "order_stock_released",
      payload: { orderId: input.orderId, reservations: changed },
    });
  }
  return { changed, productIds: [...changedProductIds] };
}

/** Receives physical stock for a purchase, return, or other referenced document. */
export async function receiveReferencedInventory(
  tx: InventoryTx,
  input: {
    items: InventoryLine[];
    actor: InventoryActor;
    referenceType: string;
    referenceId?: number | null;
    note?: string;
    warehouseId?: number;
  },
) {
  const items = normalizeLines(input.items);
  if (!items.length) throw new InventoryError("Добавьте хотя бы одну складскую позицию");
  await lockProducts(tx, items.map((item) => item.productId));
  const warehouse = input.warehouseId
    ? (await tx
      .select()
      .from(s.warehouses)
      .where(and(eq(s.warehouses.id, input.warehouseId), eq(s.warehouses.status, "active")))
      .limit(1))[0]
    : await getActiveDefaultWarehouse(tx);
  const products = await tx.select().from(s.products).where(inArray(s.products.id, items.map((item) => item.productId)));
  if (!warehouse) throw new InventoryError("Склад не найден или неактивен", 404);
  const productsById = new Map(products.map((product) => [product.id, product]));
  if (productsById.size !== items.length) throw new InventoryError("Один или несколько товаров не найдены", 404);

  const now = new Date();
  for (const item of items) {
    const product = productsById.get(item.productId)!;
    const balance = await ensureBalance(tx, warehouse.id, product.id, warehouse.isDefault, product.stock);
    const [updated] = await tx
      .update(s.warehouseStocks)
      .set({ onHand: sql`${s.warehouseStocks.onHand} + ${item.qty}`, updatedAt: now })
      .where(eq(s.warehouseStocks.id, balance.id))
      .returning();
    if (!updated) throw new InventoryError("Не удалось оприходовать товар", 500);
    await tx.insert(s.stockMoves).values({
      productId: product.id,
      warehouseId: warehouse.id,
      kind: "receipt",
      qty: item.qty,
      balanceAfter: updated.onHand,
      referenceType: input.referenceType.slice(0, 80),
      referenceId: input.referenceId ?? null,
      actorUserId: input.actor.id ?? null,
      actorName: input.actor.name.slice(0, 160),
      note: (input.note ?? "Оприходование товара").slice(0, MAX_INVENTORY_NOTE_LENGTH),
    });
  }
  for (const item of items) await syncProductAvailability(tx, item.productId);
  await tx.insert(s.syncEvents).values({
    source: "warehouse",
    target: "miniapp",
    entity: "stock",
    action: "stock_received",
    payload: {
      referenceType: input.referenceType.slice(0, 80),
      ...(typeof input.referenceId === "number" ? { referenceId: input.referenceId } : {}),
      items: items.length,
    },
  });
  return { warehouseId: warehouse.id, items: items.length };
}

/** Returns fulfilled order items to their original warehouse exactly once. */
export async function restockFulfilledOrderInventory(
  tx: InventoryTx,
  input: { orderId: number; returnId: number; actor: InventoryActor; note?: string },
) {
  const fulfilled = await tx
    .select()
    .from(s.stockReservations)
    .where(and(eq(s.stockReservations.orderId, input.orderId), eq(s.stockReservations.status, "fulfilled")));
  if (!fulfilled.length) return { restocked: 0 };
  await lockProducts(tx, fulfilled.map((reservation) => reservation.productId));
  const now = new Date();
  let restocked = 0;
  for (const reservation of fulfilled) {
    const [claimed] = await tx
      .update(s.stockReservations)
      .set({ status: "released", releasedAt: now })
      .where(and(eq(s.stockReservations.id, reservation.id), eq(s.stockReservations.status, "fulfilled")))
      .returning();
    if (!claimed) continue;
    const [updated] = await tx
      .update(s.warehouseStocks)
      .set({ onHand: sql`${s.warehouseStocks.onHand} + ${reservation.qty}`, updatedAt: now })
      .where(and(eq(s.warehouseStocks.warehouseId, reservation.warehouseId), eq(s.warehouseStocks.productId, reservation.productId)))
      .returning();
    if (!updated) throw new InventoryError("Не найден исходный склад возврата", 409);
    restocked += 1;
    await tx.insert(s.stockMoves).values({
      productId: reservation.productId,
      warehouseId: reservation.warehouseId,
      kind: "receipt",
      qty: reservation.qty,
      balanceAfter: updated.onHand,
      referenceType: "return",
      referenceId: input.returnId,
      actorUserId: input.actor.id ?? null,
      actorName: input.actor.name.slice(0, 160),
      note: (input.note ?? "Возврат заказа на склад").slice(0, MAX_INVENTORY_NOTE_LENGTH),
    });
  }
  const productIds = [...new Set(fulfilled.map((reservation) => reservation.productId))];
  for (const productId of productIds) await syncProductAvailability(tx, productId);
  if (restocked) {
    await tx.insert(s.syncEvents).values({
      source: "warehouse",
      target: "miniapp",
      entity: "stock_return",
      action: "returned_items_restocked",
      payload: { orderId: input.orderId, returnId: input.returnId, items: restocked },
    });
  }
  return { restocked };
}
