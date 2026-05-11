import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Plus,
  RefreshCw,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui-shell";
import { AdminInlineMetric } from "@/components/admin-page-patterns";

type AppointmentsPageChromeProps = {
  title: string;
  createLabel: string;
  refreshTitle: string;
  canCreate: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  todayLabel: string;
  activeLabel: string;
  pendingLabel: string;
  requestLabel: string;
  attentionLabel: string;
  totalLabel: string;
  todayAppointments: number;
  activeAppointments: number;
  pendingInterpreterResponses: number;
  appointmentRequestCount: number;
  attentionCount: number;
  totalAppointments: number;
  appointmentsError?: string | null;
  appointmentsNotice?: string | null;
  metadataError?: string | null;
};

export function AppointmentsPageChrome({
  title,
  createLabel,
  refreshTitle,
  canCreate,
  onCreate,
  onRefresh,
  todayLabel,
  activeLabel,
  pendingLabel,
  requestLabel,
  attentionLabel,
  totalLabel,
  todayAppointments,
  activeAppointments,
  pendingInterpreterResponses,
  appointmentRequestCount,
  attentionCount,
  totalAppointments,
  appointmentsError,
  appointmentsNotice,
  metadataError,
}: AppointmentsPageChromeProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5 rounded-lg px-3.5"
              onClick={onCreate}
            >
              <Plus className="size-3.5" />
              {createLabel}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="size-9 rounded-lg p-0 text-muted-foreground"
            onClick={onRefresh}
            title={refreshTitle}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={CalendarDays}
          tone="sky"
          label={todayLabel}
          value={todayAppointments}
        />
        <AdminInlineMetric
          icon={CheckCircle2}
          tone="emerald"
          label={activeLabel}
          value={activeAppointments}
        />
        <AdminInlineMetric
          icon={Clock3}
          tone="amber"
          label={pendingLabel}
          value={pendingInterpreterResponses}
        />
        <AdminInlineMetric
          icon={ClipboardList}
          tone="sky"
          label={requestLabel}
          value={appointmentRequestCount}
        />
        <AdminInlineMetric
          icon={AlertTriangle}
          tone="rose"
          label={attentionLabel}
          value={attentionCount}
        />
        <AdminInlineMetric
          icon={UsersRound}
          tone="slate"
          label={totalLabel}
          value={totalAppointments}
        />
      </div>

      {appointmentsError ? (
        <Banner tone="error" withIcon>
          {appointmentsError}
        </Banner>
      ) : null}
      {appointmentsNotice ? (
        <Banner tone="warning" withIcon>
          {appointmentsNotice}
        </Banner>
      ) : null}
      {metadataError ? (
        <Banner tone="warning" withIcon>
          {metadataError}
        </Banner>
      ) : null}
    </div>
  );
}
