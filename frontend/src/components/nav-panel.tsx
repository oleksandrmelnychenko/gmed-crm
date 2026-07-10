import { NavLink } from "react-router-dom";
import {
  BadgeCheck,
  BellRing,
  Building2,
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
  UserCog,
  Wallet,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
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
  providers: Building2,
  orders: ClipboardList,
  contracts: FileSignature,
  invoices: ReceiptText,
  "finance-catalog": Wallet,
  documents: FolderOpen,
  recommendations: ClipboardList,
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
  const { collapsed, toggle } = useNavState();
  const isPatientPortal = user?.role === "patient";
  const patientPortalNav = isPatientPortal ? listPatientPortalNavItems().map(toPatientNavItem) : [];
  const staffNavBySection =
    user && user.role !== "patient"
      ? groupStaffNavItems(listStaffNavItems(user.role))
      : new Map<StaffNavSection, NavItem[]>();
  const closeOnCompactViewport = () => {
    if (
      !collapsed &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      toggle();
    }
  };

  return (
    <nav
      className={cn(
        "relative z-40 flex shrink-0 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-sidebar transition-[width,transform] duration-200 ease-out motion-reduce:transition-none lg:relative lg:inset-auto lg:translate-x-0 max-lg:fixed max-lg:inset-y-12 max-lg:left-0 max-lg:w-72 max-lg:border-r max-lg:border-sidebar-border max-lg:shadow-xl",
        collapsed
          ? "w-14 items-center max-lg:pointer-events-none max-lg:-translate-x-full"
          : "w-60 max-lg:translate-x-0",
      )}
    >
      {user && (
        <div className={cn("shrink-0", collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
          <UserCard name={user.name} role={user.role} tr={tr} translations={t} collapsed={collapsed} />
        </div>
      )}
      <div className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        {isPatientPortal ? (
          <NavGroup
            items={patientPortalNav}
            tr={tr}
            translations={t}
            collapsed={collapsed}
            onNavigate={closeOnCompactViewport}
          />
        ) : (
          <StaffNavGroups
            staffNavBySection={staffNavBySection}
            tr={tr}
            translations={t}
            collapsed={collapsed}
            onNavigate={closeOnCompactViewport}
          />
        )}
      </div>

      <div className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "py-2 px-2" : "py-3 px-3")}>
        <button
          type="button"
          onClick={logout}
          title={collapsed ? tr.nav_logout : undefined}
          aria-label={collapsed ? tr.nav_logout : undefined}
          className={cn(
            "flex items-center rounded-lg text-sidebar-foreground/85 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring motion-reduce:transition-none",
            collapsed ? "justify-center size-11 mx-auto" : "gap-3 w-full px-3 py-2.5 text-sm",
          )}
        >
          <LogOut aria-hidden="true" className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed && <span className="whitespace-nowrap overflow-hidden">{tr.nav_logout}</span>}
        </button>
      </div>
    </nav>
  );
}

function StaffNavGroups({
  staffNavBySection,
  tr,
  translations,
  collapsed,
  onNavigate,
}: {
  staffNavBySection: Map<StaffNavSection, NavItem[]>;
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
  onNavigate: () => void;
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
                {sectionLabel(section, tr, translations)}
              </div>
            </div>
          )}
          {collapsed && <SectionDivider />}
          <NavGroup
            items={staffNavBySection.get(section) ?? []}
            tr={tr}
            translations={translations}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
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
  translations,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id] ?? FileText;
        const label = navItemLabel(item, tr, translations);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "relative flex items-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring motion-reduce:transition-none",
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
                  aria-hidden="true"
                  strokeWidth={isActive ? 1.85 : 1.6}
                  className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")}
                />
                {!collapsed && (
                  <span className="whitespace-nowrap overflow-hidden">{label}</span>
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
  return <div aria-hidden="true" className="mx-auto my-1 h-px w-6 bg-sidebar-border" />;
}

function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type UnknownTranslations = Pick<Translations, "common_unknown" | "common_unknown_value">;

function sectionLabel(
  section: StaffNavSection,
  dictionary: Record<string, string>,
  translations: UnknownTranslations,
): string {
  return dictionary[SECTION_LABEL_KEYS[section]] ?? formatUnknownValue(section, translations);
}

function navItemLabel(
  item: NavItem,
  dictionary: Record<string, string>,
  translations: UnknownTranslations,
): string {
  return dictionary[item.labelKey] ?? formatUnknownValue(item.labelKey, translations);
}

function roleLabel(role: string, dictionary: Record<string, string>, translations: UnknownTranslations): string {
  return dictionary[`role_${role}`] ?? formatUnknownValue(role, translations);
}

function UserCard({
  name,
  role,
  tr,
  translations,
  collapsed,
}: {
  name: string;
  role: string;
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
}) {
  const roleText = roleLabel(role, tr, translations);

  if (collapsed) {
    return (
      <div
        title={`${name} - ${roleText}`}
        className="flex items-center justify-center size-10 mx-auto rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white"
      >
        {userInitials(name)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm">
      <div className="flex items-center justify-center size-9 shrink-0 rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
        {userInitials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground leading-tight">{name}</p>
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mt-0.5">{roleText}</p>
      </div>
    </div>
  );
}
