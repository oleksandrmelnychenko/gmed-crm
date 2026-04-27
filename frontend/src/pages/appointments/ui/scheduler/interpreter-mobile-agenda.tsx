import {
  CalendarClock,
  CalendarDays,
  Clock3,
  MapPin,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  appointmentMobileAgendaCardClassName,
  appointmentMobileAgendaInfoBadgeClassName,
  appointmentMobileAgendaNeutralBadgeClassName,
  appointmentMobileAgendaQuickScopeClassName,
  appointmentMobileAgendaSearchInputClassName,
  appointmentMobileAgendaStatToneClassName,
  appointmentMobileAgendaWarningBadgeClassName,
} from "@/pages/appointments/appearance/scheduler-appearance";
import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import { appointmentStatusBadgeClassName } from "@/pages/appointments/appearance/status-appearance";
import {
  appointmentText,
  responseLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import { recurrenceCadenceLabel } from "@/pages/appointments/model/recurrence";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import type {
  AppointmentListItem,
  OperationalScope,
} from "@/pages/appointments/model/types";
import {
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type MobileAgendaSection = {
  date: string;
  label: string;
  itemCount: number;
  pendingResponseCount: number;
  items: AppointmentListItem[];
};

type InterpreterMobileAgendaProps = {
  todayLabel: string;
  pendingLabel: string;
  weekLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  resetLabel: string;
  todayScopeLabel: string;
  weekScopeLabel: string;
  mineScopeLabel: string;
  todayAppointments: number;
  mobileAgendaPendingCount: number;
  mobileAgendaWeekCount: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  todayScopeActive: boolean;
  weekScopeActive: boolean;
  mineScopeActive: boolean;
  onApplyTodayScope: () => void;
  onApplyWeekScope: () => void;
  onApplyMineScope: () => void;
  scopeOptions: Array<{ id: OperationalScope; label: string }>;
  activeOperationalScope: OperationalScope;
  onApplyOperationalScope: (scope: OperationalScope) => void;
  onResetQuickScopes: () => void;
  sections: MobileAgendaSection[];
  emptyText: string;
  onOpenDetail: (id: string) => void;
};

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return normalized.endsWith("...") ? normalized : `${normalized}...`;
}

function StatsCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "sky" | "amber" | "slate";
}) {
  return (
    <div className="relative flex h-full min-w-0 flex-col rounded-[1.2rem] border border-white/90 bg-white/88 p-3 pr-10 backdrop-blur">
      <span className="block w-full whitespace-normal break-words text-left text-[11px] font-semibold uppercase leading-tight tracking-[0.08em] text-slate-600">
        {label}
      </span>
      <p className="mt-auto pt-2 text-[2rem] leading-none font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <span
        className={cn(
          "absolute right-2 bottom-2 shrink-0 rounded-xl p-1.5",
          appointmentMobileAgendaStatToneClassName(tone),
        )}
      >
        <Icon className="size-3.5" />
      </span>
    </div>
  );
}

function QuickScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className={appointmentMobileAgendaQuickScopeClassName(active)}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function MobileAgendaCard({
  item,
  onOpen,
}: {
  item: AppointmentListItem;
  onOpen: () => void;
}) {
  const summary =
    item.doctor_name ||
    item.provider_name ||
    item.location ||
    item.owner_name ||
    appointmentText(
      "Operativer Slot",
      "Operativer Slot",
      "Operational slot",
    );

  return (
    <div className={appointmentMobileAgendaCardClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left text-sm font-semibold text-foreground hover:text-[var(--brand)]"
          >
            {item.title}
          </button>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {item.patient_pid} - {item.patient_name}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
            appointmentStatusBadgeClassName(item.status),
          )}
        >
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" />
          {slotLabel(item)}
        </span>
        {item.location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {item.location}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-medium text-muted-foreground">{summary}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {item.interpreter_response ? (
          <span className={appointmentMobileAgendaInfoBadgeClassName}>
            {appointmentText("Dolmetscher", "Переводчик", "Interpreter")} {responseLabel(item.interpreter_response)}
          </span>
        ) : null}
        {item.recurrence_frequency ? (
          <span className={appointmentMobileAgendaNeutralBadgeClassName}>
            {recurrenceCadenceLabel(item)}
          </span>
        ) : null}
        {item.is_blocked ? (
          <span className={appointmentMobileAgendaWarningBadgeClassName}>
            {appointmentText(
              "Blockierte Sicht",
              "Blockierte Sicht",
              "Blocked visibility",
            )}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-2xl"
          onClick={onOpen}
        >
          {appointmentText("Open", "Open", "Open")}
        </Button>
      </div>
    </div>
  );
}

