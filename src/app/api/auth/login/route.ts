import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import { verifyPassword } from "@/server/password";
import { COOKIE } from "@/server/auth";
import { canAttemptLogin, clearLoginAttempts, registerFailedLogin } from "@/server/loginRateLimit";
import { rejectForeignWrite, requestIp } from "@/server/request";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const foreignWrite = rejectForeignWrite(req);
  if (foreignWrite) return foreignWrite;

  try {
    await ensureSeed();
  } catch {
    return NextResponse.json(
      { error: "CRM ещё не настроена. Проверьте OWNER_LOGIN и OWNER_PASSWORD в переменных окружения." },
      { status: 503 },
    );
  }

  let body: { login?: string; password?: string };
  try {
    body = (await req.json()) as { login?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const login = (body.login ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!login || !password) {
    return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });
  }

  const attemptKey = `${requestIp(req)}:${login}`;
  const attempt = canAttemptLogin(attemptKey);
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds ?? 60) } },
    );
  }

  const rows = await db
    .select()
    .from(s.users)
    .where(and(sql`lower(${s.users.login}) = ${login}`, eq(s.users.status, "active")))
    .limit(1);
  const user = rows[0];

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    registerFailedLogin(attemptKey);
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  clearLoginAttempts(attemptKey);
  await db.delete(s.sessions).where(sql`${s.sessions.expiresAt} <= now()`);

  const token = crypto.randomUUID();
  const device = (req.headers.get("user-agent") ?? "").slice(0, 160);
  await db.insert(s.sessions).values({
    token,
    userId: user.id,
    device,
    expiresAt: new Date(Date.now() + 30 * 86400_000),
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    maxAge: 30 * 86400,
  });
  await db
    .update(s.users)
    .set({ lastLoginAt: new Date(), lastIp: requestIp(req), device })
    .where(eq(s.users.id, user.id));
  await db.insert(s.activity).values({ actor: user.name, action: "вошёл в систему", entity: "DELIS CRM" });

  return NextResponse.json({ ok: true, name: user.name, role: user.role });
}
