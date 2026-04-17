import { NavLink } from "react-router-dom";
import {
  BadgeCheck,
  BellRing,
  CalendarClock,
  ChartSpline,
  ClipboardList,
  ConciergeBell,
  FileHeart,
  FileSignature,
  FileText,
  Fingerprint,
  FolderOpen,
  GraduationCap,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Magnet,
  Megaphone,
  MessageCircleHeart,
  MessagesSquare,
  ReceiptText,
  Settings2,
  Shield,
  SlidersHorizontal,
  Stethoscope,
  UserCog,
  UsersRound,
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

const SECTION_LABEL_KEYS: Record<StaffNavSection, string> = {
  main: "nav_main",
  crm: "nav_crm",
  medicine: "nav_medicine",
  admin: "nav_admin",
};

const NAV_ICONS: Record<string, React.ElementType> = {
  dashboard: LayoutDashboard,
  chat: MessagesSquare,
  feedback: MessageCircleHeart,
  reports: ChartSpline,
  sops: GraduationCap,
  leads: Magnet,
  patients: UsersRound,
  providers: Stethoscope,
  orders: ClipboardList,
  contracts: FileSignature,
  invoices: ReceiptText,
  documents: FolderOpen,
  services: ConciergeBell,
  privacy: Shield,
  cases: FileHeart,
  appointments: CalendarClock,
  "admin/users": UserCog,
  "admin/access": KeyRound,
  "admin/settings": Settings2,
  "admin/activity": History,
  "admin/security": Fingerprint,
  "admin/health": HeartPulse,
  "admin/compliance": BadgeCheck,
  "admin/notifications": BellRing,
  "admin/custom-fields": SlidersHorizontal,
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
  const { collapsed } = useNavState();
  const isPatientPortal = user?.role === "patient";
  const patientPortalNav = isPatientPortal ? listPatientPortalNavItems().map(toPatientNavItem) : [];
  const staffNavBySection =
    user && user.role !== "patient"
      ? groupStaffNavItems(listStaffNavItems(user.role))
      : new Map<StaffNavSection, NavItem[]>();

  return (
    <nav
      className={cn(
        "relative flex flex-col bg-sidebar overflow-y-auto overflow-x-hidden shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        collapsed ? "w-14 items-center" : "w-60",
      )}
    >
      {user && (
        <div className={cn("shrink-0", collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
          <UserCard name={user.name} role={user.role} collapsed={collapsed} />
        </div>
      )}
      <div className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        {isPatientPortal ? (
          <NavGroup items={patientPortalNav} tr={tr} collapsed={collapsed} />
        ) : (
          <StaffNavGroups staffNavBySection={staffNavBySection} tr={tr} collapsed={collapsed} />
        )}
      </div>

      <div className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "py-2 px-2" : "py-3 px-3")}>
        <button
          onClick={logout}
          title={collapsed ? tr.nav_logout : undefined}
          className={cn(
            "flex items-center rounded-lg text-sidebar-foreground/85 hover:text-rose-600 hover:bg-rose-50 transition-colors",
            collapsed ? "justify-center size-11 mx-auto" : "gap-3 w-full px-3 py-2.5 text-sm",
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
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-1">
          {!collapsed && (
            <div className="flex flex-col items-center gap-1 pb-1.5 pt-0.5">
              <div className="h-px w-10 bg-sidebar-border" />
              <div className="text-[10px] tracking-wide text-sidebar-foreground/50 uppercase">
                {tr[SECTION_LABEL_KEYS[section]] ?? section}
              </div>
            </div>
          )}
          {collapsed && <SectionDivider />}
          <NavGroup items={staffNavBySection.get(section) ?? []} tr={tr} collapsed={collapsed} />
        </div>
      ))}
    </div>
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
                "relative flex items-center rounded-lg text-sm transition-colors",
                collapsed ? "justify-center size-11 mx-auto" : "gap-3 px-3 h-10",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                  : "text-sidebar-foreground/90 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
              )
            }
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                <Icon
                  strokeWidth={isActive ? 1.85 : 1.6}
                  className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")}
                />
                {!collapsed && (
                  <span className="whitespace-nowrap overflow-hidden">{tr[item.labelKey] ?? item.labelKey}</span>
                )}
              </>
            )}
          </NavLink>
        );
      })}
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-6 bg-sidebar-border mx-auto my-1" />;
}

function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function UserCard({ name, role, collapsed }: { name: string; role: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div
        title={`${name} · ${roleLabel(role)}`}
        className="flex items-center justify-center size-10 mx-auto rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white"
      >
        {userInitials(name)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2 shadow-sm">
      <div className="flex items-center justify-center size-9 shrink-0 rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
        {userInitials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground leading-tight">{name}</p>
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mt-0.5">{roleLabel(role)}</p>
      </div>
    </div>
  );
}
