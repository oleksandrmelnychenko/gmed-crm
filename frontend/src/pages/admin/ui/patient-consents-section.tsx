import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner, Field, Section, selectClass } from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { fetchPatientConsents, savePatientConsent } from "@/pages/admin/data/admin-api";

type ConsentRecord = {
  id: string;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  note?: string | null;
  managed_by_name: string;
  created_at: string;
};

// The consent types the rest of the system reads: document signing writes the
// first three, document sharing checks the channel ones.
const CONSENT_TYPES = [
  "dsgvo_data_transfer",
  "schweigepflicht_release",
  "treatment_contract",
  "third_party_sharing",
  "document_share_email",
  "document_share_whatsapp",
  "document_share_phone",
  "document_share_postal_mail",
] as const;

function day(value: string | null) {
  return value ? (value.split("T")[0] ?? value) : "—";
}

function isActive(consent: ConsentRecord) {
  if (!consent.granted || consent.revoked_at) return false;
  return !consent.expires_at || new Date(consent.expires_at).getTime() > Date.now();
}

/**
 * Consent history of one patient with grant and revoke. A consent must be as
 * easy to withdraw as to give (Art. 7 Abs. 3 DSGVO); until now that was only
 * possible through the API.
 */
export function PatientConsentsSection({ patientId }: { patientId: string }) {
  const { t } = useLang();
  const l = useCallback((key: string) => t.uiText[key] ?? key, [t]);
  const typeLabel = useCallback(
    (value: string) => t.uiText[`consents_type_${value}`] ?? value,
    [t],
  );

  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [consentType, setConsentType] = useState<string>(CONSENT_TYPES[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!patientId) return;
    try {
      setConsents(await fetchPatientConsents<ConsentRecord>(patientId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (type: string, action: "grant" | "revoke", text: string) => {
    setBusy(true);
    setError("");
    try {
      await savePatientConsent(patientId, { consent_type: type, action, note: text || undefined });
      clearApiCache();
      setNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!patientId) return null;

  // Newest record per type decides whether that consent is currently active.
  const latestByType = new Map<string, ConsentRecord>();
  for (const consent of consents) {
    if (!latestByType.has(consent.consent_type)) latestByType.set(consent.consent_type, consent);
  }

  return (
    <Section title={l("consents_title")}>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <Field label={l("consents_field_type")} htmlFor="consent-type">
          <select
            id="consent-type"
            className={selectClass}
            value={consentType}
            onChange={(event) => setConsentType(event.target.value)}
          >
            {CONSENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={l("consents_field_note")} htmlFor="consent-note">
          <Input
            id="consent-note"
            className="h-9 rounded-lg bg-field"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            className="h-9 rounded-lg px-3.5"
            disabled={busy}
            onClick={() => void save(consentType, "grant", note.trim())}
          >
            {l("consents_grant")}
          </Button>
        </div>
      </div>

      <div className="space-y-2" data-testid="patient-consents">
        {consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{l("consents_empty")}</p>
        ) : null}
        {consents.map((consent) => {
          const current = latestByType.get(consent.consent_type)?.id === consent.id;
          const active = current && isActive(consent);
          return (
            <div
              key={consent.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm"
            >
              <span className="font-medium">{typeLabel(consent.consent_type)}</span>
              {active ? (
                <Badge className="bg-emerald-500/15 text-emerald-700">{l("consents_status_active")}</Badge>
              ) : consent.granted && !consent.revoked_at ? (
                <Badge className="bg-slate-500/15 text-slate-700">{l("consents_status_superseded")}</Badge>
              ) : (
                <Badge className="bg-red-500/15 text-red-700">{l("consents_status_revoked")}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {day(consent.granted_at ?? consent.created_at)}
                {consent.expires_at ? ` → ${day(consent.expires_at)}` : ""} · {consent.managed_by_name}
                {consent.note ? ` · ${consent.note}` : ""}
              </span>
              {active ? (
                <Button
                  type="button"
                  variant="outline"
                  className="ml-auto h-8 rounded-lg"
                  disabled={busy}
                  onClick={() => void save(consent.consent_type, "revoke", l("consents_revoke_note"))}
                >
                  {l("consents_revoke")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
