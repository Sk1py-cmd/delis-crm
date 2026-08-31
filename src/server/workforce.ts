import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { ensureSeed } from "@/db/seed";
import type { SessionUser } from "@/server/auth";
import { recordAuditEvent } from "@/server/audit";
import {
  APPROVAL_DECISIONS,
  APPROVAL_PRIORITIES,
  APPROVAL_TYPES,
  KPI_METRICS,
  TASK_LINK_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  canAdvanceOwnTask,
  currentKpiPeriod,
  isApprovalDecision,
  isApprovalPriority,
  isApprovalType,
  isKpiMetric,
  isKpiPeriod,
  isTaskLinkType,
  isTaskPriority,
  isTaskStatus,
  isWorkforceManager,
} from "@/shared/config/workforce";

export class WorkforceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WorkforceError";
  }
}

type Input = Record<string, unknown>;

export function canManageWorkforce(role: string) {
  return isWorkforceManager(role);
}

export function canManageEmployeeProfiles(role: string) {
  return role === "owner";
}

function shortText(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

function requiredText(value: unknown, label: string, max: number) {
  const result = shortText(value, max);
  if (!result) throw new WorkforceError(`Укажите ${label}`);
  return result;
}

function positiveId(value: unknown, label = "объект") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new WorkforceError(`Некорректный ${label}`);
  }
  return value;
}

function optionalId(value: unknown, label = "объект") {
  if (value === undefined || value === null || value === "") return null;
  return positiveId(value, label);
}

function optionalDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new WorkforceError(`Некорректная дата: ${label}`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new WorkforceError(`Некорректная дата: ${label}`);
  return date;
}

function nonNegativeNumber(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000_000) {
    throw new WorkforceError(`Некорректное значение: ${label}`);
  }
  return parsed;
}

