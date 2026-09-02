import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITS: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  application: 10 * 1024 * 1024,
};

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);

function fileKind(mime: string): "image" | "video" | "pdf" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "upload:write", { write: true });
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Некорректная форма загрузки" }, { status: 400 });
  }

  const rawFile = form.get("file");
  const file = rawFile instanceof File ? rawFile : null;
  const productId = Number(form.get("productId") ?? 0);
  if (!file) return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Поддерживаются JPG, PNG, WebP, GIF, MP4, WebM и PDF" }, { status: 415 });
  }

  const kind = fileKind(file.type);
  const limitKey = file.type.split("/")[0];
  const limit = LIMITS[limitKey] ?? 5 * 1024 * 1024;
  if (file.size <= 0 || file.size > limit) {
    return NextResponse.json(
      { error: `Файл слишком большой. Максимум для ${kind === "video" ? "видео" : kind === "pdf" ? "PDF" : "фото"}: ${Math.round(limit / 1024 / 1024)} MB` },
      { status: 413 },
    );
  }

  const bytes = await file.arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${file.type};base64,${b64}`;

  if (productId && kind === "image") {
    if (!Number.isSafeInteger(productId) || productId < 1) {
      return NextResponse.json({ error: "Некорректный товар" }, { status: 400 });
    }
    const [prod] = await db.select({ images: s.products.images }).from(s.products).where(eq(s.products.id, productId));
    if (!prod) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
    const existing = Array.isArray(prod.images) ? prod.images : [];
    const images = [...existing.filter(Boolean), dataUrl].slice(-6);
    await db.update(s.products).set({ image: images[0], images }).where(eq(s.products.id, productId));
  }

  return NextResponse.json({
    ok: true,
    url: dataUrl,
    kind,
    name: file.name.slice(0, 200),
    size: file.size,
    mime: file.type,
  });
}
