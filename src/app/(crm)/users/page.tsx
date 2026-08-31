import { getActivity, getAgents } from "@/server/queries";
import { requireAccess } from "@/server/guard";
import { getEmployeeDirectory } from "@/server/workforce";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const viewer = await requireAccess("/users");
  const [users, activity, agents] = await Promise.all([getEmployeeDirectory(viewer), getActivity(), getAgents()]);

  return (
    <UsersClient
      currentRole={viewer.role}
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
        profile: user.profile
          ? {
            position: user.profile.position,
            department: user.profile.department,
            phone: user.profile.phone,
            hireDate: user.profile.hireDate ? user.profile.hireDate.toISOString().slice(0, 10) : null,
            notes: user.profile.notes,
            avatarColor: user.profile.avatarColor,
          }
          : null,
        taskStats: user.taskStats,
        pendingApprovals: user.pendingApprovals,
        kpiCompletion: user.kpiCompletion,
        kpiCount: user.kpiCount,
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