function numeric(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskStatus(value: unknown) {
  const status = shortText(value, 32);
  if (!isTaskStatus(status)) throw new WorkforceError("Некорректный статус задачи");
  return status;
}

async function activeUser(userId: number) {
  const [user] = await db
    .select({ id: s.users.id, name: s.users.name, login: s.users.login, role: s.users.role, status: s.users.status })
    .from(s.users)
    .where(and(eq(s.users.id, userId), eq(s.users.status, "active")))
    .limit(1);
  if (!user) throw new WorkforceError("Сотрудник не найден или заблокирован", 404);
  return user;
}

function assertWorkforceManager(viewer: SessionUser) {
  if (!isWorkforceManager(viewer.role)) {
    throw new WorkforceError("Недостаточно прав для управления командой", 403);
  }
}

/** A manager sees the board; staff get only tasks they own or created. */
export async function getWorkforceTasks(viewer: SessionUser) {
  await ensureSeed();
  const visibility = isWorkforceManager(viewer.role)
    ? sql`1=1`
    : or(eq(s.tasks.assigneeUserId, viewer.id), eq(s.tasks.createdByUserId, viewer.id));
  return db
    .select({
      id: s.tasks.id,
      title: s.tasks.title,
      description: s.tasks.description,
      assignee: s.tasks.assignee,
      assigneeUserId: s.tasks.assigneeUserId,
      priority: s.tasks.priority,
      status: s.tasks.status,
      linkType: s.tasks.linkType,
      linkLabel: s.tasks.linkLabel,
      dueAt: s.tasks.dueAt,
      completedAt: s.tasks.completedAt,
      createdBy: s.tasks.createdBy,
      createdByUserId: s.tasks.createdByUserId,
      updatedAt: s.tasks.updatedAt,
      createdAt: s.tasks.createdAt,
    })
    .from(s.tasks)
    .where(visibility)
    .orderBy(desc(s.tasks.updatedAt), desc(s.tasks.createdAt))
    .limit(250);
}

/** Non-managers receive no colleague directory from the task page. */
export async function getTaskAssignees(viewer: SessionUser) {
  await ensureSeed();
  const scope = isWorkforceManager(viewer.role) ? eq(s.users.status, "active") : eq(s.users.id, viewer.id);
  return db
    .select({ id: s.users.id, name: s.users.name, login: s.users.login, role: s.users.role })
    .from(s.users)
    .where(scope)
    .orderBy(s.users.name)
    .limit(250);
}

export async function createWorkforceTask(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  const title = requiredText(input.title, "название задачи", 220);
  const description = shortText(input.description, 4_000);
  const priorityValue = shortText(input.priority, 32, "mid");
  if (!isTaskPriority(priorityValue)) throw new WorkforceError("Некорректный приоритет задачи");
  const linkType = shortText(input.linkType, 32);
  if (!isTaskLinkType(linkType)) throw new WorkforceError("Некорректный тип привязки");
  const linkLabel = shortText(input.linkLabel, 220);
  const dueAt = optionalDate(input.dueAt, "срок");

  const manager = isWorkforceManager(viewer.role);
  const requestedAssigneeId = optionalId(input.assigneeUserId, "исполнитель");
  if (!manager && requestedAssigneeId !== null && requestedAssigneeId !== viewer.id) {
    throw new WorkforceError("Сотрудник может назначить задачу только себе", 403);
  }
  const assignee = await activeUser(manager ? (requestedAssigneeId ?? viewer.id) : viewer.id);

  const [task] = await db
    .insert(s.tasks)
    .values({
      title,
      description,
      assignee: assignee.name,
      assigneeUserId: assignee.id,
      priority: priorityValue,
      status: "todo",
      linkType,
      linkLabel,
      dueAt,
      createdBy: viewer.name,
      createdByUserId: viewer.id,
      updatedAt: new Date(),
    })
    .returning();

  await recordAuditEvent({
    actor: viewer,
    action: "создал задачу команды",
    entity: task.title,
    entityType: "task",
    entityId: task.id,
    eventType: "business",
    severity: "info",
    ip,
    metadata: { assigneeUserId: assignee.id, priority: priorityValue },
  });
  return task;
}

export async function transitionWorkforceTask(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  const taskId = positiveId(input.id, "задача");
  const nextStatus = taskStatus(input.status);
  const [task] = await db.select().from(s.tasks).where(eq(s.tasks.id, taskId)).limit(1);
  if (!task) throw new WorkforceError("Задача не найдена", 404);

  const manager = isWorkforceManager(viewer.role);
  if (!manager && task.assigneeUserId !== viewer.id) {
    throw new WorkforceError("Можно менять статус только своей задачи", 403);
  }
  if (!manager && !canAdvanceOwnTask(task.status, nextStatus)) {
    throw new WorkforceError("Сотрудник может только продвигать свою задачу вперёд", 403);
  }
  if (task.status === nextStatus) return task;

  const now = new Date();
  const [updated] = await db
    .update(s.tasks)
    .set({
      status: nextStatus,
      completedAt: nextStatus === "done" ? now : null,
      updatedAt: now,
    })
    .where(and(eq(s.tasks.id, taskId), eq(s.tasks.status, task.status)))
    .returning();
  if (!updated) throw new WorkforceError("Задача уже изменена другим пользователем", 409);

  await recordAuditEvent({
    actor: viewer,
    action: nextStatus === "done" ? "выполнил задачу" : "изменил статус задачи",
    entity: task.title,
    entityType: "task",
    entityId: taskId,
    eventType: "business",
    severity: "info",
    ip,
    metadata: { previousStatus: task.status, status: nextStatus },
  });
  return updated;
}

export async function deleteWorkforceTask(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertWorkforceManager(viewer);
  const taskId = positiveId(input.id, "задача");
  const [deleted] = await db.delete(s.tasks).where(eq(s.tasks.id, taskId)).returning({ id: s.tasks.id, title: s.tasks.title });
  if (!deleted) throw new WorkforceError("Задача не найдена", 404);

  await recordAuditEvent({
    actor: viewer,
    action: "удалил задачу команды",
    entity: deleted.title,
    entityType: "task",
    entityId: deleted.id,
    eventType: "business",
    severity: "warning",
    ip,
  });
  return deleted;
}

export async function getEmployeeDirectory(viewer: SessionUser) {
  await ensureSeed();
  if (!canManageEmployeeProfiles(viewer.role)) {
    throw new WorkforceError("Карточки сотрудников доступны только Owner", 403);
  }
  const period = currentKpiPeriod();
  const [users, profiles, tasks, kpis, approvals] = await Promise.all([
    db
      .select({
        id: s.users.id,
        name: s.users.name,
        login: s.users.login,
        email: s.users.email,
        role: s.users.role,
        status: s.users.status,
        agentId: s.users.agentId,
        lastIp: s.users.lastIp,
        device: s.users.device,
        lastLoginAt: s.users.lastLoginAt,
      })
      .from(s.users)
      .orderBy(s.users.name),
    db.select().from(s.employeeProfiles),
    db.select({ assigneeUserId: s.tasks.assigneeUserId, status: s.tasks.status }).from(s.tasks),
    db.select().from(s.employeeKpis).where(eq(s.employeeKpis.period, period)),
    db.select({ requesterUserId: s.approvals.requesterUserId, status: s.approvals.status }).from(s.approvals),
  ]);

  const profilesByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
  const taskStats = new Map<number, { total: number; done: number; open: number }>();
  for (const task of tasks) {
    if (!task.assigneeUserId) continue;
    const current = taskStats.get(task.assigneeUserId) ?? { total: 0, done: 0, open: 0 };
    current.total += 1;
    if (task.status === "done") current.done += 1;
    else current.open += 1;
    taskStats.set(task.assigneeUserId, current);
  }
  const pendingApprovals = new Map<number, number>();
  for (const approval of approvals) {
    if (approval.status !== "pending" || !approval.requesterUserId) continue;
    pendingApprovals.set(approval.requesterUserId, (pendingApprovals.get(approval.requesterUserId) ?? 0) + 1);
  }
  const kpisByUser = new Map<number, typeof kpis>();
  for (const kpi of kpis) {
    kpisByUser.set(kpi.userId, [...(kpisByUser.get(kpi.userId) ?? []), kpi]);
  }

  return users.map((user) => {
    const userKpis = kpisByUser.get(user.id) ?? [];
    const measurable = userKpis.filter((kpi) => numeric(kpi.target) > 0);
    const completion = measurable.length
      ? Math.round(measurable.reduce((sum, kpi) => sum + Math.min(100, (numeric(kpi.actual) / numeric(kpi.target)) * 100), 0) / measurable.length)
      : null;
    const profile = profilesByUser.get(user.id);
    return {
      ...user,
      profile: profile
        ? {
          position: profile.position,
          department: profile.department,
          phone: profile.phone,
          hireDate: profile.hireDate,
          notes: profile.notes,
          avatarColor: profile.avatarColor,
          updatedAt: profile.updatedAt,
        }
        : null,
      taskStats: taskStats.get(user.id) ?? { total: 0, done: 0, open: 0 },
      pendingApprovals: pendingApprovals.get(user.id) ?? 0,
      kpiCompletion: completion,
      kpiCount: userKpis.length,
    };
  });
}

export async function saveEmployeeProfile(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  if (!canManageEmployeeProfiles(viewer.role)) {
    throw new WorkforceError("Карточки сотрудников редактирует только Owner", 403);
  }
  const userId = positiveId(input.userId, "сотрудник");
  const [employee] = await db
    .select({ id: s.users.id, name: s.users.name })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!employee) throw new WorkforceError("Сотрудник не найден", 404);
  const position = shortText(input.position, 120);
  const department = shortText(input.department, 120);
  const phone = shortText(input.phone, 48);
  const hireDate = optionalDate(input.hireDate, "дата выхода");
  const notes = shortText(input.notes, 2_000);
  const requestedColor = shortText(input.avatarColor, 16, "#64748b");
  const avatarColor = /^#[a-fA-F0-9]{6}$/.test(requestedColor) ? requestedColor : "#64748b";
  const now = new Date();

  const [profile] = await db
    .insert(s.employeeProfiles)
    .values({ userId, position, department, phone, hireDate, notes, avatarColor, updatedAt: now })
    .onConflictDoUpdate({
      target: s.employeeProfiles.userId,
      set: { position, department, phone, hireDate, notes, avatarColor, updatedAt: now },
    })
    .returning();

  await recordAuditEvent({
    actor: viewer,
    action: "обновил карточку сотрудника",
    entity: employee.name,
    entityType: "employee_profile",
    entityId: userId,
    eventType: "business",
    severity: "info",
    ip,
  });
  return profile;
}

