import { Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Banner, PageHeader } from "@/components/ui-shell";

type AppointmentsPageChromeProps = {
  title: string;
  createLabel: string;
  refreshTitle: string;
  canCreate: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  appointmentsError?: string | null;
  appointmentsNotice?: string | null;
  appointmentsAuxiliaryError?: string | null;
  metadataError?: string | null;
};

export function AppointmentsPageChrome({
  title,
  createLabel,
  refreshTitle,
  canCreate,
  onCreate,
  onRefresh,
  appointmentsError,
  appointmentsNotice,
  appointmentsAuxiliaryError,
  metadataError,
}: AppointmentsPageChromeProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        actions={
          <>
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
              variant="outline"
              size="icon-sm"
              onClick={onRefresh}
              title={refreshTitle}
              aria-label={refreshTitle}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </>
        }
      />

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
      {appointmentsAuxiliaryError ? (
        <Banner tone="warning" withIcon>
          {appointmentsAuxiliaryError}
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
