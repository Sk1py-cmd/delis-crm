import { requireAccess } from "@/server/guard";
import { getProcurementData } from "@/server/queries";
import { getInventoryData } from "@/server/inventory";
import { SuppliersClient } from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const viewer = await requireAccess("/suppliers");
  const [data, inventory] = await Promise.all([getProcurementData(), getInventoryData(viewer)]);

  return (
    <SuppliersClient
      suppliers={data.suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        country: s.country,
        city: s.city,
        category: s.category,
        rating: s.rating,
        leadTimeDays: s.leadTimeDays,
        totalPurchased: String(s.totalPurchased),
        status: s.status,
        notes: s.notes,
      }))}
      orders={data.orders.map((o) => ({
        id: o.id,
        number: o.number,
        supplierId: o.supplierId,
        supplierName: o.supplierName,
        warehouseId: o.warehouseId,
        warehouseName: o.warehouseName,
        status: o.status,
        total: String(o.total),
        paid: String(o.paid),
        expectedAt: o.expectedAt ? String(o.expectedAt) : null,
        receivedAt: o.receivedAt ? String(o.receivedAt) : null,
        notes: o.notes,
        createdAt: String(o.createdAt),
      }))}
      warehouses={inventory.warehouses.filter((warehouse) => warehouse.status === "active").map((warehouse) => ({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        isDefault: warehouse.isDefault,
      }))}
      lowStock={data.lowStock.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
        lowStock: p.lowStock,
        cost: String(p.cost),
      }))}
    />
  );
}