async function kpiPeople(viewer: SessionUser, period: string) {
  const manager = isWorkforceManager(viewer.role);
  const people = await db
    .select({ id: s.users.id, name: s.users.name, login: s.users.login, role: s.users.role, status: s.users.status })
    .from(s.users)
    .where(manager ? eq(s.users.status, "active") : eq(s.users.id, viewer.id))
    .orderBy(s.users.name);
  const ids = people.map((person) => person.id);
  if (ids.length === 0) return [];

  const [profiles, kpis] = await Promise.all([
    db.select().from(s.employeeProfiles).where(inArray(s.employeeProfiles.userId, ids)),
    db
      .select()
      .from(s.employeeKpis)
      .where(and(eq(s.employeeKpis.period, period), inArray(s.employeeKpis.userId, ids)))
      .orderBy(s.employeeKpis.metric),
  ]);
  const profilesByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
  const kpisByUser = new Map<number, typeof kpis>();
  for (const kpi of kpis) {
    kpisByUser.set(kpi.userId, [...(kpisByUser.get(kpi.userId) ?? []), kpi]);
  }

  return people.map((person) => {
    const rows = kpisByUser.get(person.id) ?? [];
    const measurable = rows.filter((row) => numeric(row.target) > 0);
    const completion = measurable.length
      ? Math.round(measurable.reduce((sum, row) => sum + Math.min(100, (numeric(row.actual) / numeric(row.target)) * 100), 0) / measurable.length)
      : null;
    const profile = profilesByUser.get(person.id);
    return {
      ...person,
      profile: profile ? { position: profile.position, department: profile.department, avatarColor: profile.avatarColor } : null,
      completion,
      kpis: rows.map((row) => ({
        id: row.id,
        metric: row.metric,
        label: row.label,
        target: numeric(row.target),
        actual: numeric(row.actual),
        unit: row.unit,
        note: row.note,
        updatedAt: row.updatedAt,
      })),
    };
  });
}

