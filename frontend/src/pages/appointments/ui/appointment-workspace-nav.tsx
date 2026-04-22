import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  FileHeart,
  History,
  NotebookPen,
  ReceiptText,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { normalizeAppointmentWorkspaceTab } from "@/pages/appointments/model/selectors";

type WorkspaceItem = {
  key: string;
  label: string;
  icon: LucideIcon;
};

export function AppointmentWorkspaceNav() {
  const [searchParams] = useSearchParams();
  const { lang, t } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  const appointmentId = searchParams.get("appointment");
  const currentTab = normalizeAppointmentWorkspaceTab(
    searchParams.get("detailTab"),
  );

  const items: WorkspaceItem[] = [
    {
      key: "overview",
      label: l("Überblick", "Обзор", "Overview"),
      icon: CalendarClock,
    },
    {
      key: "timeline",
      label: l("Timeline", "Таймлайн", "Timeline"),
      icon: History,
    },
    {
      key: "coordination",
      label: l("Koordination", "Координация", "Coordination"),
      icon: Waypoints,
    },
    {
      key: "clinical",
      label: l("Klinik", "Клиника", "Clinical"),
      icon: FileHeart,
    },
    {
      key: "workflow",
      label: l("Arbeitsablauf", "Рабочий процесс", "Workflow"),
      icon: ClipboardList,
    },
    {
      key: "services",
      label: l("Services", "Сервисы", "Services"),
      icon: ReceiptText,
    },
    {
      key: "notes",
      label: l("Notizen", "Заметки", "Notes"),
      icon: NotebookPen,
    },
  ];

  if (!appointmentId) return null;

  const backParams = new URLSearchParams(searchParams);
  backParams.delete("appointment");
  backParams.delete("detailTab");
  const backSearch = backParams.toString();
  const backTo = backSearch ? `/appointments?${backSearch}` : "/appointments";

  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 xl:w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="px-4 pt-4">
        <StaffLink
          replace
          to={backTo}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.appointments_title}
        </StaffLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {items.map((item) => {
            const isActive = currentTab === item.key;
            const Icon = item.icon;
            const params = new URLSearchParams(searchParams);
            params.set("appointment", appointmentId);
            params.set("detailTab", item.key);
            const to = `/appointments?${params.toString()}`;

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
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "shrink-0 size-[18px] transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground group-hover:text-foreground",
                  )}
                  strokeWidth={isActive ? 1.85 : 1.7}
                />
                <span className="truncate font-medium leading-5">
                  {item.label}
                </span>
              </StaffLink>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
