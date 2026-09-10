import { ArrowLeft, BadgeCheck, CalendarClock, ClipboardList, FileSignature, FolderOpen, History, ReceiptText, ShieldCheck, Stethoscope, UserRound, UsersRound, Wallet } from "lucide-react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { AiMark } from "@/components/ui/ai-mark";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  canViewPatientCareHistorySurface,
  canViewPatientClinicalProfile,
  canViewPatientContractsSurface,
  canViewPatientDocumentsSurface,
  canViewPatientInvoicesSurface,
  canViewPatientFinanceSurface,
  canViewPatientOperationalSurface,
  normalizePatientDetailTab,
} from "../model/detail-model";

import { patientWorkspaceNavigation } from "../model/patient-navigation";

const icons = { profile: UserRound, clinical: Stethoscope, "medication-ai": AiMark, relations: UsersRound, orders: ClipboardList, appointments: CalendarClock, documents: FolderOpen, contracts: FileSignature, invoices: ReceiptText, finance: Wallet, workflow: BadgeCheck, curators: ShieldCheck, timeline: History };

export function PatientWorkspaceNav() {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const id = routeId ?? searchParams.get("patient") ?? undefined;
  const { user } = useAuth();
  const { t, lang } = useLang();

  const canViewOperationalSurface = canViewPatientOperationalSurface(user?.role);
  const canViewCareHistory = canViewPatientCareHistorySurface(user?.role);
  const canViewClinical = canViewPatientClinicalProfile(user?.role);
  const canUseMedicationAi = user?.role === "ceo";
  const canViewDocuments = canViewPatientDocumentsSurface(user?.role);
  const canViewContracts = canViewPatientContractsSurface(user?.role);
  const canViewInvoices = canViewPatientInvoicesSurface(user?.role);
  const canViewFinance = canViewPatientFinanceSurface(user?.role);
  const contextualTab = location.pathname.startsWith("/orders/")
    ? "orders"
    : searchParams.get("tab");
  const currentTab = id
    ? normalizePatientDetailTab(routeId ? searchParams.get("tab") : contextualTab, {
        canViewOperationalSurface,
        canViewCareHistory,
        canViewClinical,
        canUseMedicationAi,
        canViewDocuments,
        canViewContracts,
        canViewInvoices,
        canViewFinance,
      })
    : null;

  const items = patientWorkspaceNavigation(user?.role, lang, t);
  const groups = [...new Map(items.map(item => [item.group, item.groupLabel])).entries()];

  if (!id) return null;

  return (
    <aside
      data-workspace-rail="patient"
      className="hidden lg:ml-1 lg:mt-1 lg:flex lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="px-6 pt-4">
        <StaffLink
          to="/patients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.patients_title}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav aria-label={lang === "de" ? "Patientenbereiche" : "Разделы пациента"} className="space-y-4">
          {groups.map(([group, label]) => <section key={group} className="border-t border-border/60 pt-3 first:border-0 first:pt-0">
            <h2 className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
            <div className="flex flex-col gap-0.5">
              {items.filter(item => item.group === group).map((item) => {
                const isActive = currentTab !== null && currentTab === item.key;
                const Icon = icons[item.key as keyof typeof icons];
                const to =
                  item.key === "profile" ? `/patients/${id}` : `/patients/${id}?tab=${item.key}`;

                return (
                  <StaffLink
                    key={item.key}
                    replace
                    to={to}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                      isActive
                        ? "bg-muted/60 text-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-[var(--brand)]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <Icon
                      className={cn(
                        "shrink-0 size-[18px] transition-colors",
                        isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                      )}
                      strokeWidth={isActive ? 1.85 : 1.7}
                    />
                    <span className="truncate font-medium leading-5">{item.label}</span>
                  </StaffLink>
                );
              })}
            </div>
          </section>)}
        </nav>
      </div>
    </aside>
  );
}
