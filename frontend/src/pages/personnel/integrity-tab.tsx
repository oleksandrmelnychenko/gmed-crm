import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, ShieldCheck, Stamp } from "lucide-react";

import { AdminTableCard } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Banner, EmptyCell, STATUS_TONE, StatusBadge, TabLoader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { personnelApi, type PersonnelAnchor, type PersonnelIntegrity, type PersonnelIntegrityRun } from "./api";
import { RowIconAction, errorMessage } from "./personnel-ui";

/**
 * Proof of integrity: the weekly (or manual) re-check of every file against
 * its SHA-256 and the hash chain, and the daily chain anchors with their
 * RFC 3161 time stamps.
 */
export function IntegrityTab({ canManage }: { canManage: boolean }) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [data, setData] = useState<PersonnelIntegrity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"run" | "anchor" | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    personnelApi
      .integrity()
      .then(setData)
      .catch((reason: unknown) => setError(errorMessage(reason, t.common_failed_load)))
      .finally(() => setLoading(false));
  }, [t.common_failed_load]);

  useEffect(() => load(), [load]);

  const act = async (kind: "run" | "anchor") => {
    setBusy(kind);
    try {
      if (kind === "run") {
        const run = await personnelApi.runIntegrity();
        if (run.status === "passed") toast.success(t.personnel_integrity_passed_toast);
        else toast.error(t.personnel_integrity_failed_toast);
      } else {
        await personnelApi.anchorNow();
        toast.success(t.personnel_anchor_done);
      }
      load();
    } catch (reason) {
      toast.error(errorMessage(reason, t.common_failed_update));
    } finally {
      setBusy(null);
    }
  };

  const runs = useMemo(() => data?.runs ?? [], [data]);
  const anchors = useMemo(() => data?.anchors ?? [], [data]);
  // The failures shown under the table: the chosen run, else the newest run with failures.
  const failingRun =
    runs.find((run) => run.id === selectedRunId && run.failures.length > 0) ??
    runs.find((run) => run.failures.length > 0) ??
    null;

  const runColumns = useMemo<ColumnDef<PersonnelIntegrityRun>[]>(
    () => [
      {
        id: "status",
        label: t.personnel_status,
        accessor: (run) => tr[`personnel_run_${run.status}`] ?? run.status,
        filterType: "enum",
        filterOptions: ["running", "passed", "failed", "error"].map((status) => ({
          value: tr[`personnel_run_${status}`] ?? status,
          label: tr[`personnel_run_${status}`] ?? status,
        })),
        sortable: true,
        width: 160,
        render: (run) => (
          <StatusBadge status={run.status} tone={run.status === "error" ? "warning" : undefined}>
            {tr[`personnel_run_${run.status}`] ?? run.status}
          </StatusBadge>
        ),
      },
      {
        id: "started_at",
        label: t.personnel_integrity_started,
        accessor: (run) => run.started_at,
        filterType: "date",
        sortable: true,
        width: 160,
        render: (run) => <span className="text-xs tabular-nums">{formatAppDateTime(run.started_at)}</span>,
      },
      {
        id: "trigger",
        label: t.personnel_integrity_trigger,
        accessor: (run) => `${tr[`personnel_trigger_${run.trigger}`] ?? run.trigger} ${run.started_by_name ?? ""}`.trim(),
        filterType: "text",
        sortable: true,
        width: 220,
        render: (run) => (
          <span className="truncate text-xs">
            {tr[`personnel_trigger_${run.trigger}`] ?? run.trigger}
            {run.started_by_name ? ` · ${run.started_by_name}` : ""}
          </span>
        ),
      },
      {
        id: "checked",
        label: t.personnel_integrity_checked,
        accessor: (run) => run.documents_checked,
        filterType: "number",
        sortable: true,
        width: 200,
        render: (run) => (
          <span className="text-xs tabular-nums">
            {run.employees_checked} {t.personnel_integrity_employees} · {run.documents_checked}{" "}
            {t.personnel_integrity_documents}
          </span>
        ),
      },
      {
        id: "failures",
        label: t.personnel_integrity_failures,
        accessor: (run) => run.failures.length,
        filterType: "number",
        sortable: true,
        align: "right",
        width: 120,
        render: (run) =>
          run.failures.length > 0 ? (
            <StatusBadge tone="error">{run.failures.length}</StatusBadge>
          ) : (
            <span className="text-muted-foreground">0</span>
          ),
      },
    ],
    [t, tr],
  );

  const anchorColumns = useMemo<ColumnDef<PersonnelAnchor>[]>(
    () => [
      {
        id: "anchor_date",
        label: t.personnel_anchor_date,
        accessor: (anchor) => anchor.anchor_date,
        filterType: "date",
        sortable: true,
        width: 120,
        render: (anchor) => <span className="text-xs tabular-nums">{formatAppDate(anchor.anchor_date)}</span>,
      },
      {
        id: "anchor_hash",
        label: t.personnel_anchor_hash,
        accessor: (anchor) => anchor.anchor_hash,
        filterType: "text",
        width: 260,
        render: (anchor) => (
          <span className="truncate font-mono text-xs" title={anchor.anchor_hash}>
            {anchor.anchor_hash}
          </span>
        ),
      },
      {
        id: "counts",
        label: `${t.personnel_integrity_documents} / ${t.personnel_integrity_employees}`,
        accessor: (anchor) => anchor.document_count,
        filterType: "number",
        sortable: true,
        align: "right",
        width: 150,
        render: (anchor) => `${anchor.document_count} / ${anchor.employee_count}`,
      },
      {
        id: "tsa_status",
        label: t.personnel_tsa_status,
        accessor: (anchor) => tr[`personnel_tsa_${anchor.tsa_status}`] ?? anchor.tsa_status,
        filterType: "enum",
        filterOptions: ["pending", "stamped", "failed", "disabled"].map((status) => ({
          value: tr[`personnel_tsa_${status}`] ?? status,
          label: tr[`personnel_tsa_${status}`] ?? status,
        })),
        sortable: true,
        width: 140,
        render: (anchor) => (
          <StatusBadge status={anchor.tsa_status}>
            {tr[`personnel_tsa_${anchor.tsa_status}`] ?? anchor.tsa_status}
          </StatusBadge>
        ),
      },
      {
        id: "tsa_time",
        label: t.personnel_tsa_time,
        accessor: (anchor) => anchor.tsa_gen_time ?? "",
        filterType: "date",
        sortable: true,
        width: 160,
        render: (anchor) => (
          <span className="text-xs tabular-nums">{anchor.tsa_gen_time ? formatAppDateTime(anchor.tsa_gen_time) : "—"}</span>
        ),
      },
      {
        id: "tsa_error",
        label: t.personnel_tsa_error,
        accessor: (anchor) => (anchor.tsa_status !== "stamped" ? anchor.tsa_last_error ?? "" : ""),
        filterType: "text",
        width: 260,
        render: (anchor) =>
          anchor.tsa_last_error && anchor.tsa_status !== "stamped" ? (
            <span className="truncate text-xs text-destructive" title={anchor.tsa_last_error}>
              {anchor.tsa_attempts}× · {anchor.tsa_last_error}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [t, tr],
  );

  return (
    <div className="space-y-5">
      {data && !data.tsa_configured ? (
        <Banner tone="warning" withIcon>
          {t.personnel_tsa_not_configured}
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && !data ? <TabLoader /> : null}

      {data ? (
        <>
          <AdminTableCard
            title={t.personnel_integrity_runs}
            count={runs.length}
            accessory={
              canManage ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg"
                  disabled={busy !== null}
                  onClick={() => void act("run")}
                >
                  {busy === "run" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {t.personnel_integrity_run_now}
                </Button>
              ) : null
            }
          >
            <p className="px-1 text-xs text-muted-foreground">{t.personnel_integrity_intro}</p>
            <DataTableSurface
              rows={runs}
              columns={runColumns}
              rowId={(run) => run.id}
              activeRowId={failingRun?.id ?? null}
              defaultDensity="comfortable"
              dictionary={tr}
              storageKey="personnel-integrity-runs"
              onRowClick={(run) => setSelectedRunId(run.id)}
              mobilePrimaryColumnId="started_at"
              mobileDetailColumnIds={["status", "trigger", "checked", "failures"]}
              pagination={{ pageSize: 20 }}
              emptyState={<EmptyCell>{t.personnel_integrity_no_runs}</EmptyCell>}
            />
            {failingRun ? (
              <div className={cn("space-y-1 rounded-lg border px-3 py-2 text-xs", STATUS_TONE.error)} role="status">
                <p className="font-medium">
                  {formatUiText(t.personnel_integrity_failures_of, { date: formatAppDateTime(failingRun.started_at) })}
                </p>
                <ul className="space-y-0.5">
                  {failingRun.failures.map((failure, index) => (
                    <li key={`${failure.document_id ?? failure.employee_id ?? "chain"}-${index}`}>
                      {failure.employee_id ? (
                        <>
                          <StaffLink to={`/personnel/${failure.employee_id}`} className="font-medium underline">
                            {t.personnel_open_file}
                          </StaffLink>{" "}
                        </>
                      ) : null}
                      {failure.problem}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </AdminTableCard>

          <AdminTableCard
            title={t.personnel_anchors}
            count={anchors.length}
            accessory={
              canManage ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 rounded-lg"
                  disabled={busy !== null}
                  onClick={() => void act("anchor")}
                >
                  {busy === "anchor" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Stamp className="size-3.5" />}
                  {t.personnel_anchor_now}
                </Button>
              ) : null
            }
          >
            <p className="px-1 text-xs text-muted-foreground">{t.personnel_anchors_hint}</p>
            <DataTableSurface
              rows={anchors}
              columns={anchorColumns}
              rowId={(anchor) => anchor.id}
              defaultDensity="comfortable"
              dictionary={tr}
              storageKey="personnel-integrity-anchors"
              rowActions={(anchor) =>
                anchor.has_token ? (
                  <RowIconAction
                    icon={Download}
                    label={t.personnel_tsa_token}
                    onClick={() =>
                      void personnelApi
                        .downloadAnchorToken(anchor)
                        .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
                    }
                  />
                ) : null
              }
              rowActionsAlwaysVisible
              mobilePrimaryColumnId="anchor_date"
              mobileDetailColumnIds={["tsa_status", "tsa_time", "counts", "tsa_error"]}
              pagination={{ pageSize: 30 }}
              emptyState={<EmptyCell>{t.personnel_anchors_empty}</EmptyCell>}
            />
          </AdminTableCard>
        </>
      ) : null}
    </div>
  );
}
