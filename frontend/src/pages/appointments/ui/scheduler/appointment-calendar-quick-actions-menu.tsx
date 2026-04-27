import { LoaderCircle } from "lucide-react";
import type { RefObject } from "react";

import { selectClass } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { statusActionKey } from "@/pages/appointments/model/form-factories";
import { statusLabel } from "@/pages/appointments/model/labels";
import type {
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  CalendarQuickActionMenuState,
} from "@/pages/appointments/model/types";

type AppointmentCalendarQuickActionsMenuProps = {
  menu: CalendarQuickActionMenuState;
  menuRef: RefObject<HTMLDivElement | null>;
  item: AppointmentListItem;
  dictionary: Record<string, string>;
  actionBusy: string;
  activeScope: AppointmentRecurringActionScope;
  onScopeChange: (scope: AppointmentRecurringActionScope) => void;
  onOpenDetail: (appointmentId: string) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    recurrenceScope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

export function AppointmentCalendarQuickActionsMenu({
  menu,
  menuRef,
  item,
  dictionary,
  actionBusy,
  activeScope,
  onScopeChange,
  onOpenDetail,
  onStatusChange,
}: AppointmentCalendarQuickActionsMenuProps) {
  return (
    <div
      ref={menuRef}
      id={`appointment-quick-actions-${item.id}`}
      role="menu"
      tabIndex={-1}
      aria-label={dictionary.appointments_quick_actions}
      className="fixed z-50 w-56 rounded-2xl border border-border bg-card p-2 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
      style={{
        top: `${menu.top}px`,
        left: `${menu.left}px`,
      }}
    >
      <div className="border-b border-border px-2 pb-2">
        <p className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {dictionary.appointments_quick_actions}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">
          {item.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.patient_pid} - {item.patient_name}
        </p>
      </div>
      <div className="mt-2 space-y-1">
        {item.recurrence_frequency ? (
          <label className="block rounded-xl border border-border bg-muted/25 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {dictionary.appointments_scope_apply_status}
            </span>
            <select
              value={activeScope}
              onChange={(event) =>
                onScopeChange(
                  event.target.value as AppointmentRecurringActionScope,
                )
              }
              className={cn(selectClass, "mt-2 h-9")}
            >
              <option value="single">{dictionary.appointments_scope_single}</option>
              <option value="following">
                {dictionary.appointments_scope_following}
              </option>
              <option value="series">{dictionary.appointments_scope_series}</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-muted/50"
          onClick={() => onOpenDetail(item.id)}
        >
          <span>{dictionary.appointments_open_detail}</span>
        </button>
        {item.status !== "confirmed" ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(actionBusy)}
            onClick={() => void onStatusChange(item.id, "confirmed", activeScope)}
          >
            <span>{dictionary.common_confirm}</span>
            {actionBusy === statusActionKey(item.id, "confirmed", activeScope) ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={Boolean(actionBusy)}
          onClick={() => void onStatusChange(item.id, "completed", activeScope)}
        >
          <span>{dictionary.dash_completed}</span>
          {actionBusy === statusActionKey(item.id, "completed", activeScope) ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : null}
        </button>
        {item.recurrence_frequency ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={Boolean(actionBusy)}
            onClick={() => void onStatusChange(item.id, "cancelled", activeScope)}
          >
            <span>
              {activeScope === "following"
                ? dictionary.appointments_cancel_this_and_following
                : activeScope === "series"
                  ? dictionary.appointments_cancel_whole_series
                  : statusLabel("cancelled")}
            </span>
            {actionBusy === statusActionKey(item.id, "cancelled", activeScope) ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
          </button>
        ) : null}
      </div>
    </div>
  );
}
