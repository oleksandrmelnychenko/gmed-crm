import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { liftPatientProcessingRestriction } from "@/pages/admin/data/admin-api";

type Props = {
  patientId: string;
  legalStatus: unknown;
  canLift: boolean;
  formatDateTime: (value: string) => string;
  l: (key: string) => string;
  onLifted: () => void;
};

export function readProcessingRestriction(legalStatus: unknown) {
  if (!legalStatus || typeof legalStatus !== "object") return null;
  const record = legalStatus as Record<string, unknown>;
  if (record.processing_restricted !== true) return null;
  const since = record.processing_restricted_at;
  return { since: typeof since === "string" ? since : null };
}

const MIN_REASON_LENGTH = 10;

export function ProcessingRestrictionBanner({
  patientId,
  legalStatus,
  canLift,
  formatDateTime,
  l,
  onLifted,
}: Props) {
  const restriction = readProcessingRestriction(legalStatus);
  const [lifting, setLifting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!restriction) return null;

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await liftPatientProcessingRestriction(patientId, reason.trim());
      setLifting(false);
      setReason("");
      onLifted();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="processing-restriction-banner"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900"
    >
      <div className="flex flex-wrap items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{l("patients_restriction_title")}</p>
          <p className="text-sm">{l("patients_restriction_body")}</p>
          {restriction.since ? (
            <p className="mt-1 text-xs text-amber-800">
              {l("patients_restriction_since")}: {formatDateTime(restriction.since)}
            </p>
          ) : null}
        </div>
        {canLift && !lifting ? (
          <Button variant="outline" size="sm" onClick={() => setLifting(true)}>
            {l("patients_restriction_lift")}
          </Button>
        ) : null}
      </div>
      {canLift && lifting ? (
        <div className="mt-3 space-y-2">
          <label className="block text-sm" htmlFor="processing-restriction-reason">
            {l("patients_restriction_reason")}
          </label>
          <textarea
            id="processing-restriction-reason"
            className="w-full rounded-md border border-amber-300 bg-white p-2 text-sm text-foreground"
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {failed ? <p className="text-sm text-red-700">{l("patients_restriction_error")}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || reason.trim().length < MIN_REASON_LENGTH}
              onClick={() => void submit()}
            >
              {l("patients_restriction_confirm")}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setLifting(false)}>
              {l("patients_restriction_cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
