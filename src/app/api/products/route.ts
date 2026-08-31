import { NextRequest, NextResponse } from "next/server";
import { upsertProduct, deleteProduct, adjustStock, getProducts } from "@/server/queries";
import { revalidatePath } from "next/cache";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

interface ProductPayload {
  id?: unknown;
  name?: unknown;
  sku?: unknown;
  price?: unknown;
  cost?: unknown;
  stock?: unknown;
  volume?: unknown;
  image?: unknown;
  description?: unknown;
  categoryId?: unknown;
  status?: unknown;
}

function positiveId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function decimal(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value.trim())) return value.trim();
  return undefined;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "products:read");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ products: await getProducts() });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "products:manage", { write: true });
  if (!auth.ok) return auth.response;

  let body: ProductPayload;
  try {
    body = (await req.json()) as ProductPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = body.id === undefined ? undefined : positiveId(body.id);
  if (body.id !== undefined && !id) return NextResponse.json({ error: "invalid product id" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : undefined;
  if (!id && !name) return NextResponse.json({ error: "Укажите название товара" }, { status: 400 });

  const payload: {
    id?: number;
    name?: string;
    sku?: string;
    price?: string;
    cost?: string;
    stock?: number;
    volume?: string;
    image?: string;
    description?: string;
    categoryId?: number;
    status?: string;
  } = {};
  if (id) payload.id = id;
  if (name) payload.name = name;
  if (typeof body.sku === "string") payload.sku = body.sku.trim().slice(0, 100);
  const price = decimal(body.price);
  const cost = decimal(body.cost);
  if (body.price !== undefined && price === undefined) return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
  if (body.cost !== undefined && cost === undefined) return NextResponse.json({ error: "Некорректная себестоимость" }, { status: 400 });
  if (price !== undefined) payload.price = price;
  if (cost !== undefined) payload.cost = cost;
  if (typeof body.stock === "number" && Number.isSafeInteger(body.stock) && body.stock >= 0) payload.stock = body.stock;
  else if (body.stock !== undefined) return NextResponse.json({ error: "Некорректный остаток" }, { status: 400 });
  if (typeof body.volume === "string") payload.volume = body.volume.trim().slice(0, 50);
  if (typeof body.image === "string") payload.image = body.image.slice(0, 7_000_000);
  if (typeof body.description === "string") payload.description = body.description.trim().slice(0, 10_000);
  if (body.categoryId !== undefined) {
    const categoryId = positiveId(body.categoryId);
    if (!categoryId) return NextResponse.json({ error: "Некорректная категория" }, { status: 400 });
    payload.categoryId = categoryId;
  }
  if (typeof body.status === "string" && ["active", "inactive", "draft"].includes(body.status)) payload.status = body.status;
  else if (body.status !== undefined) return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });

  const product = await upsertProduct(payload);
  revalidatePath("/products");
  revalidatePath("/warehouse");
  return NextResponse.json({ product });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireApiCapability(req, "products:manage", { write: true });
  if (!auth.ok) return auth.response;

  const id = Number(req.nextUrl.searchParams.get("id") ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteProduct(id);
  revalidatePath("/products");
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiCapability(req, "products:manage", { write: true });
  if (!auth.ok) return auth.response;

  let body: { productId?: unknown; kind?: unknown; qty?: unknown; note?: unknown };
  try {
    body = (await req.json()) as { productId?: unknown; kind?: unknown; qty?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const productId = positiveId(body.productId);
  const qty = typeof body.qty === "number" && Number.isSafeInteger(body.qty) && body.qty > 0 && body.qty <= 100_000 ? body.qty : null;
  const kind = typeof body.kind === "string" && ["in", "out", "transfer", "writeoff"].includes(body.kind) ? body.kind : null;
  if (!productId || !qty || !kind) return NextResponse.json({ error: "Некорректная корректировка склада" }, { status: 400 });

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "Корректировка склада";
  await adjustStock(productId, kind, qty, note);
  revalidatePath("/warehouse");
  revalidatePath("/products");
  return NextResponse.json({ ok: true });
}
