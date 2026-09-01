"use client";

import { MAX_VISIT_PHOTOS } from "@/shared/config/fieldwork";

const DB_NAME = "delis_agent_offline";
const DB_VERSION = 2;
const STORE_PRODUCTS = "cached_products";
const STORE_ORDERS = "offline_orders";
const STORE_FIELDWORK = "fieldwork_mutations";

export interface OfflineVisitPayload {
  agentId?: number;
  routeStopId?: number | null;
  storeName: string;
  storeAddress: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  locationCapturedAt: string;
  status: string;
  orderTotal: number;
  notes: string;
  photos: string[];
  offline: true;
}

export interface OfflineFieldworkMutation {
  clientMutationId: string;
  kind: "visit";
  payload: OfflineVisitPayload;
  createdAt: string;
  attempts: number;
  lastError: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_PRODUCTS)) {
        database.createObjectStore(STORE_PRODUCTS, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(STORE_ORDERS)) {
        const orders = database.createObjectStore(STORE_ORDERS, { keyPath: "id", autoIncrement: true });
        orders.createIndex("synced", "synced", { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE_FIELDWORK)) {
        const fieldwork = database.createObjectStore(STORE_FIELDWORK, { keyPath: "clientMutationId" });
        fieldwork.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function newMutationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `fieldwork_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

// ═══ КЭШИРОВАНИЕ ТОВАРОВ ═══
export async function cacheProducts(products: unknown[]) {
  if (!products.length) return;
  try {
    const database = await openDB();
    const transaction = database.transaction(STORE_PRODUCTS, "readwrite");
    const store = transaction.objectStore(STORE_PRODUCTS);
    store.clear();
    for (const product of products) store.put(product);
    await transactionDone(transaction);
    database.close();
  } catch {
    /* IndexedDB may be unavailable (private mode / unsupported browser). */
  }
}

export async function getCachedProducts(): Promise<unknown[]> {
  try {
    const database = await openDB();
    const store = database.transaction(STORE_PRODUCTS, "readonly").objectStore(STORE_PRODUCTS);
    const products = await new Promise<unknown[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return products;
  } catch {
    return [];
  }
}

// ═══ OFFLINE B2B ORDERS ═══
// The order idempotency key is retained with the payload so reconnect replay is safe.
export async function saveOfflineOrder(payload: {
  agentId: number;
  storeName: string;
  storeAddress: string;
  items: { productId: number; qty: number }[];
  notes: string;
  clientMutationId?: string;
}) {
  try {
    const clientMutationId = typeof payload.clientMutationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(payload.clientMutationId)
      ? payload.clientMutationId
      : newMutationId();
    const database = await openDB();
    const transaction = database.transaction(STORE_ORDERS, "readwrite");
    transaction.objectStore(STORE_ORDERS).add({
      ...payload,
      clientMutationId,
      synced: false,
      createdAt: new Date().toISOString(),
    });
    await transactionDone(transaction);
    database.close();
    return true;
  } catch {
    return false;
  }
}

/** Pending orders are scoped by the linked agent so a shared device never replays another account's work. */
export async function getPendingOrders(agentId?: number): Promise<(Record<string, unknown> & { id: number; synced: boolean })[]> {
  try {
    const database = await openDB();
    const store = database.transaction(STORE_ORDERS, "readonly").objectStore(STORE_ORDERS);
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return (all as (Record<string, unknown> & { id: number; synced: boolean })[]).filter((order) => {
      if (order.synced) return false;
      return agentId === undefined || order.agentId === agentId;
    });
  } catch {
    return [];
  }
}

/**
 * Version-1 queues did not have a mutation id. Persist one before their first
 * replay so a dropped response can still be retried without duplicating sales.
 */
export async function ensureOfflineOrderMutationId(id: number): Promise<string | null> {
  try {
    const database = await openDB();
    const transaction = database.transaction(STORE_ORDERS, "readwrite");
    const store = transaction.objectStore(STORE_ORDERS);
    const item = await new Promise<Record<string, unknown> | null>((resolve) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result && typeof request.result === "object" ? request.result as Record<string, unknown> : null);
      request.onerror = () => resolve(null);
    });
    if (!item) {
      await transactionDone(transaction);
      database.close();
      return null;
    }
    const clientMutationId = typeof item.clientMutationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(item.clientMutationId)
      ? item.clientMutationId
      : newMutationId();
    if (item.clientMutationId !== clientMutationId) store.put({ ...item, clientMutationId });
    await transactionDone(transaction);
    database.close();
    return clientMutationId;
  } catch {
    return null;
  }
}

export async function markOrderSynced(id: number) {
  try {
    const database = await openDB();
    const transaction = database.transaction(STORE_ORDERS, "readwrite");
    const store = transaction.objectStore(STORE_ORDERS);
    const item = await new Promise<Record<string, unknown> | null>((resolve) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result && typeof request.result === "object" ? request.result as Record<string, unknown> : null);
      request.onerror = () => resolve(null);
    });
    if (item) store.put({ ...item, synced: true });
    await transactionDone(transaction);
    database.close();
  } catch {
    /* Retry on the next reconnect. */
  }
}

// ═══ IDEMPOTENT OFFLINE GPS VISITS ═══
export async function queueOfflineVisit(payload: OfflineVisitPayload, existingMutationId?: string) {
  if (!payload.storeName.trim() || !Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) return null;
  if (!Array.isArray(payload.photos) || payload.photos.length > MAX_VISIT_PHOTOS) return null;
  try {
    const clientMutationId = typeof existingMutationId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(existingMutationId)
      ? existingMutationId
      : newMutationId();
    const database = await openDB();
    const mutation: OfflineFieldworkMutation = {
      clientMutationId,
      kind: "visit",
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: "",
    };
    const transaction = database.transaction(STORE_FIELDWORK, "readwrite");
    transaction.objectStore(STORE_FIELDWORK).put(mutation);
    await transactionDone(transaction);
    database.close();
    return mutation;
  } catch {
    return null;
  }
}

/** Pending GPS reports are likewise isolated to the signed-in agent profile. */
export async function getPendingFieldworkMutations(agentId?: number): Promise<OfflineFieldworkMutation[]> {
  try {
    const database = await openDB();
    const store = database.transaction(STORE_FIELDWORK, "readonly").objectStore(STORE_FIELDWORK);
    const items = await new Promise<OfflineFieldworkMutation[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result ?? []) as OfflineFieldworkMutation[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return items
      .filter((mutation) => agentId === undefined || mutation.payload.agentId === agentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function markFieldworkMutationSynced(clientMutationId: string) {
  try {
    const database = await openDB();
    const transaction = database.transaction(STORE_FIELDWORK, "readwrite");
    transaction.objectStore(STORE_FIELDWORK).delete(clientMutationId);
    await transactionDone(transaction);
    database.close();
  } catch {
    /* Keeping a queued item is safer than dropping it after a storage error. */
  }
}

export async function markFieldworkMutationFailed(clientMutationId: string, error: string) {
  try {
    const database = await openDB();
    const transaction = database.transaction(STORE_FIELDWORK, "readwrite");
    const store = transaction.objectStore(STORE_FIELDWORK);
    const item = await new Promise<OfflineFieldworkMutation | null>((resolve) => {
      const request = store.get(clientMutationId);
      request.onsuccess = () => resolve((request.result as OfflineFieldworkMutation | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
    if (item) store.put({ ...item, attempts: item.attempts + 1, lastError: error.slice(0, 240) });
    await transactionDone(transaction);
    database.close();
  } catch {
    /* Retry metadata is non-essential. */
  }
}

export async function pendingFieldworkCount(agentId?: number) {
  return (await getPendingFieldworkMutations(agentId)).length;
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine;
}
