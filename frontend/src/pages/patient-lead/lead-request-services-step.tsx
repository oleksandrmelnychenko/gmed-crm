import { useCallback, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { cn } from "@/lib/utils";
import { appDateKey } from "@/lib/app-time-zone";
import { LEAD_WIZARD_SERVICE_OPTIONS, updateLeadServiceSelection } from "@/pages/leads/model/leads-model";
import { saveLeadServices, type LeadServicePreferences } from "./lead-request-api";
import { mergeSavedDraft, queuedDraftFields, scopedDraftPatch } from "./lead-request-autosave";
import type { SaveState } from "./lead-request-model";
import { CabinetHint, CabinetSection, LabeledField, errorMessage, runDraftSave, useAutosave } from "./lead-request-parts";
import { useServerDraftSync } from "./lead-request-server-sync";
import { StepFrame, type StepProps } from "./lead-request-step-forms";
import { servicesText } from "./lead-request-services-text";

function draftOf(value?: LeadServicePreferences): LeadServicePreferences {
  return {
    services: value?.services ?? [], service_comments: value?.service_comments ?? {},
    program_date_from: value?.program_date_from ?? "",
    notes: value?.notes ?? "",
  };
}

function difference(before: LeadServicePreferences, after: LeadServicePreferences): Partial<LeadServicePreferences> {
  const patch: Partial<LeadServicePreferences> = {};
  if (JSON.stringify(before.services) !== JSON.stringify(after.services)) patch.services = after.services;
  for (const key of ["program_date_from", "notes"] as const) {
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

/** The (i) next to a service: the website's «Подробнее» text in a popover (owner 2026-10-29). */
function ServiceInfo({ title, text, more, close }: { title: string; text: string; more: string; close: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`${more}: ${title}`}
        title={more}
        className="mt-2 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
            <div className="flex items-start justify-between gap-3">
              <Popover.Title className="text-sm font-semibold leading-5">{title}</Popover.Title>
              <Popover.Close aria-label={close} className="-m-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-3.5" />
              </Popover.Close>
            </div>
            <Popover.Description className="mt-2 text-sm leading-5 text-muted-foreground">{text}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ServicesStep({ request, text, lang, enqueue, onChange, missing, nav }: StepProps) {
  const wording = servicesText(lang);
  const [draft, setDraft] = useState(() => draftOf(request.service_preferences));
  const savedRef = useRef(draft);
  const queuedDraftRef = useRef(draft);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const locked = Boolean(request.submitted_at);

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
  }, [enqueue, locked, onChange, request.lead_id, text]);

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
        <Button type="button" size="sm" onClick={() => void save(draft)}>{text.retry}</Button>
      </div> : null}
      <CabinetSection title={wording.period} accessory={<CabinetHint className="py-1">{wording.optional}</CabinetHint>}>
        <LabeledField id="lead-request-service-program_date_from" label={wording.from} className={cn(fieldStyle, "max-w-sm")}>
          {/* A wished start lies ahead: no date in the past (owner 2026-10-29). */}
          <Input id="lead-request-service-program_date_from" type="date" className="h-10 bg-background"
            min={appDateKey()} value={draft.program_date_from} onChange={(event) => setDraft((current) => ({ ...current, program_date_from: event.target.value }))} />
        </LabeledField>
      </CabinetSection>
      <CabinetSection title={wording.services} accessory={<StatusChip tone={draft.services.length ? "info" : "neutral"}>{draft.services.length}</StatusChip>}>
        <div id="lead-request-service-services" className="grid items-start gap-2 sm:grid-cols-2">
          {LEAD_WIZARD_SERVICE_OPTIONS.map((value) => {
            const checked = draft.services.includes(value);
            return <div key={value} className={cn("min-w-0 rounded-xl border bg-background transition-colors", checked ? "border-[var(--brand)]" : "border-border")}>
              <div className="flex items-start gap-1 pr-1.5">
                <label className={cn("flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-sm leading-5", locked ? "cursor-default" : "cursor-pointer hover:bg-muted/40", checked && "font-medium")}>
                  <input type="checkbox" checked={checked} onChange={(event) => toggle(value, event.target.checked)}
                    className={cn(checkboxClass, "shrink-0")} />
                  <span className="min-w-0">{wording.options[value]}</span>
                </label>
                {wording.descriptions[value] ? <ServiceInfo title={wording.options[value]} text={wording.descriptions[value]}
                  more={wording.more} close={wording.close} /> : null}
              </div>
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
