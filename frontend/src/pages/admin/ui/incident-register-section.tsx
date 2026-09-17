import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner, Field, Section, selectClass, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import {
  fetchSecurityIncidents,
  reportSecurityIncident,
  updateSecurityIncident,
  type SecurityIncident,
} from "@/pages/admin/data/admin-api";

const CATEGORIES = ["confidentiality", "integrity", "availability"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "contained", "resolved", "closed"] as const;
const RISKS = ["pending", "no_risk", "risk", "high_risk"] as const;

function dateTime(value: string | null) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

function hoursLeft(deadline: string) {
  return Math.round((new Date(deadline).getTime() - Date.now()) / 3_600_000);
}

/**
 * Art. 33 DSGVO register. Staff report here; CEO and IT admin assess the risk
 * and record either the report to the authority or why none was needed.
 */
export function IncidentRegisterSection({ canManage }: { canManage: boolean }) {
  const { t } = useLang();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);

  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "confidentiality",
    severity: "medium",
    affected: "",
  });
  const [decision, setDecision] = useState({
    status: "",
    risk: "",
    authorityReference: "",
    noNotificationReason: "",
    measures: "",
  });

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      setIncidents(await fetchSecurityIncidents());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitReport = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await reportSecurityIncident({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        severity: form.severity,
        affected_subjects_count: form.affected === "" ? undefined : Number(form.affected),
      });
      setNotice(`${l("incidents_reported")}: ${created.reference}`);
      setForm({ title: "", description: "", category: "confidentiality", severity: "medium", affected: "" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const openIncident = (incident: SecurityIncident) => {
    setOpenId(openId === incident.id ? null : incident.id);
    setDecision({
      status: incident.status,
      risk: incident.risk_assessment,
      authorityReference: incident.authority_reference ?? "",
      noNotificationReason: incident.no_notification_reason ?? "",
      measures: incident.measures_taken ?? "",
    });
  };

  const saveDecision = async (incident: SecurityIncident, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      await updateSecurityIncident(incident.id, {
        status: decision.status,
        risk_assessment: decision.risk,
        authority_reference: decision.authorityReference,
        no_notification_reason: decision.noNotificationReason,
        measures_taken: decision.measures,
        ...extra,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={l("incidents_title")}>
      <p className="text-xs text-muted-foreground">{l("incidents_intro")}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      <form className="grid gap-3 md:grid-cols-2" onSubmit={submitReport} data-testid="incident-report-form">
        <Field label={l("incidents_field_title")} htmlFor="incident-title" required>
          <Input
            id="incident-title"
            className="h-9 rounded-lg bg-field"
            maxLength={200}
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label={l("incidents_field_affected")} htmlFor="incident-affected">
          <Input
            id="incident-affected"
            type="number"
            min={0}
            className="h-9 rounded-lg bg-field"
            value={form.affected}
            onChange={(event) => setForm({ ...form, affected: event.target.value })}
          />
        </Field>
        <Field label={l("incidents_field_category")} htmlFor="incident-category">
          <select
            id="incident-category"
            className={selectClass}
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {l(`incidents_category_${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={l("incidents_field_severity")} htmlFor="incident-severity">
          <select
            id="incident-severity"
            className={selectClass}
            value={form.severity}
            onChange={(event) => setForm({ ...form, severity: event.target.value })}
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {l(`incidents_severity_${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={l("incidents_field_description")} htmlFor="incident-description" className="md:col-span-2" required>
          <textarea
            id="incident-description"
            className={textareaClass}
            maxLength={8000}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <div className="md:col-span-2">
          <Button
            type="submit"
            className="h-9 rounded-lg px-3.5"
            disabled={busy || form.title.trim() === "" || form.description.trim().length < 10}
          >
            {l("incidents_report")}
          </Button>
        </div>
      </form>

      {canManage ? (
        <div className="space-y-2" data-testid="incident-register">
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{l("incidents_empty")}</p>
          ) : null}
          {incidents.map((incident) => {
            const left = hoursLeft(incident.authority_deadline);
            return (
              <div key={incident.id} className="rounded-lg border border-border/60 bg-card p-3">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 text-left"
                  onClick={() => openIncident(incident)}
                >
                  <span className="font-mono text-xs text-muted-foreground">{incident.reference}</span>
                  <span className="text-sm font-medium">{incident.title}</span>
                  <Badge className="bg-slate-500/15 text-slate-700">{l(`incidents_status_${incident.status}`)}</Badge>
                  <Badge className="bg-slate-500/15 text-slate-700">{l(`incidents_severity_${incident.severity}`)}</Badge>
                  {incident.notification_decision_documented ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700">{l("incidents_decision_documented")}</Badge>
                  ) : incident.authority_deadline_missed ? (
                    <Badge className="bg-red-500/15 text-red-700">{l("incidents_deadline_missed")}</Badge>
                  ) : (
                    <Badge className="bg-amber-500/15 text-amber-800">
                      {l("incidents_deadline_left")}: {left} h
                    </Badge>
                  )}
                </button>

                {openId === incident.id ? (
                  <div className="mt-3 space-y-3">
                    <p className="whitespace-pre-line text-sm">{incident.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {l("incidents_aware_at")}: {dateTime(incident.became_aware_at)} · {l("incidents_deadline")}:{" "}
                      {dateTime(incident.authority_deadline)} · {l("incidents_reported_by")}: {incident.reported_by_name}
                      {incident.authority_notified_at
                        ? ` · ${l("incidents_authority_notified")}: ${dateTime(incident.authority_notified_at)}`
                        : ""}
                      {incident.subjects_notified_at
                        ? ` · ${l("incidents_subjects_notified")}: ${dateTime(incident.subjects_notified_at)}`
                        : ""}
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label={l("incidents_field_status")} htmlFor={`incident-status-${incident.id}`}>
                        <select
                          id={`incident-status-${incident.id}`}
                          className={selectClass}
                          value={decision.status}
                          onChange={(event) => setDecision({ ...decision, status: event.target.value })}
                        >
                          {STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {l(`incidents_status_${value}`)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={l("incidents_field_risk")} htmlFor={`incident-risk-${incident.id}`}>
                        <select
                          id={`incident-risk-${incident.id}`}
                          className={selectClass}
                          value={decision.risk}
                          onChange={(event) => setDecision({ ...decision, risk: event.target.value })}
                        >
                          {RISKS.map((value) => (
                            <option key={value} value={value}>
                              {l(`incidents_risk_${value}`)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={l("incidents_field_authority_reference")} htmlFor={`incident-ref-${incident.id}`}>
                        <Input
                          id={`incident-ref-${incident.id}`}
                          className="h-9 rounded-lg bg-field"
                          value={decision.authorityReference}
                          onChange={(event) => setDecision({ ...decision, authorityReference: event.target.value })}
                        />
                      </Field>
                      <Field label={l("incidents_field_no_notification_reason")} htmlFor={`incident-reason-${incident.id}`}>
                        <Input
                          id={`incident-reason-${incident.id}`}
                          className="h-9 rounded-lg bg-field"
                          value={decision.noNotificationReason}
                          onChange={(event) => setDecision({ ...decision, noNotificationReason: event.target.value })}
                        />
                      </Field>
                      <Field label={l("incidents_field_measures")} htmlFor={`incident-measures-${incident.id}`} className="md:col-span-2">
                        <textarea
                          id={`incident-measures-${incident.id}`}
                          className={textareaClass}
                          value={decision.measures}
                          onChange={(event) => setDecision({ ...decision, measures: event.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" className="h-9 rounded-lg" disabled={busy} onClick={() => void saveDecision(incident)}>
                        {l("incidents_save")}
                      </Button>
                      {!incident.authority_notified_at ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => void saveDecision(incident, { authority_notified_at: new Date().toISOString() })}
                        >
                          {l("incidents_mark_authority_notified")}
                        </Button>
                      ) : null}
                      {!incident.subjects_notified_at ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={busy}
                          onClick={() => void saveDecision(incident, { subjects_notified_at: new Date().toISOString() })}
                        >
                          {l("incidents_mark_subjects_notified")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </Section>
  );
}
