import { NextRequest, NextResponse } from "next/server";
import { setOrderStatus } from "@/server/queries";
import { InventoryError } from "@/server/inventory";
import { revalidatePath } from "next/cache";
import { requireApiCapability } from "@/server/apiAuth";
import { ORDER_STATUSES } from "@/shared/lib/format";

const ORDER_STATUS_KEYS = new Set(ORDER_STATUSES.map((status) => status.key));

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiCapability(req, "orders:update", { write: true });
  if (!auth.ok) return auth.response;
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid order id" }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.status !== "string" || !ORDER_STATUS_KEYS.has(body.status)) {
    return NextResponse.json({ error: "Недопустимый статус заказа" }, { status: 400 });
  }

  try {
    const order = await setOrderStatus(id, body.status, auth.user.name, auth.user.id);
    if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    revalidatePath("/orders");
    revalidatePath(`/orders/${id}`);
    revalidatePath("/warehouse");
    revalidatePath("/products");
    revalidatePath("/finance");
    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof InventoryError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить заказ" }, { status: 400 });
  }
}
