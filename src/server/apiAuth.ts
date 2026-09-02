import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/server/auth";
import {
  canManageAction,
  hasCapability,
  isManageAction,
  type Capability,
  type ManageAction,
} from "@/shared/config/access";
import { rejectForeignWrite } from "@/server/request";

type Authorized = { ok: true; user: SessionUser };
type Rejected = { ok: false; response: NextResponse };
export type ApiAuthorization = Authorized | Rejected;

function unauthorized(): Rejected {
  return { ok: false, response: NextResponse.json({ error: "Требуется авторизация" }, { status: 401 }) };
}

function forbidden(): Rejected {
  return { ok: false, response: NextResponse.json({ error: "Недостаточно прав для этой операции" }, { status: 403 }) };
}

export async function requireApiCapability(
  req: NextRequest,
  capability: Capability,
  options: { write?: boolean } = {},
): Promise<ApiAuthorization> {
  if (options.write) {
    const foreignWrite = rejectForeignWrite(req);
    if (foreignWrite) return { ok: false, response: foreignWrite };
  }

  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!hasCapability(user.role, capability)) return forbidden();
  return { ok: true, user };
}

export async function requireManageAction(
  req: NextRequest,
  action: string,
): Promise<ApiAuthorization & { action?: ManageAction }> {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return { ok: false, response: foreignWrite };

  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isManageAction(action)) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Неизвестное действие: ${action}` }, { status: 400 }),
    };
  }
  if (!canManageAction(user.role, action)) return forbidden();

  return { ok: true, user, action };
}
