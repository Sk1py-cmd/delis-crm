import { NextRequest, NextResponse } from "next/server";

function configuredWriteOrigins(): Set<string> {
  return new Set(
    (process.env.ALLOWED_WRITE_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .flatMap((value) => {
        try {
          return [new URL(value).origin];
        } catch {
          return [];
        }
      }),
  );
}

/**
 * Reject cross-site writes. Requests without an Origin header are allowed for
 * non-browser clients such as health checks and server-to-server automation.
 *
 * ALLOWED_WRITE_ORIGINS is intentionally an exact, comma-separated allowlist
 * for deployments whose reverse proxy cannot preserve the public host/proto.
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
    const requestOrigin = new URL(origin).origin;
    // This exact allowlist is for a known public proxy origin. Check it before
    // parsing proxy headers, which may be unavailable or non-standard there.
    if (configuredWriteOrigins().has(requestOrigin)) return null;

    const expectedOrigin = new URL(`${protocol}://${host}`).origin;
    if (!host || !protocol || requestOrigin !== expectedOrigin) {
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
