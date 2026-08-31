import { requireAccess } from "@/server/guard";
import { canManageWorkforce, getApprovals } from "@/server/workforce";
import { ApprovalsClient } from "./ApprovalsClient";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const viewer = await requireAccess("/approvals");
  const items = await getApprovals(viewer);

  return (
    <ApprovalsClient
      viewerId={viewer.id}
      canManage={canManageWorkforce(viewer.role)}
      items={items.map((item) => ({
        id: item.id,
        requesterUserId: item.requesterUserId,
        requester: item.requesterName,
        requesterLogin: "",
        requesterRole: "",
        category: item.type,
        subject: item.title,
        description: item.description,
        amount: Number(item.amount),
        priority: item.priority,
        status: item.status,
        reviewerUserId: item.reviewerUserId,
        reviewer: item.reviewerName,
        decisionComment: item.decisionNote,
        reviewedAt: item.reviewedAt ? String(item.reviewedAt) : null,
        createdAt: String(item.createdAt),
        updatedAt: String(item.updatedAt),
      }))}
    />
  );
}
