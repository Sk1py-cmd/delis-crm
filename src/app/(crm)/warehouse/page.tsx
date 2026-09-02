import { requireAccess } from "@/server/guard";
import { getProducts } from "@/server/queries";
import { getInventoryData } from "@/server/inventory";
import { WarehouseClient } from "./WarehouseClient";

export const dynamic = "force-dynamic";

export default async function WarehousePage() {
  const viewer = await requireAccess("/warehouse");
  const [products, inventory] = await Promise.all([getProducts(), getInventoryData(viewer)]);

  return (
    <WarehouseClient
      products={products}
      canManageWarehouses={["owner", "admin", "manager"].includes(viewer.role)}
      inventory={{
        warehouses: inventory.warehouses.map((warehouse) => ({
          ...warehouse,
          createdAt: String(warehouse.createdAt),
          updatedAt: String(warehouse.updatedAt),
        })),
        balances: inventory.balances.map((balance) => ({ ...balance, updatedAt: String(balance.updatedAt) })),
        reservations: inventory.reservations.map((reservation) => ({
          ...reservation,
          expiresAt: reservation.expiresAt ? String(reservation.expiresAt) : null,
          createdAt: String(reservation.createdAt),
        })),
        movements: inventory.movements.map((movement) => ({
          ...movement,
          warehouseName: movement.warehouseName ?? "Архивный склад",
          createdAt: String(movement.createdAt),
        })),
        counts: inventory.counts.map((count) => ({
          ...count,
          startedAt: count.startedAt ? String(count.startedAt) : null,
          postedAt: count.postedAt ? String(count.postedAt) : null,
          createdAt: String(count.createdAt),
        })),
      }}
    />
  );
}
