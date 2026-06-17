import { ArrowLeft, BadgeCheck, CalendarClock, ClipboardList, FileHeart, FileSignature, FolderOpen, History, ReceiptText, ShieldCheck, type LucideIcon, UserRound, UsersRound } from "lucide-react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  canViewPatientClinicalProfile,
  canViewPatientContractsSurface,
  canViewPatientDocumentsSurface,
  canViewPatientInvoicesSurface,
  canViewPatientOperationalSurface,
  normalizePatientDetailTab,
} from "../model/detail-model";

type WorkspaceItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

export function PatientWorkspaceNav() {
  const { id: routeId } = useParams<{ id: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const id = routeId ?? searchParams.get("patient") ?? undefined;
  const { user } = useAuth();
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;

  const canViewOperationalSurface = canViewPatientOperationalSurface(user?.role);
  const canViewClinical = canViewPatientClinicalProfile(user?.role);
  const canViewDocuments = canViewPatientDocumentsSurface(user?.role);
  const canViewContracts = canViewPatientContractsSurface(user?.role);
  const canViewInvoices = canViewPatientInvoicesSurface(user?.role);
  const contextualTab = location.pathname.startsWith("/orders/")
    ? "orders"
    : location.pathname.startsWith("/cases/")
      ? "cases"
      : searchParams.get("tab");
  const currentTab = routeId
    ? normalizePatientDetailTab(searchParams.get("tab"), {
        canViewOperationalSurface,
        canViewClinical,
        canViewDocuments,
        canViewContracts,
        canViewInvoices,
      })
    : id
      ? normalizePatientDetailTab(contextualTab, {
          canViewOperationalSurface,
          canViewClinical,
          canViewDocuments,
          canViewContracts,
          canViewInvoices,
        })
      : null;

  const items: WorkspaceItem[] = [
    {
      key: "profile",
      label: t.patients_profile,
      icon: UserRound,
    },
    canViewOperationalSurface
      ? {
          key: "relations",
          label: t.patients_relations,
          icon: UsersRound,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "cases",
          label: l("patients_cases"),
          icon: FileHeart,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "orders",
          label: l("patients_orders"),
          icon: ClipboardList,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "appointments",
          label: l("patients_appointments"),
          icon: CalendarClock,
        }
      : null,
    canViewDocuments
      ? {
          key: "documents",
          label: t.documents_title,
          icon: FolderOpen,
        }
      : null,
    canViewContracts
      ? {
          key: "contracts",
          label: t.contracts_title,
          icon: FileSignature,
        }
      : null,
    canViewInvoices
      ? {
          key: "invoices",
          label: t.invoices_title,
          icon: ReceiptText,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "workflow",
          label: t.patients_workflow,
          icon: BadgeCheck,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "curators",
          label: t.patients_assign_owner,
          icon: ShieldCheck,
        }
      : null,
    canViewOperationalSurface
      ? {
          key: "timeline",
          label: t.patients_timeline,
          icon: History,
        }
      : null,
  ].filter((item): item is WorkspaceItem => Boolean(item));

  if (!id) return null;

  return (
    <aside
      data-workspace-rail="patient"
      className="hidden lg:flex lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="px-4 pt-4">
        <StaffLink
          to="/patients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.patients_title}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {items.map((item) => {
            const isActive = currentTab !== null && currentTab === item.key;
            const Icon = item.icon;
            const to =
              item.key === "profile" ? `/patients/${id}` : `/patients/${id}?tab=${item.key}`;

            return (
              <StaffLink
                key={item.key}
                replace
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 h-10 text-sm transition-colors",
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
      </div>
    </aside>
  );
}
