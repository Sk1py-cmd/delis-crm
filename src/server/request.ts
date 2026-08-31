import { NextRequest, NextResponse } from "next/server";

/**
 * Reject cross-site writes. Requests without an Origin header are allowed for
 * non-browser clients such as health checks and server-to-server automation.
 */
export function rejectForeignWrite(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;

  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host ?? "")
    .split(",")[0]
    .trim();
  const protocol = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", ""))
    .split(",")[0]
    .trim();

  try {
    const expectedOrigin = new URL(`${protocol}://${host}`).origin;
    if (!host || !protocol || new URL(origin).origin !== expectedOrigin) {
      return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }

  return null;
}

export function requestIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
