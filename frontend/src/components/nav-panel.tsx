import { NavLink } from "react-router-dom";
import {
  Home,
  MessageSquare,
  UserPlus,
  Users,
  Building2,
  FileText,
  Wallet,
  Files,
  Inbox,
  Activity,
  Calendar,
  Shield,
  Settings,
  Heart,
  CheckCircle,
  Bell,
  Columns3,
  Megaphone,
  LogOut,
  PanelLeft,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useNavState } from "@/lib/nav-state";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  labelKey: string;
  icon: React.ElementType;
}

const mainNav: NavItem[] = [
  { to: "/", labelKey: "nav_dashboard", icon: Home },
  { to: "/chat", labelKey: "nav_chat", icon: MessageSquare },
];

const patientPortalNav: NavItem[] = [
  { to: "/", labelKey: "nav_dashboard", icon: Home },
  { to: "/appointments", labelKey: "nav_my_appointments", icon: Calendar },
  { to: "/documents", labelKey: "nav_my_documents", icon: Files },
  { to: "/invoices", labelKey: "nav_my_invoices", icon: Wallet },
  { to: "/privacy", labelKey: "nav_my_privacy", icon: Shield },
];

const crmNav: NavItem[] = [
  { to: "/intakes", labelKey: "nav_intakes", icon: Inbox },
  { to: "/leads", labelKey: "leads_title", icon: UserPlus },
  { to: "/patients", labelKey: "patients_title", icon: Users },
  { to: "/providers", labelKey: "nav_providers", icon: Building2 },
  { to: "/orders", labelKey: "orders_title", icon: FileText },
  { to: "/contracts", labelKey: "Contracts", icon: Wallet },
  { to: "/invoices", labelKey: "Invoices", icon: Wallet },
  { to: "/documents", labelKey: "Documents", icon: Files },
];

const medicineNav: NavItem[] = [
  { to: "/cases", labelKey: "cases_title", icon: Activity },
  { to: "/appointments", labelKey: "appointments_title", icon: Calendar },
];

const adminNav: NavItem[] = [
  { to: "/admin/users", labelKey: "nav_users_roles", icon: Users },
  { to: "/admin/access", labelKey: "nav_access_matrix", icon: Shield },
  { to: "/admin/settings", labelKey: "settings_title", icon: Settings },
  { to: "/admin/activity", labelKey: "nav_activity", icon: Activity },
  { to: "/admin/security", labelKey: "nav_security", icon: Shield },
  { to: "/admin/health", labelKey: "nav_health", icon: Heart },
  { to: "/admin/compliance", labelKey: "nav_compliance", icon: CheckCircle },
  { to: "/admin/notifications", labelKey: "nav_notifications", icon: Bell },
  { to: "/admin/custom-fields", labelKey: "nav_custom_fields", icon: Columns3 },
  { to: "/admin/announcements", labelKey: "nav_announcements", icon: Megaphone },
];

const ADMIN_ROLES = new Set(["ceo", "ceo_assistant", "it_admin"]);

export function NavPanel() {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { collapsed, toggle } = useNavState();
  const isAdmin = user ? ADMIN_ROLES.has(user.role) : false;
  const isPatientPortal = user?.role === "patient";

  return (
    <nav
      className={cn(
        "fixed left-4 top-4 bottom-4 z-50 flex flex-col rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl py-3 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        collapsed ? "w-14 items-center" : "w-60 px-2"
      )}
    >
      {/* Toggle */}
      <div className={cn(
        "flex mb-2 shrink-0",
        collapsed ? "justify-center" : "justify-end px-1"
      )}>
        <button
          onClick={toggle}
          className={cn(
            "flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/8 transition-colors",
            collapsed ? "size-10" : "size-8"
          )}
        >
          <PanelLeft className={cn(collapsed ? "size-5" : "size-[18px]")} />
        </button>
      </div>

      {/* Nav groups */}
      {isPatientPortal ? (
        <NavGroup items={patientPortalNav} tr={tr} collapsed={collapsed} />
      ) : (
        <>
          <NavGroup items={mainNav} tr={tr} collapsed={collapsed} />
          <Divider collapsed={collapsed} />
          <NavGroup items={crmNav} tr={tr} collapsed={collapsed} />
          <Divider collapsed={collapsed} />
          <NavGroup items={medicineNav} tr={tr} collapsed={collapsed} />
          {isAdmin && (
            <>
              <Divider collapsed={collapsed} />
              <NavGroup items={adminNav} tr={tr} collapsed={collapsed} />
            </>
          )}
        </>
      )}

      {/* Logout */}
      <div className={cn("mt-auto pt-2 shrink-0", !collapsed && "border-t border-white/10 mx-1")}>
        <button
          onClick={logout}
          title={collapsed ? tr.nav_logout : undefined}
          className={cn(
            "flex items-center rounded-lg text-white/70 hover:text-red-400 hover:bg-white/8 transition-colors",
            collapsed
              ? "justify-center size-10"
              : "gap-3 w-full px-3 py-2 text-sm mt-2"
          )}
        >
          <LogOut className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed && <span className="whitespace-nowrap overflow-hidden">{tr.nav_logout}</span>}
        </button>
      </div>
    </nav>
  );
}

function NavGroup({ items, tr, collapsed }: { items: NavItem[]; tr: Record<string, string>; collapsed: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          title={collapsed ? (tr[item.labelKey] ?? item.labelKey) : undefined}
          className={({ isActive }: { isActive: boolean }) =>
            cn(
              "flex items-center rounded-lg transition-colors",
              collapsed
                ? "justify-center size-10"
                : "gap-3 px-3 py-2 text-sm",
              isActive
                ? "bg-white/10 text-white font-medium"
                : "text-white/70 hover:text-white hover:bg-white/8"
            )
          }
        >
          <item.icon className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed && (
            <span className="whitespace-nowrap overflow-hidden">{tr[item.labelKey] ?? item.labelKey}</span>
          )}
        </NavLink>
      ))}
    </div>
  );
}

function Divider({ collapsed }: { collapsed: boolean }) {
  return <div className={cn("h-px bg-white/10 my-2", collapsed ? "mx-2 w-8" : "mx-3")} />;
}
