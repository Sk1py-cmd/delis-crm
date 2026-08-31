import { requireAccess } from "@/server/guard";
import { getKpiOverview } from "@/server/workforce";
import { KpiClient } from "./KpiClient";

export const dynamic = "force-dynamic";

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const viewer = await requireAccess("/kpi");
  const { period } = await searchParams;
  const overview = await getKpiOverview(viewer, period);

  return (
    <KpiClient
      period={overview.period}
      canManage={overview.canManage}
      people={overview.people.map((person) => ({
        ...person,
        kpis: person.kpis.map((kpi) => ({ ...kpi, updatedAt: String(kpi.updatedAt) })),
      }))}
    />
  );
}
