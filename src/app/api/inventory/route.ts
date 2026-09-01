import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireApiCapability } from "@/server/apiAuth";
import { requestIp } from "@/server/request";
import {
  InventoryError,
  adjustWarehouseStock,
  completeInventoryCount,
  createWarehouse,
  getInventoryData,
  transferWarehouseStock,
} from "@/server/inventory";

export const dynamic = "force-dynamic";

type InventoryBody = { action?: unknown; data?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "inventory:read");
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await getInventoryData(auth.user));
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось загрузить складские данные" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "inventory:manage", { write: true });
  if (!auth.ok) return auth.response;

  let body: InventoryBody;
  try {
    body = (await req.json()) as InventoryBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const data = record(body.data);
  const ip = requestIp(req);

  try {
    switch (action) {
      case "createWarehouse": {
        const warehouse = await createWarehouse(auth.user, data, ip);
        revalidatePath("/warehouse");
        return NextResponse.json({ ok: true, warehouse });
      }
      case "adjustStock": {
        const result = await adjustWarehouseStock(auth.user, data, ip);
        revalidatePath("/warehouse");
        revalidatePath("/products");
        return NextResponse.json({ ok: true, available: result.available, movementId: result.movementId });
      }
      case "transferStock": {
        const result = await transferWarehouseStock(auth.user, data, ip);
        revalidatePath("/warehouse");
        revalidatePath("/products");
        return NextResponse.json({ ok: true, available: result.available, movementId: result.movementId });
      }
      case "completeInventoryCount": {
        const result = await completeInventoryCount(auth.user, data, ip);
        revalidatePath("/warehouse");
        revalidatePath("/products");
        return NextResponse.json({ ok: true, ...result });
      }
      default:
        return NextResponse.json({ error: "Неизвестная складская операция" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось выполнить складскую операцию" }, { status: 500 });
  }
}
