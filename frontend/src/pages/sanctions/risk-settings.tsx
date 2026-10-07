/**
 * /sanctions?tab=risk (CEO): the configuration of the lead risk assessment
 * (country lists, points per trigger, thresholds, level bounds, automatic
 * level-2 blocks, reviewers) and the review queue. Trigger flow 2026-10-07.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StaffLink } from "@/components/staff-link";
import { Banner, StatusBadge, SuccessBanner, TabLoader, checkboxClass, inputClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { Input } from "@/components/ui/input";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  RISK_KNOCKOUT_TRIGGERS,
  riskDecisionLabel,
  riskLevelLabel,
  riskLevelTone,
  riskStatusLabel,
  riskTriggerLabel,
  type RiskDecisionKind,
} from "@/pages/leads/model/lead-risk-assessment";

import {
  RISK_PAIR_TRIGGERS,
  RISK_POINT_TRIGGERS,
  RISK_POINTS_MAX,
  eligibleReviewerCandidates,
  riskConfigApi,
  riskConfigErrors,
  withListMove,
  type RiskConfig,
  type RiskConfigError,
  type RiskReviewRow,
  type RiskReviewerCandidate,
} from "./risk-config";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function configErrorText(error: RiskConfigError, t: Translations): string {
  switch (error) {
    case "codes":
      return t.risk_config_error_codes;
    case "lists":
      return t.risk_config_error_lists;
    case "points":
      return t.risk_config_error_points;
    case "thresholds":
      return t.risk_config_error_thresholds;
    case "levels":
      return t.risk_config_error_levels;
  }
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  min = 0,
  max,
  step = 1,
  testId,
  hideLabel = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  hideLabel?: boolean;
}) {
  return (
    <label className="min-w-0 space-y-1">
      <span className={cn(tokens.text.label, "block", hideLabel && "sr-only")}>{label}</span>
      <Input
        className={inputClass}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? String(value) : ""}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
      />
    </label>
  );
}

function ReviewQueue({ rows, tx }: { rows: RiskReviewRow[]; tx: (ru: string, de: string) => string }) {
  const { t } = useLang();
  return (
    <section className={cn("space-y-3 rounded-xl p-4", tokens.surface.card)} data-testid="risk-review-queue">
      <div className="space-y-1">
        <AdminSectionTitle>{t.risk_queue_title}</AdminSectionTitle>
        <p className="text-xs text-muted-foreground">{t.risk_queue_hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t.risk_queue_empty}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.lead_id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="risk-review-row">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={riskLevelTone(row.level)}>{riskLevelLabel(row.level, tx)}</StatusBadge>
                  <StaffLink to={`/leads?lead=${row.lead_id}`} className="text-sm font-semibold hover:underline">
                    {row.name}
                  </StaffLink>
                  <span className="text-xs text-muted-foreground">{riskStatusLabel(row.status, tx)}</span>
                  {row.since ? (
                    <span className="text-xs text-muted-foreground">
                      {formatUiText(t.risk_queue_since, { date: formatAppDate(row.since) })}
                    </span>
                  ) : null}
                </div>
                {row.pending_proposal ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {formatUiText(t.risk_queue_proposal, {
                      decision: ["release", "request_more", "reject"].includes(row.pending_proposal.decision)
                        ? riskDecisionLabel(row.pending_proposal.decision as RiskDecisionKind, tx)
                        : row.pending_proposal.decision,
                      name: row.pending_proposal.decided_by_name ?? "—",
                      date: formatAppDateTime(row.pending_proposal.decided_at),
                    })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RiskSettingsTab() {
  const { t, lang } = useLang();
  const tx = useCallback((ru: string, de: string) => (lang === "de" ? de : ru), [lang]);
  const [saved, setSaved] = useState<RiskConfig | null>(null);
  const [config, setConfig] = useState<RiskConfig | null>(null);
  const [candidates, setCandidates] = useState<RiskReviewerCandidate[]>([]);
  const [queue, setQueue] = useState<RiskReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [response, reviews] = await Promise.all([
        riskConfigApi.get(),
        riskConfigApi.reviews().catch(() => [] as RiskReviewRow[]),
      ]);
      setSaved(response.config);
      setConfig(response.config);
      setQueue(reviews);
      if (response.candidates) {
        setCandidates(response.candidates);
      } else {
        const users = await riskConfigApi.users().catch(() => []);
        setCandidates(eligibleReviewerCandidates(Array.isArray(users) ? users : []));
      }
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  const errors = useMemo(() => (config ? riskConfigErrors(config) : []), [config]);
  const changed = Boolean(config && saved && JSON.stringify(config) !== JSON.stringify(saved));

  if (!config && !error) return <TabLoader />;

  const patch = (next: Partial<RiskConfig>) => {
    setFlash("");
    setConfig((current) => (current ? { ...current, ...next } : current));
  };
  const setPoints = (key: string, index: 0 | 1 | null, value: number) => {
    if (!config) return;
    const current = config.points[key];
    const next = index === null
      ? value
      : ([index === 0 ? value : Array.isArray(current) ? current[0] : 0, index === 1 ? value : Array.isArray(current) ? current[1] : 0] as [number, number]);
    patch({ points: { ...config.points, [key]: next } });
  };

  const save = async () => {
    if (!config || errors.length > 0) return;
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await riskConfigApi.save(config);
      setFlash(t.risk_config_saved);
      await load();
    } catch (saveError) {
      setError(errorText(saveError, t.common_error));
    } finally {
      setBusy(false);
    }
  };

  // Reviewers stored but no longer eligible stay visible, so they can be removed.
  const reviewerOptions: RiskReviewerCandidate[] = config
    ? [
        ...candidates,
        ...config.reviewers
          .filter((id) => !candidates.some((candidate) => candidate.id === id))
          .map((id) => ({ id, name: id, role: "" })),
      ]
    : candidates;

  return (
    <div className="space-y-4" data-testid="risk-settings">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {flash ? <SuccessBanner>{flash}</SuccessBanner> : null}
      {config ? (
        <section className={cn("space-y-4 rounded-xl p-4", tokens.surface.card)} data-testid="risk-config">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <AdminSectionTitle>{t.risk_config_title}</AdminSectionTitle>
              <p className="text-xs leading-5 text-muted-foreground">{t.risk_config_hint}</p>
            </div>
            <span className="text-xs text-muted-foreground" data-testid="risk-config-version">
              {formatUiText(t.risk_config_version, { version: config.version })}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0 space-y-1" data-testid="risk-list-1">
              <span className={cn(tokens.text.label, "block")}>{t.risk_list_1}</span>
              <CitizenshipMultiSelect
                value={config.list_1}
                onChange={(next) => setConfig((current) => (current ? withListMove(current, "list_1", next) : current))}
                placeholder={t.sanctions_blocked_countries_placeholder}
                disabled={busy}
              />
            </div>
            <div className="min-w-0 space-y-1" data-testid="risk-list-2">
              <span className={cn(tokens.text.label, "block")}>{t.risk_list_2}</span>
              <CitizenshipMultiSelect
                value={config.list_2}
                onChange={(next) => setConfig((current) => (current ? withListMove(current, "list_2", next) : current))}
                placeholder={t.sanctions_blocked_countries_placeholder}
                disabled={busy}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t.risk_lists_hint}</p>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <AdminSectionTitle>{t.risk_points}</AdminSectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-sm" data-testid="risk-points">
                <tbody>
                  {RISK_POINT_TRIGGERS.map((key) => {
                    const value = config.points[key];
                    return (
                      <tr key={key} className="border-b border-border/50 last:border-b-0">
                        <td className="py-1.5 pr-3 align-middle">
                          <span className="font-mono text-xs text-muted-foreground">{key}</span>{" "}
                          {riskTriggerLabel(key, tx)}
                        </td>
                        <td className="w-48 py-1.5 align-middle">
                          {RISK_PAIR_TRIGGERS.includes(key) && Array.isArray(value) ? (
                            <div className="grid grid-cols-2 gap-2">
                              <NumberField
                                label={t.risk_points_list_1}
                                value={value[0]}
                                max={RISK_POINTS_MAX}
                                disabled={busy}
                                testId={`risk-points-${key}-1`}
                                onChange={(next) => setPoints(key, 0, next)}
                              />
                              <NumberField
                                label={t.risk_points_list_2}
                                value={value[1]}
                                max={RISK_POINTS_MAX}
                                disabled={busy}
                                testId={`risk-points-${key}-2`}
                                onChange={(next) => setPoints(key, 1, next)}
                              />
                            </div>
                          ) : (
                            <NumberField
                              label={`${key} ${riskTriggerLabel(key, tx)}`}
                              hideLabel
                              value={typeof value === "number" ? value : 0}
                              max={RISK_POINTS_MAX}
                              disabled={busy}
                              testId={`risk-points-${key}`}
                              onChange={(next) => setPoints(key, null, next)}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {RISK_KNOCKOUT_TRIGGERS.map((key) => (
                    <tr key={key} className="border-b border-border/50 last:border-b-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-mono text-xs text-muted-foreground">{key}</span> {riskTriggerLabel(key, tx)}
                      </td>
                      <td className="py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300">{t.risk_knockout}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField label={t.risk_threshold_1} value={config.threshold_1_eur} step={100} disabled={busy} testId="risk-threshold-1" onChange={(value) => patch({ threshold_1_eur: value })} />
            <NumberField label={t.risk_threshold_2} value={config.threshold_2_eur} step={100} disabled={busy} testId="risk-threshold-2" onChange={(value) => patch({ threshold_2_eur: value })} />
            <NumberField label={t.risk_level_2_from} value={config.level_2_from} min={1} disabled={busy} testId="risk-level-2-from" onChange={(value) => patch({ level_2_from: value })} />
            <NumberField label={t.risk_level_3_from} value={config.level_3_from} min={2} disabled={busy} testId="risk-level-3-from" onChange={(value) => patch({ level_3_from: value })} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={checkboxClass}
              checked={config.level_2_blocks_automatic}
              disabled={busy}
              onChange={(event) => patch({ level_2_blocks_automatic: event.target.checked })}
            />
            {t.risk_level_2_blocks_automatic}
          </label>

          <div className="space-y-2 border-t border-border/60 pt-3" data-testid="risk-reviewers">
            <AdminSectionTitle>{t.risk_reviewers}</AdminSectionTitle>
            <p className="text-xs leading-5 text-muted-foreground">{t.risk_reviewers_hint}</p>
            {reviewerOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t.risk_reviewers_none}</p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {reviewerOptions.map((candidate) => (
                  <label key={candidate.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={config.reviewers.includes(candidate.id)}
                      disabled={busy}
                      onChange={(event) =>
                        patch({
                          reviewers: event.target.checked
                            ? [...config.reviewers, candidate.id]
                            : config.reviewers.filter((id) => id !== candidate.id),
                        })
                      }
                    />
                    <span>{candidate.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {errors.length > 0 ? (
            <ul className="space-y-0.5 text-xs font-medium text-destructive" role="alert" data-testid="risk-config-errors">
              {errors.map((item) => (
                <li key={item}>{configErrorText(item, t)}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy || !changed} onClick={() => setConfig(saved)}>
              {t.common_cancel}
            </Button>
            <Button type="button" size="sm" disabled={busy || !changed || errors.length > 0} onClick={() => void save()} data-testid="risk-config-save">
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t.common_save}
            </Button>
          </div>
        </section>
      ) : null}
      <ReviewQueue rows={queue} tx={tx} />
    </div>
  );
}
