import { useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, LogOut, LockKeyhole } from "lucide-react";
import { navItemIcon } from "@/components/nav-item-icon";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
import { useNavCounters } from "@/lib/use-nav-counters";
import { useNavState } from "@/lib/nav-state";
import { usePortalAccountLabel } from "@/lib/portal-account-label";
import { useLeadPortalClosed } from "@/pages/patient-lead/lead-portal-closed";
import { useLeadCabinetLangState } from "@/pages/patient-lead/lead-cabinet-language";
import { LEAD_PORTAL_AFTER_REQUEST, leadPortalFeatureLabels, leadShellNavLabel, leadShellText } from "@/pages/patient-lead/lead-shell-text";
import {
  canAccessStaffRoute,
  isLeadPortalUser,
  listLeadPortalNavItems,
  listPatientPortalNavItems,
  listStaffNavItems,
  type PatientPortalNavItem,
  type StaffNavItem,
  type StaffNavSection,
} from "@/lib/staff-route-access";
import { cn } from "@/lib/utils";
import { LeadPortalPlanDialog } from "@/components/lead-portal-plan-dialog";
import { PortalSubscriptionLock } from "@/components/portal-subscription-lock";
import {
  hasPortalSubscription,
  isPortalRouteLocked,
  isPortalSubscriptionPaused,
} from "@/lib/portal-subscription";
import { isPortalLegalRepresentative, usePortalPatientId } from "@/lib/portal-patient-context";
import { useLocalStorage } from "@/components/data-table/use-local-storage";

interface NavItem {
  id: string;
  to: string;
  labelKey: string;
  /** Said instead of the catalog text (the lead cabinet's shell in its own language). */
  label?: string;
  locked?: boolean;
}

const STAFF_NAV_SECTIONS: StaffNavSection[] = [
  "main",
  "crm",
  "medicine",
  "accounting",
  "security",
  "dsgvo",
  "admin",
];

const navSectionsSerializer = {
  parse(raw: string): StaffNavSection[] {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? STAFF_NAV_SECTIONS.filter((section) => value.includes(section)) : [];
  },
  stringify: (value: StaffNavSection[]) => JSON.stringify(value),
};

const SECTION_LABEL_KEYS: Record<StaffNavSection, string> = {
  main: "nav_main",
  crm: "nav_crm",
  medicine: "nav_medicine",
  accounting: "nav_accounting",
  security: "nav_section_security",
  dsgvo: "nav_section_dsgvo",
  admin: "nav_admin",
};

function toNavItem(item: StaffNavItem): NavItem {
  return { id: item.id, to: item.to, labelKey: item.labelKey };
}

function toPatientNavItem(item: PatientPortalNavItem): NavItem {
  return { id: item.id, to: item.to, labelKey: item.labelKey };
}

