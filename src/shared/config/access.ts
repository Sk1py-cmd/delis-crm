export const ROLES = [
  "owner",
  "admin",
  "manager",
  "warehouse",
  "agent",
  "support",
  "moderator",
  "operator",
] as const;

export type Role = (typeof ROLES)[number];
export type StaffRole = Exclude<Role, "owner">;

export const STAFF_ROLES: readonly StaffRole[] = [
  "admin",
  "manager",
  "warehouse",
  "agent",
  "support",
  "moderator",
  "operator",
];

/** Routes are protected on the server as well as hidden in navigation. */
export const ROLE_ACCESS: Record<Role, readonly string[]> = {
  owner: ["*"],
  admin: [
    "/", "/company-os", "/analytics", "/pnl", "/knowledge", "/tasks", "/orders", "/products",
    "/warehouse", "/suppliers", "/customers", "/agents", "/marketing", "/delivery", "/returns",
    "/chat", "/broadcast", "/notifications", "/miniapp", "/website", "/instagram", "/finance",
    "/integrations", "/kpi", "/approvals", "/settings",
  ],
  manager: [
    "/", "/company-os", "/analytics", "/knowledge", "/tasks", "/orders", "/products", "/warehouse",
    "/suppliers", "/delivery", "/returns", "/customers", "/agents", "/marketing", "/chat", "/broadcast",
    "/notifications", "/miniapp", "/website", "/instagram", "/kpi", "/approvals", "/settings",
  ],
  warehouse: ["/", "/tasks", "/knowledge", "/products", "/warehouse", "/suppliers", "/returns", "/delivery", "/kpi", "/approvals", "/settings"],
  agent: ["/", "/agent-portal", "/tasks", "/knowledge", "/kpi", "/approvals", "/settings"],
  support: ["/", "/tasks", "/knowledge", "/chat", "/customers", "/orders", "/returns", "/notifications", "/kpi", "/approvals", "/settings"],
  moderator: ["/", "/tasks", "/knowledge", "/products", "/miniapp", "/website", "/instagram", "/marketing", "/broadcast", "/kpi", "/approvals", "/settings"],
  operator: ["/", "/tasks", "/knowledge", "/orders", "/customers", "/chat", "/delivery", "/kpi", "/approvals", "/settings"],
};

