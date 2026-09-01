import type { Metadata } from "next";
import { requireAccess } from "@/server/guard";
import { getProducts } from "@/server/queries";
import { getAgentRoutes, getFieldworkVisits } from "@/server/fieldwork";
import { db } from "@/db";
import { redirect } from "next/navigation";
import { AgentPortalClient } from "./AgentPortalClient";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "DELIS Agent Mobile",
  manifest: "/manifest-agent.json",
};

export default async function AgentPortalPage() {
  const user = await requireAccess("/agent-portal");
  if (user.role !== "agent") redirect("/");

  // An agent account must be linked by Owner to exactly one agent profile.
  if (!user.agentId) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h2 className="text-xl font-bold">Профиль агента ещё не привязан</h2>
          <p className="muted text-sm mt-1">Обратитесь к Owner: он привяжет ваш рабочий аккаунт к профилю агента.</p>
        </div>
      </div>
    );
  }

  const [agent] = await db.select().from(s.agents).where(eq(s.agents.id, user.agentId)).limit(1);
  if (!agent) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h2 className="text-xl font-bold">Профиль агента не найден</h2>
          <p className="muted text-sm mt-1">Обратитесь к Owner для проверки привязки аккаунта.</p>
        </div>
      </div>
    );
  }

  const [products, visits, routePlan] = await Promise.all([
    getProducts(),
    getFieldworkVisits(user, agent.id),
    getAgentRoutes(user),
  ]);

  return (
    <AgentPortalClient
      agent={{
        id: agent.id,
        name: agent.name,
        phone: agent.phone,
        telegram: agent.telegram,
        email: agent.email,
        region: agent.region,
        route: agent.route,
        plan: agent.plan,
        fact: agent.fact,
        commission: agent.commission,
        visits: agent.visits,
        avatarColor: agent.avatarColor,
      }}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        price: String(p.price),
        cost: String(p.cost),
        stock: p.stock,
        image: p.image,
        images: Array.isArray(p.images) ? p.images : [],
        category: p.category ?? "Auto Care",
        volume: p.volume ?? "1 L",
        isPopular: Boolean(p.isPopular),
        isNew: Boolean(p.isNew),
        description: p.description ?? "",
      }))}
      visits={visits.map((visit) => ({
        id: visit.id,
        storeName: visit.storeName,
        storeAddress: visit.storeAddress,
        gpsCoords: visit.gpsCoords,
        latitude: visit.latitude === null ? null : String(visit.latitude),
        longitude: visit.longitude === null ? null : String(visit.longitude),
        accuracyMeters: visit.accuracyMeters === null ? null : String(visit.accuracyMeters),
        locationCapturedAt: visit.locationCapturedAt ? String(visit.locationCapturedAt) : null,
        routeStopId: visit.routeStopId,
        status: visit.status,
        orderTotal: String(visit.orderTotal),
        notes: visit.notes,
        photos: visit.photos || [],
        source: visit.source,
        visitedAt: String(visit.visitedAt),
      }))}
      routes={routePlan.routes.map((route) => ({
        id: route.id,
        title: route.title,
        routeDate: route.routeDate,
        status: route.status,
        notes: route.notes,
        stops: route.stops.map((stop) => ({
          id: stop.id,
          sequence: stop.sequence,
          storeName: stop.storeName,
          storeAddress: stop.storeAddress,
          status: stop.status,
          notes: stop.notes,
        })),
      }))}
    />
  );
}