export async function getKpiOverview(viewer: SessionUser, requestedPeriod?: string) {
  await ensureSeed();
  const period = requestedPeriod && isKpiPeriod(requestedPeriod) ? requestedPeriod : currentKpiPeriod();
  return { period, people: await kpiPeople(viewer, period), canManage: isWorkforceManager(viewer.role) };
}

export async function saveEmployeeKpi(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertWorkforceManager(viewer);
  const userId = positiveId(input.userId, "сотрудник");
  const employee = await activeUser(userId);
  const period = shortText(input.period, 7, currentKpiPeriod());
  if (!isKpiPeriod(period)) throw new WorkforceError("Выберите месяц KPI");
  const metric = shortText(input.metric, 32);
  if (!isKpiMetric(metric)) throw new WorkforceError("Некорректная метрика KPI");
  const config = KPI_METRICS.find((item) => item.key === metric);
  const target = nonNegativeNumber(input.target, "цель KPI");
  const actual = nonNegativeNumber(input.actual, "факт KPI");
  const unit = shortText(input.unit, 24, config?.defaultUnit ?? "");
  const note = shortText(input.note, 500);
  const now = new Date();

  const [kpi] = await db
    .insert(s.employeeKpis)
    .values({
      userId,
      period,
      metric,
      label: config?.label ?? metric,
      target: String(target),
      actual: String(actual),
      unit,
      note,
      updatedByUserId: viewer.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [s.employeeKpis.userId, s.employeeKpis.period, s.employeeKpis.metric],
      set: { target: String(target), actual: String(actual), unit, note, label: config?.label ?? metric, updatedByUserId: viewer.id, updatedAt: now },
    })
    .returning();

  await recordAuditEvent({
    actor: viewer,
    action: "обновил KPI сотрудника",
    entity: `${employee.name} · ${config?.label ?? metric}`,
    entityType: "employee_kpi",
    entityId: kpi.id,
    eventType: "business",
    severity: "info",
    ip,
    metadata: { userId, period, metric, target, actual },
  });
  return kpi;
}

