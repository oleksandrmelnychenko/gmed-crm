import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Translations } from "@/lib/i18n";
import { recordCompliancePrivacyRequestStep } from "@/pages/admin/data/admin-api";

export type PrivacyRequestStepFacts = {
  identity_verification?: { method?: string; at?: string } | null;
  deadline_extension?: { reason?: string; at?: string; days?: number } | null;
  subject_notification?: { channel?: string; at?: string } | null;
  recipients_notification?: { channel?: string; at?: string; note?: string } | null;
};

type Props = {
  requestId: string;
  status: string;
  facts: PrivacyRequestStepFacts;
  t: Translations;
  onRecorded: () => void | Promise<void>;
};

const IDENTITY_METHODS = ["id_document", "callback", "signed_letter", "in_person", "portal_login"] as const;
const NOTIFY_CHANNELS = ["email", "portal", "postal_mail", "phone", "in_person"] as const;
const MIN_EXTENSION_REASON = 10;

function day(value?: string) {
  return value ? (value.split("T")[0] ?? value) : "";
}

/**
 * Art. 12 DSGVO bookkeeping around a request: identity check, the single
 * two-month extension, and telling the data subject the outcome.
 */
export function PrivacyRequestSteps({ requestId, status, facts, t, onRecorded }: Props) {
  const [local, setLocal] = useState<PrivacyRequestStepFacts>({});
  const [identityMethod, setIdentityMethod] = useState<string>(IDENTITY_METHODS[0]);
  const [notifyChannel, setNotifyChannel] = useState<string>(NOTIFY_CHANNELS[0]);
  const [extensionReason, setExtensionReason] = useState("");
  const [recipientsNote, setRecipientsNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const merged = { ...facts, ...local };
  const isOpen = status !== "completed" && status !== "rejected";

  const record = async (
    step: "verify_identity" | "extend_deadline" | "notify_subject" | "notify_recipients",
    method?: string,
    note?: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await recordCompliancePrivacyRequestStep(requestId, { step, method, note });
      setLocal((current) => ({ ...current, [result.step]: result.details }));
      if (step === "extend_deadline") setExtensionReason("");
      await onRecorded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectClassName = "h-9 rounded-lg border border-border bg-background px-2 text-xs";

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3" data-testid="privacy-request-steps">
      <p className="text-xs font-medium text-foreground">{t.compliance_steps_title}</p>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t.compliance_steps_identity}:{" "}
          {merged.identity_verification
            ? `${t.compliance_steps_done} · ${merged.identity_verification.method ?? ""} · ${day(merged.identity_verification.at)}`
            : t.compliance_steps_open}
        </p>
        {!merged.identity_verification ? (
          <div className="flex flex-wrap gap-2">
            <select
              aria-label={t.compliance_steps_identity}
              className={selectClassName}
              value={identityMethod}
              onChange={(event) => setIdentityMethod(event.target.value)}
            >
              {IDENTITY_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t[`compliance_steps_method_${method}`]}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              disabled={busy}
              onClick={() => void record("verify_identity", identityMethod)}
            >
              {t.compliance_steps_identity_confirm}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t.compliance_steps_extension}:{" "}
          {merged.deadline_extension
            ? `${t.compliance_steps_done} · +${merged.deadline_extension.days ?? 60} · ${merged.deadline_extension.reason ?? ""}`
            : t.compliance_steps_extension_hint}
        </p>
        {!merged.deadline_extension && isOpen ? (
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={t.compliance_steps_extension_reason}
              placeholder={t.compliance_steps_extension_reason}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs"
              maxLength={2000}
              value={extensionReason}
              onChange={(event) => setExtensionReason(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              disabled={busy || extensionReason.trim().length < MIN_EXTENSION_REASON}
              onClick={() => void record("extend_deadline", undefined, extensionReason.trim())}
            >
              {t.compliance_steps_extension_confirm}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t.compliance_steps_notified}:{" "}
          {merged.subject_notification
            ? `${t.compliance_steps_done} · ${merged.subject_notification.channel ?? ""} · ${day(merged.subject_notification.at)}`
            : t.compliance_steps_open}
        </p>
        {!merged.subject_notification ? (
          <div className="flex flex-wrap gap-2">
            <select
              aria-label={t.compliance_steps_notified}
              className={selectClassName}
              value={notifyChannel}
              onChange={(event) => setNotifyChannel(event.target.value)}
            >
              {NOTIFY_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t[`compliance_steps_channel_${channel}`]}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              disabled={busy}
              onClick={() => void record("notify_subject", notifyChannel)}
            >
              {t.compliance_steps_notified_confirm}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {t.compliance_steps_recipients}:{" "}
          {merged.recipients_notification
            ? `${t.compliance_steps_done} · ${merged.recipients_notification.channel ?? ""} · ${day(merged.recipients_notification.at)}`
            : t.compliance_steps_recipients_hint}
        </p>
        {!merged.recipients_notification ? (
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={t.compliance_steps_recipients_note}
              placeholder={t.compliance_steps_recipients_note}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs"
              maxLength={2000}
              value={recipientsNote}
              onChange={(event) => setRecipientsNote(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              disabled={busy}
              onClick={() => void record("notify_recipients", notifyChannel, recipientsNote.trim())}
            >
              {t.compliance_steps_recipients_confirm}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
