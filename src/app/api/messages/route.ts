import { NextRequest, NextResponse } from "next/server";
import { addMessage, getMessages, markThreadRead } from "@/server/queries";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

function positiveId(value: string | null) {
  const id = Number(value ?? 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "chat:read");
  if (!auth.ok) return auth.response;

  const id = positiveId(req.nextUrl.searchParams.get("customerId"));
  if (!id) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const messages = await getMessages(id);
  await markThreadRead(id);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "chat:write", { write: true });
  if (!auth.ok) return auth.response;

  let body: { customerId?: unknown; body?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as { customerId?: unknown; body?: unknown; kind?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const customerId = typeof body.customerId === "number" && Number.isSafeInteger(body.customerId) && body.customerId > 0
    ? body.customerId
    : null;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const kind = typeof body.kind === "string" && ["text", "image", "video", "file", "invoice"].includes(body.kind)
    ? body.kind
    : "text";

  if (!customerId || !text || text.length > 4_000) {
    return NextResponse.json({ error: "invalid message" }, { status: 400 });
  }

  const message = await addMessage(customerId, text, true, kind);
  return NextResponse.json({ message });
}