export async function getApprovals(viewer: SessionUser) {
  await ensureSeed();
  const visibility = isWorkforceManager(viewer.role) ? sql`1=1` : eq(s.approvals.requesterUserId, viewer.id);
  return db
    .select({
      id: s.approvals.id,
      title: s.approvals.title,
      description: s.approvals.description,
      type: s.approvals.type,
      priority: s.approvals.priority,
      status: s.approvals.status,
      requesterUserId: s.approvals.requesterUserId,
      requesterName: s.approvals.requesterName,
      reviewerUserId: s.approvals.reviewerUserId,
      reviewerName: s.approvals.reviewerName,
      relatedTaskId: s.approvals.relatedTaskId,
      relatedTaskTitle: s.tasks.title,
      amount: s.approvals.amount,
      decisionNote: s.approvals.decisionNote,
      dueAt: s.approvals.dueAt,
      reviewedAt: s.approvals.reviewedAt,
      updatedAt: s.approvals.updatedAt,
      createdAt: s.approvals.createdAt,
    })
    .from(s.approvals)
    .leftJoin(s.tasks, eq(s.approvals.relatedTaskId, s.tasks.id))
    .where(visibility)
    .orderBy(desc(s.approvals.createdAt))
    .limit(200);
}

export async function createApproval(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  const title = requiredText(input.title, "название запроса", 220);
  const description = requiredText(input.description, "обоснование запроса", 4_000);
  const type = shortText(input.type, 32, "other");
  if (!isApprovalType(type)) throw new WorkforceError("Некорректный тип согласования");
  const priority = shortText(input.priority, 32, "normal");
  if (!isApprovalPriority(priority)) throw new WorkforceError("Некорректный приоритет согласования");
  const amount = nonNegativeNumber(input.amount, "сумма");
  const relatedTaskId = optionalId(input.relatedTaskId, "задача");
  const dueAt = optionalDate(input.dueAt, "срок");

  if (relatedTaskId) {
    const [task] = await db
      .select({ assigneeUserId: s.tasks.assigneeUserId, createdByUserId: s.tasks.createdByUserId })
      .from(s.tasks)
      .where(eq(s.tasks.id, relatedTaskId))
      .limit(1);
    if (!task) throw new WorkforceError("Связанная задача не найдена", 404);
    if (!isWorkforceManager(viewer.role) && task.assigneeUserId !== viewer.id && task.createdByUserId !== viewer.id) {
      throw new WorkforceError("Нельзя создать запрос по чужой задаче", 403);
    }
  }

  const [approval] = await db
    .insert(s.approvals)
    .values({
      title,
      description,
      type,
      priority,
      status: "pending",
      requesterUserId: viewer.id,
      requesterName: viewer.name,
      relatedTaskId,
      amount: String(amount),
      dueAt,
      updatedAt: new Date(),
    })
    .returning();

  await recordAuditEvent({
    actor: viewer,
    action: "создал запрос на согласование",
    entity: approval.title,
    entityType: "approval",
    entityId: approval.id,
    eventType: "business",
    severity: "info",
    ip,
    metadata: { type, priority, relatedTaskId, amount },
  });
  return approval;
}

