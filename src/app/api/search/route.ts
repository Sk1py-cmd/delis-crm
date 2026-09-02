import { NextRequest, NextResponse } from "next/server";
import { search } from "@/server/queries";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "search:read");
  if (!auth.ok) return auth.response;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [] });
  if (q.length > 120) return NextResponse.json({ error: "query too long" }, { status: 400 });

  const hits = await search(q);
  return NextResponse.json({ hits });
}
