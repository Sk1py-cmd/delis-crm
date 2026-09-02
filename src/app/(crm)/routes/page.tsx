import { requireAccess } from "@/server/guard";
import { getAgents } from "@/server/queries";
import { getAgentRoutes } from "@/server/fieldwork";
import { RoutesClient } from "./RoutesClient";

export const dynamic = "force-dynamic";

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const viewer = await requireAccess("/routes");
  const { date } = await searchParams;
  const [routePlan, agents] = await Promise.all([getAgentRoutes(viewer, date), getAgents()]);

  return (
    <RoutesClient
      routeDate={routePlan.routeDate}
      agents={agents.filter((agent) => agent.status === "active").map((agent) => ({
        id: agent.id,
        name: agent.name,
        region: agent.region,
        avatarColor: agent.avatarColor,
      }))}
      routes={routePlan.routes.map((route) => ({
        ...route,
        updatedAt: String(route.updatedAt),
        createdAt: String(route.createdAt),
        stops: route.stops.map((stop) => ({
          ...stop,
          plannedLatitude: stop.plannedLatitude === null ? null : String(stop.plannedLatitude),
          plannedLongitude: stop.plannedLongitude === null ? null : String(stop.plannedLongitude),
          completedAt: stop.completedAt ? String(stop.completedAt) : null,
        })),
      }))}
    />
  );
}