export async function reviewApproval(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  assertWorkforceManager(viewer);
  const approvalId = positiveId(input.id, "запрос");
  const decision = shortText(input.decision, 32);
  if (!isApprovalDecision(decision)) throw new WorkforceError("Некорректное решение");
  const decisionNote = shortText(input.decisionNote, 2_000);
  if (decision === "rejected" && !decisionNote) throw new WorkforceError("Укажите причину отклонения");

  const [approval] = await db
    .select({ id: s.approvals.id, title: s.approvals.title, status: s.approvals.status, requesterUserId: s.approvals.requesterUserId })
    .from(s.approvals)
    .where(eq(s.approvals.id, approvalId))
    .limit(1);
  if (!approval) throw new WorkforceError("Запрос не найден", 404);
  if (approval.status !== "pending") throw new WorkforceError("По этому запросу уже принято решение", 409);
  if (approval.requesterUserId === viewer.id) throw new WorkforceError("Нельзя согласовать собственный запрос", 403);

  const now = new Date();
  const [updated] = await db
    .update(s.approvals)
    .set({
      status: decision,
      reviewerUserId: viewer.id,
      reviewerName: viewer.name,
      decisionNote,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(and(eq(s.approvals.id, approvalId), eq(s.approvals.status, "pending")))
    .returning();
  if (!updated) throw new WorkforceError("Запрос уже изменён другим пользователем", 409);

  await recordAuditEvent({
    actor: viewer,
    action: decision === "approved" ? "согласовал запрос" : "отклонил запрос",
    entity: approval.title,
    entityType: "approval",
    entityId: approvalId,
    eventType: "business",
    severity: decision === "approved" ? "info" : "warning",
    ip,
    metadata: { decision, requesterUserId: approval.requesterUserId ?? null },
  });
  return updated;
}

export async function cancelApproval(viewer: SessionUser, input: Input, ip: string) {
  await ensureSeed();
  const approvalId = positiveId(input.id, "запрос");
  const [approval] = await db
    .select({ id: s.approvals.id, title: s.approvals.title, status: s.approvals.status, requesterUserId: s.approvals.requesterUserId })
    .from(s.approvals)
    .where(eq(s.approvals.id, approvalId))
    .limit(1);
  if (!approval) throw new WorkforceError("Запрос не найден", 404);
  if (approval.requesterUserId !== viewer.id) throw new WorkforceError("Отменить можно только собственный запрос", 403);
  if (approval.status !== "pending") throw new WorkforceError("Отменить можно только ожидающий запрос", 409);

  const [updated] = await db
    .update(s.approvals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(s.approvals.id, approvalId), eq(s.approvals.status, "pending"), eq(s.approvals.requesterUserId, viewer.id)))
    .returning();
  if (!updated) throw new WorkforceError("Запрос уже изменён другим пользователем", 409);

  await recordAuditEvent({
    actor: viewer,
    action: "отменил запрос на согласование",
    entity: approval.title,
    entityType: "approval",
    entityId: approvalId,
    eventType: "business",
    severity: "info",
    ip,
  });
  return updated;
}

/** Preserve task/approval history while severing references to a removed staff account. */
export async function removeWorkforceArtifactsForDeletedUser(userId: number) {
  await ensureSeed();
  await db.transaction(async (tx) => {
    await tx.delete(s.employeeProfiles).where(eq(s.employeeProfiles.userId, userId));
    await tx.delete(s.employeeKpis).where(eq(s.employeeKpis.userId, userId));
    await tx.update(s.tasks).set({ assigneeUserId: null }).where(eq(s.tasks.assigneeUserId, userId));
    await tx.update(s.tasks).set({ createdByUserId: null }).where(eq(s.tasks.createdByUserId, userId));
    await tx.update(s.approvals).set({ requesterUserId: null }).where(eq(s.approvals.requesterUserId, userId));
    await tx.update(s.approvals).set({ reviewerUserId: null }).where(eq(s.approvals.reviewerUserId, userId));
  });
}

export const WORKFORCE_REFERENCE_DATA = {
  taskStatuses: TASK_STATUSES,
  taskPriorities: TASK_PRIORITIES,
  taskLinkTypes: TASK_LINK_TYPES,
  approvalTypes: APPROVAL_TYPES,
  approvalPriorities: APPROVAL_PRIORITIES,
  approvalDecisions: APPROVAL_DECISIONS,
};
