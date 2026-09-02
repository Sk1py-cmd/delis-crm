import { NextRequest, NextResponse } from "next/server";
import { getCompanyOS } from "@/server/queries";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "company:read");
  if (!auth.ok) return auth.response;

  const os = await getCompanyOS();
  return NextResponse.json({
    ok: true,
    modules: os.modules,
    counts: os.counts,
    sync: os.sync.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      entity: e.entity,
      action: e.action,
      status: e.status,
      payload: e.payload,
      createdAt: e.createdAt,
    })),
  });
}