export function NavPanel() {
  const { user, logout } = useAuth();
  const { lang, t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { collapsed, toggle } = useNavState();
  const isPatientPortal = user?.role === "patient";
  const isLeadPortal = isLeadPortalUser(user);
  // The lead cabinet speaks DE, EN, UA and RU; its shell follows (QA 2026-10-24, A-7).
  const { lang: cabinetLang, settled: cabinetLangSettled } = useLeadCabinetLangState(user, lang);
  const shellText = isLeadPortal ? leadShellText(cabinetLang) : null;
  // On the request page the cabinet may still take the language of the request over once it is
  // loaded: until then the side bar shows a neutral skeleton, not the portal language for a
  // moment first (QA 2026-10-25, E-13). Every other page keeps the fallback language.
  const { pathname } = useLocation();
  const requestRoute = pathname.replace(/\/+$/, "") === "" || pathname.replace(/\/+$/, "") === "/request";
  const shellPending = isLeadPortal && !cabinetLangSettled && requestRoute;
  const withShellLabel = (item: NavItem): NavItem =>
    shellText ? { ...item, label: leadShellNavLabel(shellText, item.id, tr[item.labelKey] ?? item.labelKey) } : item;
  const logoutLabel = shellText?.signOut ?? tr.nav_logout;
  const patientId = usePortalPatientId(user?.id);
  const subscribed = hasPortalSubscription(user, patientId);
  // A paused subscription keeps agreed visits, the subscriptions page and the chat.
  const subscriptionPaused = isPortalSubscriptionPaused(user ?? null, patientId);
  // An ambiguous family login first opens the patient chooser in the shell;
  // no service module mounts until a person is selected.
  const needsPatientSelection = (user?.patients?.length ?? 0) > 1
    && !user?.patients?.some((patient) => patient.id === patientId);
  const [lockedModule, setLockedModule] = useState<{ id: string; label: string } | null>(null);
  // A parent's login in the lead cabinet is no patient: the cabinet names it.
  const cabinetAccountLabel = usePortalAccountLabel(isPatientPortal ? user?.id : null);
  // A parent in the patient portal of a minor is the legal representative,
  // not the patient (owner decision 2026-11-13).
  const portalAccountLabel = isPatientPortal && !isLeadPortal && isPortalLegalRepresentative(user, patientId)
    ? tr.portal_role_legal_representative ?? null
    : cabinetAccountLabel;
  // A parent whose access to every request ended sees the cabinet's notice alone, without the
  // locked entries of the patient portal (QA 2026-10-24, B-2/D-4).
  const leadPortalClosed = useLeadPortalClosed(isLeadPortal ? user?.id : null);
  // The patient's "Chat" entry counts unread answers like the staff one
  // (global QA 2026-11-10); the lead cabinet and a portal without an open
  // chat (no subscription, person not chosen yet) have no chat to count.
  const patientChatOpen = isPatientPortal && !isLeadPortal && (subscribed || subscriptionPaused) && !needsPatientSelection;
  const counters = useNavCounters(
    Boolean(user) && (!isPatientPortal || patientChatOpen),
    Boolean(user && !isPatientPortal && canAccessStaffRoute(user.role, "/leads", user.capabilities)),
  );
  // One entry for the patient portal to come opens the dialog that lists it (owner 2026-10-26, C1):
  // not ten locked entries that dominate the navigation of somebody who has not even sent the request.
  const patientPortalNav = isPatientPortal
    ? isLeadPortal
      ? [
          ...listLeadPortalNavItems().filter((item) => item.id !== "account" && item.id !== "legal").map(toPatientNavItem),
          ...(leadPortalClosed ? [] : [{ id: LEAD_PORTAL_AFTER_REQUEST, to: "#", labelKey: LEAD_PORTAL_AFTER_REQUEST, locked: true }]),
          ...listLeadPortalNavItems().filter((item) => item.id === "account" || item.id === "legal").map(toPatientNavItem),
        ].map(withShellLabel)
      : listPatientPortalNavItems({ leadRequests: Boolean(user?.lead_portal?.requests) })
        .map((item) => ({ ...toPatientNavItem(item), locked: !needsPatientSelection && isPortalRouteLocked(user ?? null, patientId, item.to) }))
    : [];
  const staffNavBySection =
    user && user.role !== "patient"
      ? groupStaffNavItems(
          listStaffNavItems(user.role, user.capabilities, {
            hasPersonnelFile: user.has_personnel_file,
          }),
        )
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
    <>
    <nav
      className={cn(
        "app-navigation relative z-40 flex shrink-0 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain bg-sidebar transition-[width,transform] duration-200 ease-out motion-reduce:transition-none lg:relative lg:inset-auto lg:translate-x-0 max-lg:fixed max-lg:inset-y-12 max-lg:left-0 max-lg:w-72 max-lg:border-r max-lg:border-sidebar-border max-lg:shadow-xl",
        collapsed
          ? "w-14 items-center max-lg:pointer-events-none max-lg:-translate-x-full"
          : "w-60 max-lg:translate-x-0",
      )}
    >
      {user && (
        <div className={cn("shrink-0", collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
          <UserCard
            name={user.name}
            role={user.role}
            // The lead cabinet names a parent's login; a lead's own name stands alone (labels audit 2026-10-26, B1).
            roleText={shellPending ? null : portalAccountLabel || null}
            hideRole={isLeadPortal && !portalAccountLabel}
            tr={tr}
            translations={t}
            collapsed={collapsed}
          />
        </div>
      )}
      <div className={cn("flex-1 py-4", collapsed ? "px-2" : "px-3")}>
        {shellPending ? (
          <NavSkeleton collapsed={collapsed} />
        ) : isPatientPortal ? (
          <NavGroup
            items={patientPortalNav}
            tr={tr}
            translations={t}
            collapsed={collapsed}
            counters={patientChatOpen ? { chat: counters.chatUnread } : undefined}
            onNavigate={closeOnCompactViewport}
            lockedLabel={shellText?.locked ?? (lang === "de" ? "Gesperrt" : "Закрыто")}
            onLocked={(id, label) => {
              setLockedModule({ id, label });
              closeOnCompactViewport();
            }}
          />
        ) : (
          <StaffNavGroups
            staffNavBySection={staffNavBySection}
            tr={tr}
            translations={t}
            collapsed={collapsed}
            counters={{ chat: counters.chatUnread, leads: counters.newLeads }}
            onNavigate={closeOnCompactViewport}
          />
        )}
      </div>

      <div className={cn("shrink-0 border-t border-sidebar-border", collapsed ? "py-2 px-2" : "py-3 px-3")}>
        <button
          type="button"
          onClick={logout}
          title={collapsed && !shellPending ? logoutLabel : undefined}
          aria-label={logoutLabel}
          aria-busy={shellPending || undefined}
          className={cn(
            "flex items-center rounded-lg text-sidebar-foreground/85 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring motion-reduce:transition-none",
            collapsed ? "justify-center size-11 mx-auto" : "gap-3 w-full px-3 py-2.5 text-sm",
          )}
        >
          <LogOut aria-hidden="true" className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed && (shellPending
            ? <span aria-hidden="true" className="h-3.5 w-20 animate-pulse rounded bg-sidebar-foreground/15 motion-reduce:animate-none" />
            : <span className="whitespace-nowrap overflow-hidden">{logoutLabel}</span>)}
        </button>
      </div>
    </nav>
    {isLeadPortal && lockedModule ? <LeadPortalPlanDialog
      key={lockedModule.id}
      lang={cabinetLang}
      // The whole portal, not one module: the server knows it as "services".
      moduleId={lockedModule.id === LEAD_PORTAL_AFTER_REQUEST ? "services" : lockedModule.id}
      moduleLabel={lockedModule.label}
      features={lockedModule.id === LEAD_PORTAL_AFTER_REQUEST ? leadPortalFeatureLabels(cabinetLang) : undefined}
      onClose={() => setLockedModule(null)}
    /> : null}
    {!isLeadPortal && lockedModule ? <PortalSubscriptionLock paused={subscriptionPaused} label={lockedModule.label} onClose={() => setLockedModule(null)} /> : null}
    </>
  );
}

function StaffNavGroups({
  staffNavBySection,
  tr,
  translations,
  collapsed,
  counters,
  onNavigate,
}: {
  staffNavBySection: Map<StaffNavSection, NavItem[]>;
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
  counters?: NavCounterMap;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const groupId = useId();
  const [closedSections, setClosedSections] = useLocalStorage<StaffNavSection[]>("gmed_nav_closed_sections", [], navSectionsSerializer);
  const [manuallyClosedLocation, setManuallyClosedLocation] = useState<typeof location | null>(null);
  const sections = STAFF_NAV_SECTIONS.filter((section) => (staffNavBySection.get(section)?.length ?? 0) > 0);
  const activeSection = sections.find((section) => staffNavBySection.get(section)?.some((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
  ));

  return (
    <div className="navigation-groups flex flex-col gap-4">
      {sections.map((section) => {
        const open = collapsed || !closedSections.includes(section) || (activeSection === section && manuallyClosedLocation !== location);
        const panelId = `${groupId}-${section}`;
        return (
        <div key={section} className="flex flex-col gap-1">
          {!collapsed && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => {
                setClosedSections((current) => open ? [...new Set([...current, section])] : current.filter((item) => item !== section));
                if (activeSection === section) setManuallyClosedLocation(open ? location : null);
              }}
              className="navigation-section-label flex min-h-8 w-full items-center justify-between rounded-lg px-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
            >
              {sectionLabel(section, tr, translations)}
              <ChevronDown aria-hidden="true" className={cn("navigation-section-chevron size-3.5 transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
            </button>
          )}
          {collapsed && <SectionDivider />}
          <div id={panelId} hidden={!open}>
          <NavGroup
            items={staffNavBySection.get(section) ?? []}
            tr={tr}
            translations={translations}
            collapsed={collapsed}
            counters={counters}
            onNavigate={onNavigate}
          />
          </div>
        </div>
        );
      })}
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

type NavCounterMap = Partial<Record<string, number>>;

/**
 * The side bar of the lead cabinet before its language is known: the rows of the entries
 * without their names, in no language. Shown for a moment after sign-in at most.
 */
function NavSkeleton({ collapsed }: { collapsed: boolean }) {
  const widths = ["w-24", "w-20", "w-32", "w-16", "w-28", "w-24", "w-28", "w-20"];
  return (
    <div className="flex flex-col gap-0.5" aria-busy="true" data-testid="nav-panel-skeleton">
      {widths.map((width, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn("flex items-center", collapsed ? "mx-auto size-10 justify-center" : "h-9 gap-3 px-3")}
        >
          <span className={cn("shrink-0 animate-pulse rounded-md bg-sidebar-foreground/10 motion-reduce:animate-none", collapsed ? "size-5" : "size-[18px]")} />
          {!collapsed ? <span className={cn("h-3.5 animate-pulse rounded bg-sidebar-foreground/10 motion-reduce:animate-none", width)} /> : null}
        </div>
      ))}
    </div>
  );
}

// Labels too long for one line of the open sidebar ("Правовая информация и защита данных",
// "Meine Benachrichtigungen") wrap instead of being cut off; the others stay on one line.
const WRAPPING_NAV_ITEM_IDS: ReadonlySet<string> = new Set(["trusted_persons", "legal", "notifications"]);

function NavGroup({
  items,
  tr,
  translations,
  collapsed,
  counters,
  onNavigate,
  onLocked,
  lockedLabel,
}: {
  items: NavItem[];
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
  counters?: NavCounterMap;
  onNavigate: () => void;
  onLocked?: (id: string, label: string) => void;
  lockedLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = navItemIcon(item.id);
        const label = navItemLabel(item, tr, translations);
        const count = counters?.[item.id] ?? 0;
        if (item.locked) {
          return <button
            key={item.id}
            type="button"
            data-testid={`lead-portal-locked-${item.id}`}
            aria-label={`${label} — ${lockedLabel}`}
            aria-haspopup="dialog"
            title={`${label} — ${lockedLabel}`}
            onClick={() => onLocked?.(item.id, label)}
            className={cn(
              "relative flex items-center rounded-lg text-left text-sm text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring motion-reduce:transition-none",
              collapsed ? "mx-auto size-10 justify-center" : "h-9 gap-3 px-3",
            )}
          >
            <Icon aria-hidden="true" strokeWidth={1.6} className={cn("shrink-0", collapsed ? "size-5" : "size-[18px]")} />
            {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
            <LockKeyhole aria-hidden="true" className={cn("shrink-0 text-muted-foreground", collapsed ? "absolute bottom-0.5 right-0.5 size-2.5" : "size-3.5")} />
          </button>;
        }
        return (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.to === "/"}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "relative flex items-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring motion-reduce:transition-none",
                collapsed ? "justify-center size-10 mx-auto" : WRAPPING_NAV_ITEM_IDS.has(item.id) ? "gap-3 px-3 py-2 min-h-9" : "gap-3 px-3 h-9",
                isActive
                  ? "bg-muted text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                  : "text-sidebar-foreground/90 hover:text-sidebar-foreground hover:bg-sidebar-accent/60",
              )
            }
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                <Icon
                  aria-hidden="true"
                  strokeWidth={isActive ? 1.85 : 1.6}
                  className={cn(
                    "shrink-0",
                    collapsed ? "size-5" : "size-[18px]",
                    isActive && "text-foreground",
                  )}
                />
                {isActive && <span aria-hidden="true" data-slot="nav-selection-dot" className="pointer-events-none absolute left-0 top-0 size-1.5 rounded-full bg-[var(--dot,#ed6e2c)]" />}
                {!collapsed && (
                  <span className={cn("min-w-0 flex-1", WRAPPING_NAV_ITEM_IDS.has(item.id) ? "whitespace-normal leading-5" : "truncate whitespace-nowrap")}>{label}</span>
                )}
                {count > 0 ? (
                  collapsed ? (
                    <span className="absolute right-1 top-1 size-2 rounded-full bg-[var(--badge,var(--brand))]" />
                  ) : (
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--badge,var(--brand))]/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-[color-mix(in_srgb,var(--badge,var(--brand))_70%,var(--foreground))]">
                      {count > 99 ? "99+" : count}
                    </span>
                  )
                ) : null}
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
  return item.label ?? dictionary[item.labelKey] ?? formatUnknownValue(item.labelKey, translations);
}

function roleLabel(role: string, dictionary: Record<string, string>, translations: UnknownTranslations): string {
  return dictionary[`role_${role}`] ?? formatUnknownValue(role, translations);
}

function UserCard({
  name,
  role,
  roleText: roleTextOverride,
  hideRole = false,
  tr,
  translations,
  collapsed,
}: {
  name: string;
  role: string;
  /** Said instead of the role name (a parent's login in the lead cabinet). */
  roleText?: string | null;
  /** The name alone, without a caption (a lead's own login). */
  hideRole?: boolean;
  tr: Record<string, string>;
  translations: UnknownTranslations;
  collapsed: boolean;
}) {
  const roleText = roleTextOverride || roleLabel(role, tr, translations);

  if (collapsed) {
    return (
      <div
        title={hideRole ? name : `${name} - ${roleText}`}
        className="flex items-center justify-center size-10 mx-auto rounded-full bg-[var(--badge,var(--brand))] text-[12px] font-semibold text-[var(--badge-foreground,#fff)]"
      >
        {userInitials(name)}
      </div>
    );
  }
  return (
    <div className="navigation-user-card flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm">
      <div className="flex items-center justify-center size-9 shrink-0 rounded-full bg-[var(--badge,var(--brand))] text-[12px] font-semibold text-[var(--badge-foreground,#fff)]">
        {userInitials(name)}
      </div>
      <div className="min-w-0 flex-1">
        {/* A long name is cut: the tooltip reads it in full (QA 2026-11-10, A-13). */}
        <p className="truncate text-[13px] font-semibold text-foreground leading-tight" title={name}>{name}</p>
        {hideRole ? null : <p className="truncate text-[10px] font-semibold text-muted-foreground mt-0.5" title={roleText}>{roleText}</p>}
      </div>
    </div>
  );
}
