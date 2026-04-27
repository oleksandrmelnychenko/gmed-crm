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
import { AptKpi } from "@/pages/appointments/ui/shared/workspace-primitives";

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
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {title}
          </h1>
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
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 rounded-lg p-0 text-muted-foreground"
          onClick={onRefresh}
          title={refreshTitle}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border/60 xl:grid-cols-6">
        <AptKpi
          icon={CalendarDays}
          tone="sky"
          label={todayLabel}
          value={todayAppointments}
        />
        <AptKpi
          icon={CheckCircle2}
          tone="emerald"
          label={activeLabel}
          value={activeAppointments}
        />
        <AptKpi
          icon={Clock3}
          tone="amber"
          label={pendingLabel}
          value={pendingInterpreterResponses}
        />
        <AptKpi
          icon={ClipboardList}
          tone="sky"
          label={requestLabel}
          value={appointmentRequestCount}
        />
        <AptKpi
          icon={AlertTriangle}
          tone="rose"
          label={attentionLabel}
          value={attentionCount}
        />
        <AptKpi
          icon={UsersRound}
          tone="neutral"
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
