import { memo } from "react";

import { Clock3, LoaderCircle, Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyCell, ListItem } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  statusActionKey,
} from "@/pages/appointments/model/form-factories";
import {
  operationalScopeReason,
} from "@/pages/appointments/model/operational-scopes";
import {
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  statusLabel,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentAttentionItem,
  AppointmentListItem,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  OperationalScope,
} from "@/pages/appointments/model/types";
import {
  appointmentStatusBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";
import {
  AppointmentPreviewSheet,
} from "@/pages/appointments/ui/shared/workspace-primitives";

export type QueueSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentsLoading: boolean;
  metadataLoading: boolean;
  items: AppointmentListItem[];
  openDetailSheet: (appointmentId: string) => void;
  operationalScope: OperationalScope;
  userRole?: string;
  attentionIndex: Map<string, AppointmentAttentionItem>;
  canManageStatus: boolean;
  actionBusy: string;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    scope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
};

function QueueSheet({
  open,
  onOpenChange,
  appointmentsLoading,
  metadataLoading,
  items,
  openDetailSheet,
  operationalScope,
  userRole,
  attentionIndex,
  canManageStatus,
  actionBusy,
  onStatusChange,
}: QueueSheetProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.appointments_title}
      maxWidthClassName="sm:max-w-[640px]"
    >
      {appointmentsLoading || metadataLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t.patients_syncing}
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyCell>{tr.common_not_set}</EmptyCell>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ListItem key={item.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openDetailSheet(item.id)}
                    className="truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-[var(--brand)]"
                  >
                    {item.title}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.patient_pid} · {item.patient_name}
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
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3.5" />
                  {slotLabel(item)}
                </span>
                {item.provider_name ? (
                  <span className="inline-flex items-center gap-1">
                    <Stethoscope className="size-3.5" />
                    {item.provider_name}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs font-medium text-muted-foreground">
                {operationalScopeReason(
                  item,
                  operationalScope,
                  userRole,
                  attentionIndex,
                  tr,
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() => openDetailSheet(item.id)}
                >
                  {t.providers_open}
                </Button>
                {canManageStatus &&
                item.status !== "confirmed" &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    disabled={Boolean(actionBusy)}
                    onClick={() => void onStatusChange(item.id, "confirmed")}
                  >
                    {actionBusy === statusActionKey(item.id, "confirmed") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.common_confirm}
                  </Button>
                ) : null}
                {canManageStatus &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    disabled={Boolean(actionBusy)}
                    onClick={() => void onStatusChange(item.id, "completed")}
                  >
                    {actionBusy === statusActionKey(item.id, "completed") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.dash_completed}
                  </Button>
                ) : null}
                {canManageStatus &&
                item.recurrence_frequency &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={Boolean(actionBusy)}
                      onClick={() =>
                        void onStatusChange(item.id, "cancelled", "following")
                      }
                    >
                      {actionBusy ===
                      statusActionKey(item.id, "cancelled", "following") ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {t.appointments_cancel_this_and_following}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={Boolean(actionBusy)}
                      onClick={() =>
                        void onStatusChange(item.id, "cancelled", "series")
                      }
                    >
                      {actionBusy ===
                      statusActionKey(item.id, "cancelled", "series") ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {t.appointments_cancel_whole_series}
                    </Button>
                  </>
                ) : null}
              </div>
            </ListItem>
          ))}
        </div>
      )}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedQueueSheet = memo(QueueSheet);
