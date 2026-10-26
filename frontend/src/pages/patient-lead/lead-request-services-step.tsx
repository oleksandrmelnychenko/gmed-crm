import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { LEAD_WIZARD_SERVICE_OPTIONS, updateLeadServiceSelection } from "@/pages/leads/model/leads-model";
import { saveLeadServices, type LeadServicePreferences } from "./lead-request-api";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import type { SaveState } from "./lead-request-model";
import { CabinetSection, LabeledField, errorMessage, runDraftSave, useAutosave } from "./lead-request-parts";
import { useServerDraftSync } from "./lead-request-server-sync";
import { StepFrame, type StepProps } from "./lead-request-step-forms";
import { servicesText } from "./lead-request-services-text";

function draftOf(value?: LeadServicePreferences): LeadServicePreferences {
  return {
    services: value?.services ?? [], service_comments: value?.service_comments ?? {},
    program_date_from: value?.program_date_from ?? "", program_date_to: value?.program_date_to ?? "",
    notes: value?.notes ?? "",
  };
}

function difference(before: LeadServicePreferences, after: LeadServicePreferences): Partial<LeadServicePreferences> {
  const patch: Partial<LeadServicePreferences> = {};
  if (JSON.stringify(before.services) !== JSON.stringify(after.services)) patch.services = after.services;
  for (const key of ["program_date_from", "program_date_to", "notes"] as const) {
    if (before[key] !== after[key]) patch[key] = after[key];
  }
  const comments = Object.fromEntries(
    [...new Set([...Object.keys(before.service_comments), ...Object.keys(after.service_comments)])]
      .filter((key) => (before.service_comments[key] ?? "") !== (after.service_comments[key] ?? ""))
      .map((key) => [key, after.service_comments[key] ?? ""]),
  );
  if (Object.keys(comments).length) patch.service_comments = comments;
  return patch;
}

