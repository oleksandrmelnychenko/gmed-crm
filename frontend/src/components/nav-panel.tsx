import { NavLink } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  Columns3,
  FileText,
  Files,
  Heart,
  Home,
  LogOut,
  Megaphone,
  MessageSquare,
  PanelLeft,
  Settings,
  Shield,
  Star,
  Users,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useNavState } from "@/lib/nav-state";
import {
  listPatientPortalNavItems,
  listStaffNavItems,
  type PatientPortalNavItem,
  type StaffNavItem,
  type StaffNavSection,
} from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";

interface NavItem {
  id: string;
  to: string;
  labelKey: string;
}

const STAFF_NAV_SECTIONS: StaffNavSection[] = ["main", "crm", "medicine", "admin"];

const NAV_ICONS: Record<string, React.ElementType> = {
  dashboard: Home,
  chat: MessageSquare,
  feedback: Star,
  reports: BarChart3,
  sops: BookOpen,
  leads: UserPlus,
  patients: Users,
  providers: Building2,
  orders: FileText,
  contracts: Wallet,
  invoices: Wallet,
  documents: Files,
  services: Building2,
  privacy: Shield,
  cases: Activity,
  appointments: Calendar,
  "admin/users": Users,
  "admin/access": Shield,
  "admin/settings": Settings,
  "admin/activity": Activity,
  "admin/security": Shield,
  "admin/health": Heart,
  "admin/compliance": CheckCircle,
  "admin/notifications": Bell,
  "admin/custom-fields": Columns3,
  "admin/announcements": Megaphone,
};

function toNavItem(item: StaffNavItem): NavItem {
  return { id: item.id, to: item.to, labelKey: item.labelKey };
}

function toPatientNavItem(item: PatientPortalNavItem): NavItem {
  return { id: item.id, to: item.to, labelKey: item.labelKey };
}

export function NavPanel() {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { collapsed, toggle } = useNavState();
  const isPatientPortal = user?.role === "patient";
  const patientPortalNav = isPatientPortal ? listPatientPortalNavItems().map(toPatientNavItem) : [];
  const staffNavBySection =
    user && user.role !== "patient"
      ? groupStaffNavItems(listStaffNavItems(user.role))
      : new Map<StaffNavSection, NavItem[]>();

  return (
    <nav
      className={cn(
        "fixed left-4 top-4 bottom-4 z-50 flex flex-col rounded-2xl bg-neutral-900 border border-white/10 shadow-2xl py-3 overflow-y-auto overflow-x-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        collapsed ? "w-14 items-center" : "w-60 px-2",
      )}
    >
      <div className={cn("flex mb-2 shrink-0", collapsed ? "justify-center" : "justify-end px-1")}>
        <button
          onClick={toggle}
          className={cn(
            "flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/8 transition-colors",
            collapsed ? "size-10" : "size-8",
          )}
        >
          <PanelLeft className={cn(collapsed ? "size-5" : "size-[18px]")} />
        </button>
      </div>

      {isPatientPortal ? (
        <NavGroup items={patientPortalNav} tr={tr} collapsed={collapsed} />
      ) : (
        <StaffNavGroups staffNavBySection={staffNavBySection} tr={tr} collapsed={collapsed} />
      )}

      <div className={cn("mt-auto pt-2 shrink-0", !collapsed && "border-t border-white/10 mx-1")}>
        <button
          onClick={logout}
          title={collapsed ? tr.nav_logout : undefined}
          className={cn(
            "flex items-center rounded-lg text-white/70 hover:text-red-400 hover:bg-white/8 transition-colors",
            collapsed ? "justify-center size-10" : "gap-3 w-full px-3 py-2 text-sm mt-2",
          )}
        >
          <LogOut className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed && <span className="whitespace-nowrap overflow-hidden">{tr.nav_logout}</span>}
        </button>
      </div>
    </nav>
  );
}

function StaffNavGroups({
  staffNavBySection,
  tr,
  collapsed,
}: {
  staffNavBySection: Map<StaffNavSection, NavItem[]>;
  tr: Record<string, string>;
  collapsed: boolean;
}) {
  const sections = STAFF_NAV_SECTIONS.filter((section) => (staffNavBySection.get(section)?.length ?? 0) > 0);

  return (
    <>
      {sections.map((section, index) => (
        <div key={section}>
          {index > 0 ? <Divider collapsed={collapsed} /> : null}
          <NavGroup items={staffNavBySection.get(section) ?? []} tr={tr} collapsed={collapsed} />
        </div>
      ))}
    </>
  );
}

function groupStaffNavItems(items: StaffNavItem[]): Map<StaffNavSection, NavItem[]> {
  const grouped = new Map<StaffNavSection, NavItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.section) ?? [];
    bucket.push(toNavItem(item));
    grouped.set(item.section, bucket);
  }
  return grouped;
}

function NavGroup({
  items,
  tr,
  collapsed,
}: {
  items: NavItem[];
  tr: Record<string, string>;
  collapsed: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id] ?? FileText;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={collapsed ? (tr[item.labelKey] ?? item.labelKey) : undefined}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "flex items-center rounded-lg transition-colors",
                collapsed ? "justify-center size-10" : "gap-3 px-3 py-2 text-sm",
                isActive ? "bg-white/10 text-white font-medium" : "text-white/70 hover:text-white hover:bg-white/8",
              )
            }
          >
            <Icon className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
            {!collapsed && (
              <span className="whitespace-nowrap overflow-hidden">{tr[item.labelKey] ?? item.labelKey}</span>
            )}
          </NavLink>
        );
      })}
    </div>
  );
}

function Divider({ collapsed }: { collapsed: boolean }) {
  return <div className={cn("h-px bg-white/10 my-2", collapsed ? "mx-2 w-8" : "mx-3")} />;
}
