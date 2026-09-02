export const WORKFORCE_MANAGER_ROLES = ["owner", "admin", "manager"] as const;

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "mid", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_LINK_TYPES = ["", "order", "customer", "agent", "supplier", "approval"] as const;
export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];

export const APPROVAL_TYPES = ["expense", "discount", "purchase", "content", "task", "other"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_DECISIONS = ["approved", "rejected"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_PRIORITIES = [
  { key: "low", label: "Низкий", color: "#6b7280" },
  { key: "normal", label: "Обычный", color: "#3b82f6" },
  { key: "high", label: "Высокий", color: "#f97316" },
  { key: "critical", label: "Критичный", color: "#ef4444" },
] as const;
export type ApprovalPriority = (typeof APPROVAL_PRIORITIES)[number]["key"];

export const APPROVAL_CATEGORIES = [
  { key: "expense", label: "Расход", icon: "💳" },
  { key: "discount", label: "Скидка", icon: "🏷️" },
  { key: "purchase", label: "Закупка", icon: "📦" },
  { key: "content", label: "Контент", icon: "🖼️" },
  { key: "task", label: "Рабочее решение", icon: "📋" },
  { key: "other", label: "Другое", icon: "📌" },
] as const;

export const KPI_METRICS = [
  { key: "sales", label: "Продажи", defaultUnit: "сум" },
  { key: "tasks", label: "Выполненные задачи", defaultUnit: "шт." },
  { key: "visits", label: "Визиты", defaultUnit: "шт." },
  { key: "quality", label: "Качество", defaultUnit: "%" },
] as const;
export type KpiMetric = (typeof KPI_METRICS)[number]["key"];

export function isWorkforceManager(role: string) {
  return (WORKFORCE_MANAGER_ROLES as readonly string[]).includes(role);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskLinkType(value: string): value is TaskLinkType {
  return (TASK_LINK_TYPES as readonly string[]).includes(value);
}

export function isApprovalType(value: string): value is ApprovalType {
  return (APPROVAL_TYPES as readonly string[]).includes(value);
}

export function isApprovalDecision(value: string): value is ApprovalDecision {
  return (APPROVAL_DECISIONS as readonly string[]).includes(value);
}

export function isApprovalPriority(value: string): value is ApprovalPriority {
  return APPROVAL_PRIORITIES.some((priority) => priority.key === value);
}

export function isKpiMetric(value: string): value is KpiMetric {
  return KPI_METRICS.some((metric) => metric.key === value);
}

/** Employees may advance only their own work; managers may set any valid column state. */
export function canAdvanceOwnTask(from: string, to: string) {
  return (from === "todo" && (to === "in_progress" || to === "done"))
    || (from === "in_progress" && to === "done");
}

export function currentKpiPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isKpiPeriod(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
