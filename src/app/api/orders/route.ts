import { NextRequest, NextResponse } from "next/server";
import { createOrderQuick, createMultiOrder } from "@/server/queries";
import { revalidatePath } from "next/cache";
import { requireApiCapability } from "@/server/apiAuth";

const PAYMENT_METHODS = ["cash", "click", "payme", "uzum", "bank", "crm"] as const;
const MAX_QTY = 100_000;

type OrderItemInput = { productId?: unknown; qty?: unknown };

function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "orders:create", { write: true });
  if (!auth.ok) return auth.response;

  let body: { customerId?: unknown; productId?: unknown; qty?: unknown; payment?: unknown; items?: unknown };
  try {
    body = (await req.json()) as { customerId?: unknown; productId?: unknown; qty?: unknown; payment?: unknown; items?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const customerId = positiveInteger(body.customerId);
  if (!customerId) return NextResponse.json({ error: "Выберите клиента" }, { status: 400 });

  if (Array.isArray(body.items) && body.items.length > 0) {
    if (body.items.length > 100) return NextResponse.json({ error: "В заказе может быть не более 100 позиций" }, { status: 400 });
    const items = body.items.map((item) => {
      const input = item as OrderItemInput;
      return { productId: positiveInteger(input.productId), qty: positiveInteger(input.qty, MAX_QTY) };
    });
    if (items.some((item) => !item.productId || !item.qty)) {
      return NextResponse.json({ error: "Некорректные позиции заказа" }, { status: 400 });
    }

    const order = await createMultiOrder(
      customerId,
      items.map((item) => ({ productId: item.productId!, qty: item.qty! })),
      auth.user.name,
    );
    revalidatePath("/orders");
    return NextResponse.json({ order });
  }

  const productId = positiveInteger(body.productId);
  const qty = positiveInteger(body.qty ?? 1, MAX_QTY);
  const payment = typeof body.payment === "string" && (PAYMENT_METHODS as readonly string[]).includes(body.payment)
    ? body.payment
    : "click";
  if (!productId || !qty) return NextResponse.json({ error: "Выберите товар и количество" }, { status: 400 });

  const order = await createOrderQuick(customerId, productId, qty, payment, auth.user.name);
  revalidatePath("/orders");
  return NextResponse.json({ order });
}
