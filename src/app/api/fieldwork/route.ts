import { NextRequest, NextResponse } from "next/server";
import { requireApiCapability } from "@/server/apiAuth";
import { requestIp } from "@/server/request";
import { FieldworkError, recordAgentVisit, saveAgentRoute } from "@/server/fieldwork";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type FieldworkBody = { action?: unknown; data?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "fieldwork:write", { write: true });
  if (!auth.ok) return auth.response;

  let body: FieldworkBody;
  try {
    body = (await req.json()) as FieldworkBody;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const data = record(body.data);
  const ip = requestIp(req);

  try {
    switch (action) {
      case "recordVisit": {
        const visit = await recordAgentVisit(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: visit.id, status: visit.status, duplicate: visit.duplicate === true });
      }
      case "saveRoute": {
        const route = await saveAgentRoute(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: route.id });
      }
      default:
        return NextResponse.json({ error: "Неизвестная операция полевого модуля" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof FieldworkError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось выполнить полевую операцию" }, { status: 500 });
  }
}
