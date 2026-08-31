import { NextRequest, NextResponse } from "next/server";
import { getAgentMessages, sendAgentMessage } from "@/server/queries";
import { requireApiCapability } from "@/server/apiAuth";

export const dynamic = "force-dynamic";

function canAccessAgent(user: { role: string; agentId: number | null }, agentId: number) {
  return user.role !== "agent" || user.agentId === agentId;
}

export async function GET(req: NextRequest) {
  const auth = await requireApiCapability(req, "agent-messages:read");
  if (!auth.ok) return auth.response;

  const agentId = Number(req.nextUrl.searchParams.get("agentId") ?? 0);
  if (!Number.isSafeInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }
  if (!canAccessAgent(auth.user, agentId)) {
    return NextResponse.json({ error: "Нет доступа к переписке другого агента" }, { status: 403 });
  }

  const messages = await getAgentMessages(agentId);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "agent-messages:write", { write: true });
  if (!auth.ok) return auth.response;

  let body: { agentId?: unknown; body?: unknown };
  try {
    body = (await req.json()) as { agentId?: unknown; body?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const agentId = typeof body.agentId === "number" && Number.isSafeInteger(body.agentId) ? body.agentId : 0;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!agentId || !text || text.length > 4_000) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!canAccessAgent(auth.user, agentId)) {
    return NextResponse.json({ error: "Нет доступа к переписке другого агента" }, { status: 403 });
  }

  const message = await sendAgentMessage(agentId, text, auth.user.role !== "agent");
  return NextResponse.json({ message });
}