export function ServicesStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const wording = servicesText(lang);
  const [draft, setDraft] = useState(() => draftOf(request.service_preferences));
  const savedRef = useRef(draft);
  const queuedDraftRef = useRef(draft);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const locked = Boolean(request.submitted_at);
  const invalidPeriod = Boolean(draft.program_date_from && draft.program_date_to && draft.program_date_to < draft.program_date_from);

  const save = useCallback((snapshot: LeadServicePreferences) => {
    if (locked) return true;
    const fromSaved = difference(savedRef.current, snapshot);
    const fromQueued = difference(queuedDraftRef.current, snapshot);
    const fields = queuedDraftFields(fromSaved, fromQueued);
    const commentKeys = new Set([
      ...Object.keys(fromSaved.service_comments ?? {}), ...Object.keys(fromQueued.service_comments ?? {}),
    ]);
    queuedDraftRef.current = snapshot;
    return runDraftSave(enqueue, fields, async () => {
      const patch = scopedDraftPatch(difference(savedRef.current, snapshot), fields);
      if (patch.service_comments) {
        patch.service_comments = Object.fromEntries(Object.entries(patch.service_comments).filter(([key]) => commentKeys.has(key)));
        if (Object.keys(patch.service_comments).length === 0) delete patch.service_comments;
      }
      if (Object.keys(patch).length === 0) {
        setError(null);
        setState((current) => current === "error" ? "saved" : current);
        return true;
      }
      if (snapshot.program_date_from && snapshot.program_date_to && snapshot.program_date_to < snapshot.program_date_from) {
        setState("error");
        setError(wording.invalidPeriod);
        return false;
      }
      setState("saving");
      setError(null);
      try {
        const baseline = savedRef.current;
        const next = await saveLeadServices(request.lead_id, patch);
        const fresh = draftOf(next.service_preferences);
        savedRef.current = fresh;
        queuedDraftRef.current = mergeSavedDraft(queuedDraftRef.current, snapshot, fresh, baseline, Object.keys(patch), fields);
        setDraft((current) => mergeSavedDraft(current, snapshot, fresh, baseline, Object.keys(patch), fields));
        onChange(next);
        setState("saved");
        return true;
      } catch (cause) {
        setState("error");
        setError(errorMessage(cause, text));
        return false;
      }
    });
  }, [enqueue, locked, onChange, request.lead_id, text, wording.invalidPeriod]);

  useAutosave(draft, save);
  useServerDraftSync({ incoming: draftOf(request.service_preferences), draft, savedRef, queuedDraftRef, setDraft,
    idOf: (field) => `lead-request-service-${field}` });

  const toggle = (value: string, checked: boolean) => setDraft((current) => {
    const services = updateLeadServiceSelection(current.services, value, checked);
    return { ...current, services, service_comments: Object.fromEntries(
      Object.entries(current.service_comments).filter(([key]) => services.includes(key)),
    ) };
  });
  const fieldStyle = "[&>label]:font-mono [&>label]:text-xs [&>label]:font-medium [&>label]:text-foreground/80";
  const textareaStyle = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";

  return (
    <StepFrame testId="lead-request-services" step="services" request={request} text={text} missing={missing} nav={nav} saveState={state}>
      {error && !locked ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <span>{error}</span>
        {!invalidPeriod ? <Button type="button" size="sm" onClick={() => void save(draft)}>{text.retry}</Button> : null}
      </div> : null}
      <CabinetSection title={wording.period} accessory={<StatusChip>{wording.optional}</StatusChip>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {(["program_date_from", "program_date_to"] as const).map((field) => (
            <LabeledField key={field} id={`lead-request-service-${field}`} label={field === "program_date_from" ? wording.from : wording.to}
              className={fieldStyle} error={field === "program_date_to" && invalidPeriod ? wording.invalidPeriod : undefined}>
              <Input id={`lead-request-service-${field}`} type="date" className="h-10 bg-background"
                min={field === "program_date_to" ? draft.program_date_from || undefined : undefined}
                aria-invalid={field === "program_date_to" && invalidPeriod || undefined}
                aria-describedby={field === "program_date_to" && invalidPeriod ? `lead-request-service-${field}-error` : undefined}
                value={draft[field]} onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))} />
            </LabeledField>
          ))}
        </div>
      </CabinetSection>
      <CabinetSection title={wording.services} accessory={<StatusChip tone={draft.services.length ? "info" : "neutral"}>{draft.services.length}</StatusChip>}>
        <div id="lead-request-service-services" className="grid gap-2.5 sm:grid-cols-2">
          {LEAD_WIZARD_SERVICE_OPTIONS.map((value) => {
            const checked = draft.services.includes(value);
            return <div key={value} className={cn("min-w-0 rounded-xl border bg-background transition-colors", checked ? "border-[var(--brand)]" : "border-border")}>
              <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm leading-5", !locked && "hover:bg-muted/40", checked && "font-medium")}>
                <input type="checkbox" checked={checked} onChange={(event) => toggle(value, event.target.checked)}
                  className="size-4 shrink-0 accent-[var(--brand)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]" />
                <span>{wording.options[value]}</span>
              </label>
              {checked && value !== "none" && value !== "not-sure" ? <div className="px-3 pb-3">
                <LabeledField id={`lead-request-service-comment-${value}`} label={wording.comment} className={fieldStyle}>
                  <textarea id={`lead-request-service-comment-${value}`} rows={2} maxLength={4000} className={textareaStyle}
                    value={draft.service_comments[value] ?? ""} onChange={(event) => setDraft((current) => ({ ...current,
                      service_comments: { ...current.service_comments, [value]: event.target.value },
                    }))} />
                </LabeledField>
              </div> : null}
            </div>;
          })}
        </div>
        <LabeledField id="lead-request-service-notes" label={wording.notes} className={cn(fieldStyle, "pt-2")}>
          <textarea id="lead-request-service-notes" rows={3} maxLength={4000} className={textareaStyle}
            value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
        </LabeledField>
      </CabinetSection>
    </StepFrame>
  );
}