export function InterpreterMobileAgenda({
  todayLabel,
  pendingLabel,
  weekLabel,
  searchLabel,
  searchPlaceholder,
  resetLabel,
  todayScopeLabel,
  weekScopeLabel,
  mineScopeLabel,
  todayAppointments,
  mobileAgendaPendingCount,
  mobileAgendaWeekCount,
  searchValue,
  onSearchChange,
  todayScopeActive,
  weekScopeActive,
  mineScopeActive,
  onApplyTodayScope,
  onApplyWeekScope,
  onApplyMineScope,
  scopeOptions,
  activeOperationalScope,
  onApplyOperationalScope,
  onResetQuickScopes,
  sections,
  emptyText,
  onOpenDetail,
}: InterpreterMobileAgendaProps) {
  return (
    <div className="space-y-4">
      <section className={appointmentSectionCardClassName("p-4")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatsCard
            icon={CalendarDays}
            label={todayLabel}
            value={String(todayAppointments)}
            tone="sky"
          />
          <StatsCard
            icon={UsersRound}
            label={pendingLabel}
            value={String(mobileAgendaPendingCount)}
            tone="amber"
          />
          <StatsCard
            icon={CalendarClock}
            label={weekLabel}
            value={String(mobileAgendaWeekCount)}
            tone="slate"
          />
        </div>
      </section>

      <section className={appointmentSectionCardClassName("p-4")}>
        <div className="space-y-4">
          <Field label={searchLabel}>
            <Input
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={withEllipsis(searchPlaceholder)}
              className={appointmentMobileAgendaSearchInputClassName}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <QuickScopeButton
              active={todayScopeActive}
              onClick={onApplyTodayScope}
            >
              {todayScopeLabel}
            </QuickScopeButton>
            <QuickScopeButton active={weekScopeActive} onClick={onApplyWeekScope}>
              {weekScopeLabel}
            </QuickScopeButton>
            <QuickScopeButton active={mineScopeActive} onClick={onApplyMineScope}>
              {mineScopeLabel}
            </QuickScopeButton>
            {scopeOptions.length > 1
              ? scopeOptions.map((option) => (
                  <QuickScopeButton
                    key={option.id}
                    active={activeOperationalScope === option.id}
                    onClick={() => onApplyOperationalScope(option.id)}
                  >
                    {option.label}
                  </QuickScopeButton>
                ))
              : null}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-3"
              onClick={onResetQuickScopes}
            >
              {resetLabel}
            </Button>
          </div>
        </div>
      </section>

      {sections.length === 0 ? (
        <section className={appointmentSectionCardClassName("p-5")}>
          <EmptyState text={emptyText} />
        </section>
      ) : (
        sections.map((section) => (
          <section
            key={section.date}
            className={appointmentSectionCardClassName("p-4 md:p-5")}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {section.label}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {section.itemCount} {appointmentText("Termine", "приемы", "appointments")}
                  {section.pendingResponseCount > 0
                    ? ` - ${section.pendingResponseCount} ${appointmentText("warten auf Antwort", "ожидают ответа", "pending responses")}`
                    : ""}
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {section.itemCount}
              </span>
            </div>
            <div className="space-y-3">
              {section.items.map((item) => (
                <MobileAgendaCard
                  key={item.id}
                  item={item}
                  onOpen={() => onOpenDetail(item.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
