import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner, Section } from "@/components/ui-shell";
import { formatAppDate } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { fetchPatientRecipients, type PatientRecipient } from "@/pages/admin/data/admin-api";
import { signatureStatusText } from "@/pages/documents/ui/signature-status";

function day(value: string | null) {
  return value ? formatAppDate(value) || value : "";
}

/**
 * Art. 19 DSGVO: who received the patient's data. The officer uses this list
 * to pass on a rectification, erasure or restriction and records that step on
 * the request.
 */
export function PatientRecipientsSection({ patientId }: { patientId: string }) {
  const { t, lang } = useLang();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  // `detail` is a share channel, a staff role or a signature status key.
  const detailLabel = useCallback(
    (recipient: PatientRecipient) => {
      const detail = recipient.detail ?? "";
      if (!detail) return "";
      if (recipient.kind === "signature_provider") return signatureStatusText(detail, lang);
      if (recipient.kind === "staff") {
        const role = (t as unknown as Record<string, unknown>)[`role_${detail}`];
        return typeof role === "string" ? role : detail;
      }
      return t.uiText[`documents_share_channel_${detail}`] ?? detail;
    },
    [lang, t],
  );
  const [recipients, setRecipients] = useState<PatientRecipient[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!patientId) return;
    try {
      setRecipients(await fetchPatientRecipients(patientId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!patientId) return null;

  return (
    <Section title={l("recipients_title")}>
      <p className="text-xs text-muted-foreground">{l("recipients_intro")}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="space-y-2" data-testid="patient-recipients">
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">{l("recipients_empty")}</p>
        ) : null}
        {recipients.map((recipient, index) => (
          <div
            key={`${recipient.kind}-${recipient.recipient}-${recipient.since ?? index}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm"
          >
            <Badge className="bg-slate-500/15 text-slate-700">{l(`recipients_kind_${recipient.kind}`)}</Badge>
            <span className="font-medium">{recipient.recipient}</span>
            {recipient.detail ? <span className="text-xs text-muted-foreground">{detailLabel(recipient)}</span> : null}
            {recipient.subject ? <span className="text-xs text-muted-foreground">· {recipient.subject}</span> : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {day(recipient.since)}
              {recipient.until ? ` → ${day(recipient.until)}` : ""}
              {recipient.contact ? ` · ${recipient.contact}` : ""}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
