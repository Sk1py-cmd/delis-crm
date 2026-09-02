import { db } from "@/db";
import { ensureSeed } from "@/db/seed";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Readiness means the database is reachable and the idempotent bootstrap has completed.
    await ensureSeed();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
