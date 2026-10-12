import {
  BarChart3,
  ClipboardList,
  Users,
  Settings,
  Network,
  ScrollText,
  Activity,
  UserRound,
} from "lucide-react";
import type { StaffRole } from "@whistle/shared";
export const staffNavigation = [
  {
    href: "/staff/cases",
    key: "cases",
    icon: ClipboardList,
    roles: ["manager", "analyst"],
  },
  {
    href: "/staff/admin/staff",
    key: "staffMembers",
    icon: Users,
    roles: ["admin"],
  },
  { href: "/staff/admin/teams", key: "teams", icon: Network, roles: ["admin"] },
  {
    href: "/staff/admin/settings",
    key: "settings",
    icon: Settings,
    roles: ["admin"],
  },
  {
    href: "/staff/admin/operations",
    key: "operations",
    icon: Activity,
    roles: ["admin"],
  },
  {
    href: "/staff/admin/audit",
    key: "audit",
    icon: ScrollText,
    roles: ["admin"],
  },
  {
    href: "/staff/analytics",
    key: "statistics",
    icon: BarChart3,
    roles: ["admin", "manager", "analyst"],
  },
  {
    href: "/staff/account",
    key: "account",
    icon: UserRound,
    roles: ["admin", "manager", "analyst"],
  },
] satisfies {
  href: string;
  key: string;
  icon: typeof Users;
  roles: StaffRole[];
}[];
export const caseSections = [
  { segment: "", key: "overview" },
  { segment: "messages", key: "messages" },
  { segment: "evidence", key: "evidence" },
  { segment: "investigation", key: "investigation" },
  { segment: "actions", key: "tasks" },
  { segment: "closure", key: "closureMenu" },
  { segment: "history", key: "audit" },
] as const;
export type CaseSection = (typeof caseSections)[number]["segment"];
export function staffHome(role: StaffRole) {
  return role === "admin" ? "/staff/admin/settings" : "/staff/cases";
}
export function safeStaffReturn(value: string | null): string {
  if (!value || /[\\\x00-\x20]/.test(value)) return "/staff";
  try {
    const url = new URL(value, "https://staff.invalid");
    if (url.origin !== "https://staff.invalid" || !value.startsWith("/"))
      return "/staff";
    const path = url.pathname;
    const valid =
      path === "/staff" ||
      staffNavigation.some((n) => n.href === path) ||
      path === "/staff/admin/settings/history" ||
      /^\/staff\/cases\/[0-9a-f-]{36}(?:\/(?:messages|evidence|investigation|actions|closure|history))?$/.test(
        path,
      );
    return valid ? path + url.search : "/staff";
  } catch {
    return "/staff";
  }
}
