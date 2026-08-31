import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  MessagesSquare,
  Warehouse,
  UserCog,
  Wallet,
  BarChart3,
  Send,
  Globe,
  Smartphone,
  Camera,
  ShieldCheck,
  Settings,
  Bell,
  Sparkles,
  Truck,
  RotateCcw,
  Building2,
  CheckSquare,
  FileCheck2,
  Target,
  TrendingUp,
  BookOpen,
  Plug,
} from "lucide-react";
import { canAccess, ROLE_ACCESS } from "./access";

export { canAccess, ROLE_ACCESS };

export type NavGroup = "overview" | "sales" | "communications" | "channels" | "management";

export interface NavItem {
  href: string;
  /** Ключ перевода: реальный текст берётся из TRANSLATIONS через t(`nav.${labelKey}`) */
  labelKey: string;
  icon: typeof LayoutDashboard;
  group: NavGroup;
  badge?: string;
  roles?: string[];
}

export function navForRole(role: string): NavItem[] {
  return NAV.filter((item) => canAccess(role, item.href));
}

export const NAV: NavItem[] = [
  { href: "/", labelKey: "dashboard", icon: LayoutDashboard, group: "overview" },
  { href: "/company-os", labelKey: "companyOS", icon: Sparkles, group: "overview" },
  { href: "/analytics", labelKey: "analytics", icon: BarChart3, group: "overview" },
  { href: "/pnl", labelKey: "pnl", icon: TrendingUp, group: "overview" },
  { href: "/knowledge", labelKey: "knowledge", icon: BookOpen, group: "overview" },
  { href: "/tasks", labelKey: "tasks", icon: CheckSquare, group: "overview" },
  { href: "/kpi", labelKey: "kpi", icon: Target, group: "overview" },
  { href: "/approvals", labelKey: "approvals", icon: FileCheck2, group: "management" },
  { href: "/orders", labelKey: "orders", icon: ShoppingCart, group: "sales" },
  { href: "/products", labelKey: "products", icon: Package, group: "sales" },
  { href: "/warehouse", labelKey: "warehouse", icon: Warehouse, group: "sales" },
  { href: "/suppliers", labelKey: "suppliers", icon: Building2, group: "sales" },
  { href: "/customers", labelKey: "customers", icon: Users, group: "sales" },
  { href: "/agents", labelKey: "agents", icon: UserCog, group: "sales" },
  { href: "/marketing", labelKey: "marketing", icon: Sparkles, group: "sales" },
  { href: "/delivery", labelKey: "delivery", icon: Truck, group: "sales" },
  { href: "/returns", labelKey: "returns", icon: RotateCcw, group: "sales" },
  { href: "/chat", labelKey: "chat", icon: MessagesSquare, group: "communications" },
  { href: "/broadcast", labelKey: "broadcast", icon: Send, group: "communications" },
  { href: "/notifications", labelKey: "notifications", icon: Bell, group: "communications" },
  { href: "/miniapp", labelKey: "miniapp", icon: Smartphone, group: "channels" },
  { href: "/website", labelKey: "website", icon: Globe, group: "channels" },
  { href: "/instagram", labelKey: "instagram", icon: Camera, group: "channels" },
  { href: "/finance", labelKey: "finance", icon: Wallet, group: "management" },
  { href: "/users", labelKey: "users", icon: ShieldCheck, group: "management" },
  { href: "/security", labelKey: "security", icon: ShieldCheck, group: "management" },
  { href: "/integrations", labelKey: "integrations", icon: Plug, group: "management" },
  { href: "/agent-portal", labelKey: "agentPortal", icon: Smartphone, group: "management" },
  { href: "/settings", labelKey: "settings", icon: Settings, group: "management" },
];

export const NAV_GROUPS: NavGroup[] = ["overview", "sales", "communications", "channels", "management"];
