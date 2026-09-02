import { NextRequest, NextResponse } from "next/server";
import { requireApiCapability } from "@/server/apiAuth";
import { requestIp } from "@/server/request";
import {
  WorkforceError,
  cancelApproval,
  createApproval,
  createWorkforceTask,
  deleteWorkforceTask,
  reviewApproval,
  saveEmployeeKpi,
  saveEmployeeProfile,
  transitionWorkforceTask,
} from "@/server/workforce";

export const dynamic = "force-dynamic";

type WorkforceRequest = {
  action?: unknown;
  data?: unknown;
};

function dataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: NextRequest) {
  const auth = await requireApiCapability(req, "workforce:read", { write: true });
  if (!auth.ok) return auth.response;

  let body: WorkforceRequest;
  try {
    body = (await req.json()) as WorkforceRequest;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const data = dataRecord(body.data);
  const ip = requestIp(req);

  try {
    switch (action) {
      case "createTask": {
        const task = await createWorkforceTask(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: task.id });
      }
      case "transitionTask": {
        const task = await transitionWorkforceTask(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: task.id, status: task.status });
      }
      case "deleteTask": {
        const task = await deleteWorkforceTask(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: task.id });
      }
      case "saveEmployeeProfile": {
        const profile = await saveEmployeeProfile(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: profile.id });
      }
      case "saveEmployeeKpi": {
        const kpi = await saveEmployeeKpi(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: kpi.id });
      }
      case "createApproval": {
        const approval = await createApproval(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: approval.id });
      }
      case "reviewApproval": {
        const approval = await reviewApproval(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: approval.id, status: approval.status });
      }
      case "cancelApproval": {
        const approval = await cancelApproval(auth.user, data, ip);
        return NextResponse.json({ ok: true, id: approval.id, status: approval.status });
      }
      default:
        return NextResponse.json({ error: "Неизвестная операция команды" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof WorkforceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Не удалось выполнить операцию команды" }, { status: 500 });
  }
}
