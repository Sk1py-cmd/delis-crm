import { isWorkforceManager } from "./workforce";

export const AGENT_VISIT_STATUSES = ["order_placed", "completed", "no_order"] as const;
export type AgentVisitStatus = (typeof AGENT_VISIT_STATUSES)[number];

export const AGENT_ROUTE_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type AgentRouteStatus = (typeof AGENT_ROUTE_STATUSES)[number];

export const AGENT_ROUTE_STOP_STATUSES = ["planned", "visited", "skipped"] as const;
export type AgentRouteStopStatus = (typeof AGENT_ROUTE_STOP_STATUSES)[number];

export const MAX_ROUTE_STOPS = 60;
export const MAX_VISIT_PHOTOS = 6;
/** Base64 payload cap per photo; native images are compressed client-side before queueing. */
export const MAX_VISIT_PHOTO_DATA_URL_LENGTH = 3_000_000;

export function isAgentVisitStatus(value: string): value is AgentVisitStatus {
  return (AGENT_VISIT_STATUSES as readonly string[]).includes(value);
}

export function isAgentRouteStatus(value: string): value is AgentRouteStatus {
  return (AGENT_ROUTE_STATUSES as readonly string[]).includes(value);
}

export function isAgentRouteStopStatus(value: string): value is AgentRouteStopStatus {
  return (AGENT_ROUTE_STOP_STATUSES as readonly string[]).includes(value);
}

/** Field supervisors use the same deliberate manager boundary as team workflows. */
export function canManageFieldwork(role: string) {
  return isWorkforceManager(role);
}

export function isRouteDate(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function fieldworkRouteDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
