import { getUsers, getActivity, getAgents } from "@/server/queries";
import { getSessionUser } from "@/server/auth";
import { requireAccess } from "@/server/guard";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireAccess("/users");
  const [users, activity, session, agents] = await Promise.all([getUsers(), getActivity(), getSessionUser(), getAgents()]);

  return (
    <UsersClient
      currentRole={session?.role ?? "manager"}
      users={users.map((user) => ({
        id: user.id,
        name: user.name,
        login: user.login,
        email: user.email,
        role: user.role,
        status: user.status,
        agentId: user.agentId,
        lastIp: user.lastIp,
        device: user.device,
        lastLoginAt: String(user.lastLoginAt),
      }))}
      agents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        region: agent.region,
        email: agent.email,
      }))}
      audit={activity.map((activityEntry) => ({
        id: activityEntry.id,
        actor: activityEntry.actor,
        action: activityEntry.action,
        entity: activityEntry.entity,
        createdAt: String(activityEntry.createdAt),
      }))}
    />
  );
}
