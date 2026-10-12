import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkboxClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import {
  CONSENT_FORM_CHANNELS,
  CONSENT_FORM_OPTIONS,
  NO_CONSENT_FORM_CHOICES,
  saveLeadConsentFormChoices,
  type ConsentFormChoices,
  type LeadRequest,
} from "./lead-request-api";
import { consentFormText } from "./lead-request-consent-form-text";
import { CabinetSection as Section, errorMessage, type RequestQueue } from "./lead-request-parts";

/** Whether the draft differs from what is saved (nothing saved counts as "all unticked"). */
export function consentFormChanged(
  draft: ConsentFormChoices,
  saved: ConsentFormChoices | null | undefined,
): boolean {
  const base = saved ?? NO_CONSENT_FORM_CHOICES;
  return (Object.keys(NO_CONSENT_FORM_CHOICES) as (keyof ConsentFormChoices)[]).some(
    (key) => draft[key] !== base[key],
  );
}

/**
 * The person's own choice of the options of the consent form «Einverständniserklärung zur
 * Datenübermittlung» (Anlage 1), 2026-10-12. Nothing is ticked in advance; the choice counts only
 * once the person saves it (an active choice), and every save is kept. The generated form ticks
 * only what was chosen here; without a saved choice GMED sends the form for a paper signature.
 */
export function ConsentFormChoicesSection({
  request,
  lang,
  enqueue,
  onChange,
}: {
  request: LeadRequest;
  lang: string;
  enqueue: RequestQueue;
  onChange: (request: LeadRequest) => void;
}) {
  const form = request.consent_form;
  const text = consentFormText(lang);
  const [draft, setDraft] = useState<ConsentFormChoices>(form?.choices ?? NO_CONSENT_FORM_CHOICES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!form) return null;
  const changed = consentFormChanged(draft, form.choices);

  async function save() {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const saved = await enqueue(() =>
        saveLeadConsentFormChoices(request.lead_id, draft, form.version, lang),
      );
      onChange({ ...request, consent_form: saved });
      setDraft(saved.choices ?? draft);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const option = (key: keyof ConsentFormChoices) => (
    <label key={key} className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className={cn(checkboxClass, "mt-0.5")}
        checked={draft[key]}
        disabled={busy}
        data-consent-option={key}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setDraft((current) => ({ ...current, [key]: checked }));
        }}
      />
      <span className="leading-relaxed">{text.options[key]}</span>
    </label>
  );

  return (
    <div data-testid="lead-request-consent-form">
      <Section title={text.title}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{text.intro}</p>
          <div className="space-y-2">{CONSENT_FORM_OPTIONS.map(option)}</div>
          <fieldset className="space-y-2">
            <legend className="text-sm">{text.channelsTitle}</legend>
            <div className="grid gap-2 pl-7 sm:grid-cols-2">{CONSENT_FORM_CHANNELS.map(option)}</div>
            <p className="pl-7 text-xs text-muted-foreground">{text.channelsRisk}</p>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy || (!changed && Boolean(form.choices))}
              onClick={() => void save()}
              data-testid="lead-request-consent-form-save"
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
              {busy ? text.saving : text.save}
            </Button>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {changed && form.choices
                ? text.unsaved
                : form.chosen_at
                  ? text.savedAt(formatAppDateTime(form.chosen_at))
                  : text.notSaved}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
