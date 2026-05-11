import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatUnknownValue, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type CaseRosterItem = {
  id: string;
  case_uuid?: string;
  case_id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  status: string;
  hauptanfragegrund: string | null;
  created_at: string;
};

type CasesRosterSectionProps = {
  title: string;
  subtitle: string;
  counterLabel: string;
  showHeader?: boolean;
  loading: boolean;
  loadingLabel: string;
  error?: string;
  renderError?: (error: string) => ReactNode;
  items: CaseRosterItem[];
  emptyState: ReactNode;
  onCaseClick?: (item: CaseRosterItem) => void;
  caseStatusLabel?: (status: string) => string;
  caseStatusBadgeClassName?: (status: string) => string;
  reasonLabel: string;
  createdLabel: string;
  notSetLabel: string;
  formatDateTimeLabel: (value?: string | null) => string;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  counterClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  interactiveItemClassName?: string;
};

export function CasesRosterSection({
  title,
  subtitle,
  counterLabel,
  showHeader = true,
  loading,
  loadingLabel,
  error,
  renderError,
  items,
  emptyState,
  onCaseClick,
  caseStatusLabel,
  caseStatusBadgeClassName,
  reasonLabel,
  createdLabel,
  notSetLabel,
  formatDateTimeLabel,
  className,
  headerClassName,
  titleClassName,
  subtitleClassName,
  counterClassName,
  listClassName,
  itemClassName,
  interactiveItemClassName,
}: CasesRosterSectionProps) {
  const { t } = useLang();

  return (
    <section className={className}>
      {showHeader ? (
        <div className={cn("flex items-center justify-between gap-3", headerClassName)}>
          <div>
            <h2 className={cn("text-sm font-semibold text-zinc-950", titleClassName)}>
              {title}
            </h2>
            <p className={cn("mt-1 text-sm text-zinc-600", subtitleClassName)}>
              {subtitle}
            </p>
          </div>
          <div
            className={cn(
              "text-xs uppercase tracking-[0.12em] text-zinc-500",
              counterClassName,
            )}
          >
            {counterLabel}
          </div>
        </div>
      ) : null}

      {error
        ? renderError
          ? renderError(error)
          : (
              <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )
        : null}

      {loading ? (
        <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {loadingLabel}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5">{emptyState}</div>
      ) : (
        <div className={cn("mt-5 grid gap-4 xl:grid-cols-2", listClassName)}>
          {items.map((item) => {
            const cardClassName = cn(
              "rounded-[1.6rem] border border-zinc-200 bg-white p-5 text-left",
              itemClassName,
              onCaseClick
                ? cn(
                    "transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]",
                    interactiveItemClassName,
                  )
                : null,
            );

            if (onCaseClick) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onCaseClick(item)}
                  className={cardClassName}
                >
                  <CaseCardContent
                    item={item}
                    statusLabel={
                      caseStatusLabel
                        ? caseStatusLabel(item.status)
                        : formatUnknownValue(item.status, t)
                    }
                    statusClassName={
                      caseStatusBadgeClassName ? caseStatusBadgeClassName(item.status) : ""
                    }
                    reasonLabel={reasonLabel}
                    createdLabel={createdLabel}
                    notSetLabel={notSetLabel}
                    createdAtLabel={formatDateTimeLabel(item.created_at)}
                  />
                </button>
              );
            }

            return (
              <div key={item.id} className={cardClassName}>
                <CaseCardContent
                  item={item}
                  statusLabel={
                    caseStatusLabel
                      ? caseStatusLabel(item.status)
                      : formatUnknownValue(item.status, t)
                  }
                  statusClassName={
                    caseStatusBadgeClassName ? caseStatusBadgeClassName(item.status) : ""
                  }
                  reasonLabel={reasonLabel}
                  createdLabel={createdLabel}
                  notSetLabel={notSetLabel}
                  createdAtLabel={formatDateTimeLabel(item.created_at)}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CaseCardContent({
  item,
  statusLabel,
  statusClassName,
  reasonLabel,
  createdLabel,
  notSetLabel,
  createdAtLabel,
}: {
  item: CaseRosterItem;
  statusLabel: string;
  statusClassName: string;
  reasonLabel: string;
  createdLabel: string;
  notSetLabel: string;
  createdAtLabel: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-semibold tracking-[0.16em] text-zinc-500">
            {item.case_id}
          </div>
          <h3 className="mt-2 text-lg font-semibold text-zinc-950">
            {item.patient_name}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">{item.patient_pid}</p>
        </div>
        <Badge variant="outline" className={cn("rounded-full", statusClassName)}>
          {statusLabel}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {reasonLabel}
          </div>
          <div className="mt-2 text-sm text-zinc-900">
            {item.hauptanfragegrund?.trim() || notSetLabel}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {createdLabel}
          </div>
          <div className="mt-2 text-sm text-zinc-900">{createdAtLabel}</div>
        </div>
      </div>
    </div>
  );
}
