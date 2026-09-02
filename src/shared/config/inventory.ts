export const WAREHOUSE_STATUSES = ["active", "inactive"] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];

export const RESERVATION_STATUSES = ["active", "released", "fulfilled", "expired"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const INVENTORY_COUNT_STATUSES = ["draft", "counting", "posted", "cancelled"] as const;
export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];

export const INVENTORY_MOVEMENT_KINDS = [
  "receipt",
  "issue",
  "transfer_out",
  "transfer_in",
  "writeoff",
  "adjustment_gain",
  "adjustment_loss",
  "reserve",
  "release",
  "fulfillment",
] as const;
export type InventoryMovementKind = (typeof INVENTORY_MOVEMENT_KINDS)[number];

export const MAX_INVENTORY_QTY = 100_000;
export const MAX_INVENTORY_NOTE_LENGTH = 1_000;

/** Warehouse staff can move/count stock; creating locations stays a management decision. */
export function canOperateInventory(role: string) {
  return ["owner", "admin", "manager", "warehouse"].includes(role);
}

export function canManageWarehouses(role: string) {
  return ["owner", "admin", "manager"].includes(role);
}

export function isWarehouseStatus(value: string): value is WarehouseStatus {
  return (WAREHOUSE_STATUSES as readonly string[]).includes(value);
}

export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

export function isInventoryCountStatus(value: string): value is InventoryCountStatus {
  return (INVENTORY_COUNT_STATUSES as readonly string[]).includes(value);
}
