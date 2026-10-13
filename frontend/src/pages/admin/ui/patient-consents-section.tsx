import { useCallback, useEffect, useState } from "react";

import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { ComplianceSection } from "@/pages/admin/ui/compliance-section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Banner, Field, selectClass, textareaClass } from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { formatAppDate } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
  return value ? formatAppDate(value) || value : "—";
}

export type ConsentRowStatus = "active" | "expired" | "superseded" | "ended" | "revoked";

/**
 * State of one history row. A revoke writes its own row (granted = false) and
 * closes the grant before it; a renewed grant closes the previous grant too,
 * so `revoked_at` alone cannot tell "withdrawn" from "replaced". The row that
 * followed decides: the newest grant is active until it expires. The grant a
 * revocation closed reads "valid until revoked", so the revocation is listed
 * once, as its own row (QA 2026-10-12 B2-13).
 */
export function consentRowStatus(
  consent: Pick<ConsentRecord, "granted" | "revoked_at" | "expires_at">,
  newer: Pick<ConsentRecord, "granted"> | null,
  now: number = Date.now(),
): ConsentRowStatus {
  if (!consent.granted) return "revoked";
  if (newer) return newer.granted ? "superseded" : "ended";
  if (consent.revoked_at) return "revoked";
  if (consent.expires_at && new Date(consent.expires_at).getTime() <= now) return "expired";
  return "active";
}

const CONSENT_STATUS_TONE: Record<ConsentRowStatus, StatusChipTone> = {
  active: "success",
  expired: "warning",
  superseded: "neutral",
  ended: "neutral",
  revoked: "error",
};

/** How the patient's revocation reached GMED (Art. 7 Abs. 3 DSGVO evidence). */
const REVOCATION_CHANNELS = ["letter", "email", "portal", "in_person", "phone"] as const;
type RevocationChannel = (typeof REVOCATION_CHANNELS)[number];

/** The consents whose revocation blocks new orders until a newer signed one. */
const ORDER_BLOCKING_CONSENTS = new Set(["dsgvo_data_transfer", "schweigepflicht_release"]);

/** The note a revocation is recorded with: channel and reason, at most 500 characters. */
export function revocationNote(channelLabel: string, reason: string): string {
  return `${channelLabel}: ${reason.trim()}`.slice(0, 500);
}

/**
 * "Revoke" asks before it records anything: how the revocation was received
 * and why (at least 10 characters), and what it changes (QA 2026-10-12 B2-13).
 */