const DEFAULT_ROUTE: Record<Role, string> = {
  owner: "/",
  admin: "/",
  manager: "/",
  warehouse: "/warehouse",
  agent: "/agent-portal",
  support: "/chat",
  moderator: "/miniapp",
  operator: "/orders",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function canAccess(role: string, href: string): boolean {
  if (!isRole(role)) return false;
  const allowed = ROLE_ACCESS[role];
  return allowed.includes("*") || allowed.includes(href);
}

export function defaultRouteForRole(role: string): string {
  return isRole(role) ? DEFAULT_ROUTE[role] : "/";
}

export type Capability =
  | "company:read"
  | "products:read"
  | "products:manage"
  | "orders:create"
  | "orders:update"
  | "chat:read"
  | "chat:write"
  | "search:read"
  | "agent-messages:read"
  | "agent-messages:write"
  | "upload:write"
  | "workforce:read"
  | "fieldwork:write"
  | "security:manage";

const CAPABILITY_ACCESS: Record<Capability, readonly Role[]> = {
  "company:read": ["admin", "manager"],
  "products:read": ["admin", "manager", "warehouse", "agent", "moderator", "operator"],
  "products:manage": ["admin", "manager", "warehouse"],
  "orders:create": ["admin", "manager", "operator"],
  "orders:update": ["admin", "manager", "operator"],
  "chat:read": ["admin", "manager", "support", "operator"],
  "chat:write": ["admin", "manager", "support", "operator"],
  "search:read": ["admin", "manager", "warehouse", "support", "moderator", "operator"],
  "agent-messages:read": ["admin", "manager", "agent"],
  "agent-messages:write": ["admin", "manager", "agent"],
  "upload:write": ["admin", "manager", "warehouse", "agent", "support", "moderator", "operator"],
  // Every authenticated role may use its own tasks, KPI view, and approval requests.
  // Fine-grained authorisation (team management / own records) is enforced in server/workforce.ts.
  "workforce:read": ["admin", "manager", "warehouse", "agent", "support", "moderator", "operator"],
  // Agents submit only their own field reports; object-level agent/route checks live in server/fieldwork.ts.
  "fieldwork:write": ["admin", "manager", "agent"],
  "security:manage": [],
};

export function hasCapability(role: string, capability: Capability): boolean {
  if (role === "owner") return true;
  return isRole(role) && CAPABILITY_ACCESS[capability].includes(role);
}

export const MANAGE_ACTIONS = [
  "createUser",
  "updateUserRole",
  "setUserStatus",
  "resetPassword",
  "deleteUser",
  "createAgent",
  "addTransaction",
  "updateContent",
  "saveNote",
  "saveTemplate",
  "notify",
  "syncEverything",
  "sendBroadcast",
  "importProducts",
  "inventory",
  "sendOrderToClient",
  "createPromocode",
  "toggleMarketingTrigger",
  "createSupplier",
  "createPurchaseOrder",
  "receivePurchaseOrder",
  "createReturn",
  "approveReturn",
  "addCourier",
  "assignDelivery",
  "completeDelivery",
  "addAgentVisit",
  "sendAgentMessage",
  "saveIntegration",
  "testTelegram",
  "sendTelegram",
  "setupOrderNotifications",
  "saveArticle",
  "deleteArticle",
  "publishSite",
  "saveSeo",
  "changePassword",
  "changeLogin",
  "createInstagramPost",
  "saveMiniAppBanners",
  "resetDemoData",
  "sendPush",
  "createAgentStoreOrder",
] as const;

export type ManageAction = (typeof MANAGE_ACTIONS)[number];

/** Owner always has access. Lists below define delegated staff permissions. */
const MANAGE_ACTION_ACCESS: Record<ManageAction, readonly StaffRole[]> = {
  createUser: [],
  updateUserRole: [],
  setUserStatus: [],
  resetPassword: [],
  deleteUser: [],
  createAgent: ["admin", "manager"],
  addTransaction: ["admin"],
  updateContent: ["admin", "manager", "moderator"],
  saveNote: ["admin", "manager", "support", "operator"],
  saveTemplate: ["admin", "manager", "support", "operator"],
  notify: ["admin", "manager"],
  syncEverything: ["admin", "manager"],
  sendBroadcast: ["admin", "manager", "moderator"],
  importProducts: ["admin", "manager", "warehouse"],
  inventory: ["admin", "manager", "warehouse"],
  sendOrderToClient: ["admin", "manager", "support", "operator"],
  createPromocode: ["admin", "manager", "moderator"],
  toggleMarketingTrigger: ["admin", "manager", "moderator"],
  createSupplier: ["admin", "manager", "warehouse"],
  createPurchaseOrder: ["admin", "manager", "warehouse"],
  receivePurchaseOrder: ["admin", "manager", "warehouse"],
  createReturn: ["admin", "manager", "warehouse", "support", "operator"],
  approveReturn: ["admin", "manager", "warehouse"],
  addCourier: ["admin", "manager", "warehouse", "operator"],
  assignDelivery: ["admin", "manager", "warehouse", "operator"],
  completeDelivery: ["admin", "manager", "warehouse", "operator"],
  addAgentVisit: ["admin", "manager", "agent"],
  sendAgentMessage: ["admin", "manager", "agent"],
  saveIntegration: ["admin"],
  testTelegram: ["admin"],
  sendTelegram: ["admin"],
  setupOrderNotifications: ["admin"],
  saveArticle: ["admin", "manager", "moderator"],
  deleteArticle: ["admin", "manager", "moderator"],
  publishSite: ["admin", "manager", "moderator"],
  saveSeo: ["admin", "manager", "moderator"],
  changePassword: [],
  changeLogin: [],
  createInstagramPost: ["admin", "manager", "moderator"],
  saveMiniAppBanners: ["admin", "manager", "moderator"],
  resetDemoData: [],
  sendPush: ["admin", "manager"],
  createAgentStoreOrder: ["admin", "manager", "agent"],
};

export function isManageAction(value: string): value is ManageAction {
  return (MANAGE_ACTIONS as readonly string[]).includes(value);
}

export function canManageAction(role: string, action: ManageAction): boolean {
  if (role === "owner") return true;
  return isStaffRole(role) && MANAGE_ACTION_ACCESS[action].includes(role);
}
