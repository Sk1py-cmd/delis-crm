export const SALES_CHANNEL_KEYS = [
  "telegram",
  "miniapp",
  "website",
  "instagram",
  "facebook",
  "agent",
  "crm",
] as const;

export type SalesChannelKey = (typeof SALES_CHANNEL_KEYS)[number];

export const SALES_CHANNEL_META: Record<SalesChannelKey, { label: string; color: string }> = {
  telegram: { label: "Telegram Bot", color: "#0ea5e9" },
  miniapp: { label: "Telegram Mini App", color: "#8b5cf6" },
  website: { label: "Официальный сайт", color: "#f59e0b" },
  instagram: { label: "Instagram", color: "#ec4899" },
  facebook: { label: "Facebook", color: "#3b82f6" },
  agent: { label: "Агенты / B2B", color: "#22c55e" },
  crm: { label: "CRM", color: "#64748b" },
};

export function isSalesChannel(value: unknown): value is SalesChannelKey {
  return typeof value === "string" && (SALES_CHANNEL_KEYS as readonly string[]).includes(value);
}

export function channelMeta(value: string) {
  return isSalesChannel(value)
    ? SALES_CHANNEL_META[value]
    : { label: value || "Не распределено", color: "#94a3b8" };
}
