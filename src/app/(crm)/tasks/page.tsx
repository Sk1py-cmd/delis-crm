import { requireAccess } from "@/server/guard";
import { canManageWorkforce, getTaskAssignees, getWorkforceTasks } from "@/server/workforce";
import { TasksClient } from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const viewer = await requireAccess("/tasks");
  const [tasks, team] = await Promise.all([getWorkforceTasks(viewer), getTaskAssignees(viewer)]);

  return (
    <TasksClient
      viewer={{ id: viewer.id, name: viewer.name, role: viewer.role }}
      canManage={canManageWorkforce(viewer.role)}
      tasks={tasks.map((task) => ({
        ...task,
        dueAt: task.dueAt ? String(task.dueAt) : null,
        completedAt: task.completedAt ? String(task.completedAt) : null,
        updatedAt: String(task.updatedAt),
        createdAt: String(task.createdAt),
      }))}
      team={team}
    />
  );
}
