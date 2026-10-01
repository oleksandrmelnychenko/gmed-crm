import { useCallback, useEffect, useState } from "react";
import { Download, LoaderCircle, ShieldCheck, Stamp } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, StatusBadge, TabLoader, type StatusTone } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { StaffLink } from "@/components/staff-link";

import { personnelApi, type PersonnelIntegrity } from "./api";
import { errorMessage } from "./personnel-ui";

const RUN_TONE: Record<string, StatusTone> = {
  running: "info",
  passed: "success",
  failed: "error",
  error: "warning",
};

const TSA_TONE: Record<string, StatusTone> = {
  pending: "warning",
  stamped: "success",
  failed: "error",
  disabled: "neutral",
};

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

  return (
    <div className="space-y-5">
      <p className="max-w-4xl text-sm text-muted-foreground">{t.personnel_integrity_intro}</p>
      {data && !data.tsa_configured ? (
        <Banner tone="warning" withIcon>
          {t.personnel_tsa_not_configured}
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && !data ? <TabLoader /> : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminSectionTitle>{t.personnel_integrity_runs}</AdminSectionTitle>
          {canManage ? (
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => void act("run")}>
              {busy === "run" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              {t.personnel_integrity_run_now}
            </Button>
          ) : null}
        </div>
        {data && data.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.personnel_integrity_no_runs}</p>
        ) : null}
        {data && data.runs.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {data.runs.map((run) => (
              <li key={run.id} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={RUN_TONE[run.status] ?? "neutral"}>
                    {tr[`personnel_run_${run.status}`] ?? run.status}
                  </StatusBadge>
                  <span>{formatAppDateTime(run.started_at)}</span>
                  <span className="text-xs text-muted-foreground">
                    {tr[`personnel_trigger_${run.trigger}`] ?? run.trigger}
                    {run.started_by_name ? ` · ${run.started_by_name}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {run.employees_checked} {t.personnel_integrity_employees} · {run.documents_checked}{" "}
                    {t.personnel_integrity_documents}
                  </span>
                </div>
                {run.failures.length > 0 ? (
                  <ul className="space-y-0.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
                    {run.failures.map((failure, index) => (
                      <li key={`${failure.document_id ?? failure.employee_id ?? "chain"}-${index}`}>
                        {failure.employee_id ? (
                          <StaffLink to={`/personnel/${failure.employee_id}`} className="underline">
                            {t.personnel_open_file}
                          </StaffLink>
                        ) : null}{" "}
                        {failure.problem}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminSectionTitle>{t.personnel_anchors}</AdminSectionTitle>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("anchor")}>
              {busy === "anchor" ? <LoaderCircle className="animate-spin" /> : <Stamp />}
              {t.personnel_anchor_now}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t.personnel_anchors_hint}</p>
        {data && data.anchors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.personnel_anchors_empty}</p>
        ) : null}
        {data && data.anchors.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t.personnel_anchor_date}</th>
                  <th className="px-3 py-2 font-medium">{t.personnel_anchor_hash}</th>
                  <th className="px-3 py-2 font-medium">{t.personnel_integrity_documents}</th>
                  <th className="px-3 py-2 font-medium">{t.personnel_tsa_status}</th>
                  <th className="px-3 py-2 font-medium">{t.personnel_tsa_time}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.anchors.map((anchor) => (
                  <tr key={anchor.id}>
                    <td className="px-3 py-2">{formatAppDate(anchor.anchor_date)}</td>
                    <td className="max-w-56 truncate px-3 py-2 font-mono" title={anchor.anchor_hash}>
                      {anchor.anchor_hash}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {anchor.document_count} / {anchor.employee_count}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={TSA_TONE[anchor.tsa_status] ?? "neutral"}>
                        {tr[`personnel_tsa_${anchor.tsa_status}`] ?? anchor.tsa_status}
                      </StatusBadge>
                      {anchor.tsa_last_error && anchor.tsa_status !== "stamped" ? (
                        <p className="mt-0.5 text-[11px] text-rose-700" title={anchor.tsa_last_error}>
                          {anchor.tsa_attempts}× · {anchor.tsa_last_error}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {anchor.tsa_gen_time ? formatAppDateTime(anchor.tsa_gen_time) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {anchor.has_token ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void personnelApi
                              .downloadAnchorToken(anchor)
                              .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
                          }
                        >
                          <Download />
                          {t.personnel_tsa_token}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
