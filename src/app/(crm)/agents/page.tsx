import { requireAccess } from "@/server/guard";
import { getAgents, getProducts } from "@/server/queries";
import { getFieldworkVisits } from "@/server/fieldwork";
import { AgentsClient } from "./AgentsClient";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const viewer = await requireAccess("/agents");
  const [rows, visits, products] = await Promise.all([
    getAgents(),
    getFieldworkVisits(viewer),
    getProducts(),
  ]);

  return (
    <AgentsClient
      agents={rows.map((agent) => ({
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
      }))}
      visits={visits.map((visit) => ({
        id: visit.id,
        agentId: visit.agentId,
        agentName: visit.agentName,
        storeName: visit.storeName,
        storeAddress: visit.storeAddress,
        gpsCoords: visit.gpsCoords,
        latitude: visit.latitude === null ? null : String(visit.latitude),
        longitude: visit.longitude === null ? null : String(visit.longitude),
        status: visit.status,
        orderTotal: String(visit.orderTotal),
        notes: visit.notes,
        photos: visit.photos ?? [],
        visitedAt: String(visit.visitedAt),
      }))}
      products={products.map((product) => ({
        id: product.id,
        name: product.name,
        price: String(product.price),
        stock: product.stock,
        image: product.image,
      }))}
    />
  );
}