function ConsentRevokeDialog({
  consentType,
  patientLabel,
  patientFieldLabel,
  typeLabel,
  l,
  onClose,
  onConfirm,
}: {
  consentType: string | null;
  /** The patient whose consent is revoked: named in the dialog (QA B3-02). */
  patientLabel: string;
  patientFieldLabel: string;
  typeLabel: (value: string) => string;
  l: (key: string) => string;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [channel, setChannel] = useState<RevocationChannel | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (consentType) {
      setChannel("");
      setReason("");
    }
  }, [consentType]);
  const valid = channel !== "" && reason.trim().length >= 10;
  return (
    <Dialog open={consentType !== null} onOpenChange={(next) => (!next ? onClose() : undefined)} dirty={Boolean(reason || channel)}>
      <DialogContent overlayClassName="bg-black/40" className="sm:max-w-[560px]" data-testid="consent-revoke-dialog">
        <DialogHeader>
          <DialogTitle>
            {l("consents_revoke_title")}: {consentType ? typeLabel(consentType) : ""}
          </DialogTitle>
          <DialogDescription>
            {consentType && ORDER_BLOCKING_CONSENTS.has(consentType)
              ? l("consents_revoke_blocks_orders")
              : l("consents_revoke_hint")}
          </DialogDescription>
        </DialogHeader>
        {patientLabel ? (
          <div
            className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            data-testid="consent-revoke-patient"
          >
            <div className="text-xs text-muted-foreground">{patientFieldLabel}</div>
            <div className="text-sm font-semibold text-foreground">{patientLabel}</div>
          </div>
        ) : null}
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || !channel) return;
            setBusy(true);
            void onConfirm(revocationNote(l(`consents_revoke_channel_${channel}`), reason)).finally(() =>
              setBusy(false),
            );
          }}
        >
          <Field label={l("consents_revoke_channel")} htmlFor="consent-revoke-channel" required>
            <select
              id="consent-revoke-channel"
              className={selectClass}
              value={channel}
              disabled={busy}
              onChange={(event) => setChannel(event.target.value as RevocationChannel | "")}
            >
              <option value="">{l("consents_revoke_channel_choose")}</option>
              {REVOCATION_CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {l(`consents_revoke_channel_${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={l("consents_revoke_reason")} htmlFor="consent-revoke-reason" required>
            <textarea
              id="consent-revoke-reason"
              className={cn(textareaClass, "min-h-20")}
              maxLength={440}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{l("consents_revoke_reason_hint")}</p>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {l("consents_revoke_cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !valid}>
              {l("consents_revoke_confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Consent history of one patient with grant and revoke. A consent must be as
 * easy to withdraw as to give (Art. 7 Abs. 3 DSGVO); until now that was only
 * possible through the API.
 */
export function PatientConsentsSection({
  patientId,
  patientLabel = "",
  canManage = true,
  actionsDisabled = false,
}: {
  patientId: string;
  /** "P-… · Name" of the patient: shown with the section and in the revoke dialog. */
  patientLabel?: string;
  /** Grant and revoke; without it the history is read-only (CEO Assistant, QA B3-11). */
  canManage?: boolean;
  /** Holds grant and revoke while the page has not loaded this patient (QA B3-02). */
  actionsDisabled?: boolean;
}) {
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
  const [revoking, setRevoking] = useState<string | null>(null);

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
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!patientId) return null;

  // The list comes newest first; remember, per row, the row of the same type
  // that followed it (null for the newest one).
  const newerById = new Map<string, ConsentRecord | null>();
  const lastSeenByType = new Map<string, ConsentRecord>();
  for (const consent of consents) {
    newerById.set(consent.id, lastSeenByType.get(consent.consent_type) ?? null);
    lastSeenByType.set(consent.consent_type, consent);
  }

  return (
    <ComplianceSection
      title={l("consents_title")}
      accessory={patientLabel ? (
        <div
          className="max-w-full break-words rounded-lg border border-border/60 bg-muted/25 px-2.5 py-1.5 text-xs font-medium text-foreground"
          data-testid="consents-patient"
        >
          {patientLabel}
        </div>
      ) : null}
    >
      {error ? <Banner tone="error">{error}</Banner> : null}

      {canManage ? (
      <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
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
            className="h-8 rounded-lg px-3 text-xs"
            disabled={busy || actionsDisabled}
            onClick={() => void save(consentType, "grant", note.trim())}
          >
            {l("consents_grant")}
          </Button>
        </div>
      </div>
      ) : null}

      <div className="space-y-2" data-testid="patient-consents">
        {consents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{l("consents_empty")}</p>
        ) : null}
        {consents.map((consent) => {
          const status = consentRowStatus(consent, newerById.get(consent.id) ?? null);
          const active = status === "active";
          return (
            <div
              key={consent.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/10 p-3 text-sm"
            >
              <span className="font-medium">{typeLabel(consent.consent_type)}</span>
              <StatusChip tone={CONSENT_STATUS_TONE[status]}>{l(`consents_status_${status}`)}</StatusChip>
              <span className="min-w-0 break-words text-xs text-muted-foreground">
                {day(consent.granted_at ?? consent.created_at)}
                {consent.expires_at ? ` → ${day(consent.expires_at)}` : ""} · {consent.managed_by_name}
                {consent.note ? ` · ${consent.note}` : ""}
              </span>
              {active && canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  className="ml-auto h-8 rounded-lg text-xs"
                  disabled={busy || actionsDisabled}
                  onClick={() => setRevoking(consent.consent_type)}
                >
                  {l("consents_revoke")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <ConsentRevokeDialog
        consentType={revoking}
        patientLabel={patientLabel}
        patientFieldLabel={t.orders_patient}
        typeLabel={typeLabel}
        l={l}
        onClose={() => setRevoking(null)}
        onConfirm={async (revocation) => {
          if (!revoking) return;
          const ok = await save(revoking, "revoke", revocation);
          if (ok) setRevoking(null);
        }}
      />
    </ComplianceSection>
  );
}
