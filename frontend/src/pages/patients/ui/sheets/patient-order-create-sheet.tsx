import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LoaderCircle, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Field, textareaClass } from "@/components/ui-shell";
import { formatUiText, formatUnknownValue, useLang } from "@/lib/i18n";
import { createOrder, fetchPatientOrderRecheck } from "@/pages/orders/data/order-api";
import { resolveOrderBlockingReason } from "@/pages/orders/model/blocking-reasons";
import type { PatientOrderRecheck } from "@/pages/orders/model/types";
import type { PatientDetail } from "../../model/list-model";
import { PatientFormSection } from "../shared/patient-form-primitives";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const CHECK_LABELS: Record<string, string> = {
  base_data: "orders_stammdaten_vollstandig",
  compliance: "orders_compliance_dokumente_gultig",
  identity: "orders_identitat_verifiziert",
  document_pack: "orders_erforderliche_patientendokumente_vollstandig",
  contract: "orders_vertragsunterlagen_gultig",
  debt_clear: "orders_keine_uberfalligen_forderungen_erkannt",
  passport_valid: "orders_recheck_passport_valid",
};

export function PatientOrderCreateSheet({ patient, onClose, onCreated }: {
  patient: PatientDetail;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang } = useLang();
  const [notes, setNotes] = useState("");
  const [recheck, setRecheck] = useState<PatientOrderRecheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const l = (key: string) => t.uiText[key] ?? key;
  const localizeReason = (reason: string) => {
    const translated = resolveOrderBlockingReason(reason);
    return translated
      ? formatUiText(t.uiText[translated.key] ?? translated.key, translated.values)
      : formatUnknownValue(reason, t);
  };
  const blocked = !!recheck && !recheck.can_create_order;

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setRecheck(null);
    setRecheckError(null);
    void fetchPatientOrderRecheck(patient.id)
      .then(result => { if (!cancelled) setRecheck(result); })
      .catch(error => {
        if (!cancelled) setRecheckError(error instanceof Error ? error.message : t.uiText.orders_error_load_patient_recheck);
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [patient.id, revision, t.uiText.orders_error_load_patient_recheck]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || checking || !recheck || blocked) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await createOrder({
        patient_id: patient.id,
        contract_id: null,
        needs_description: notes.trim() || null,
      });
      toast.success(lang === "de" ? "Auftrag angelegt" : "Заказ создан");
      onCreated();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : l("orders_error_create_order"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <PatientSheetScaffold
      open
      dirty={notes.trim().length > 0}
      onOpenChange={open => { if (!open && !savingRef.current) onClose(); }}
      title={t.orders_create_title}
      width="default"
      headerClassName="border-b border-border/70"
      bodyClassName="bg-muted/10"
      onSubmit={submit}
      footerError={saveError || recheckError ? (
        <div className="max-h-24 overflow-y-auto">{saveError || recheckError}</div>
      ) : undefined}
      footer={(
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t.common_cancel}</Button>
          <Button type="submit" disabled={saving || checking || !recheck || blocked}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t.orders_create_title}
          </Button>
        </>
      )}
    >
      <PatientFormSection title={t.orders_patient}>
        <p className="font-semibold">{patient.first_name} {patient.last_name}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{patient.patient_id}</p>
      </PatientFormSection>
      <PatientFormSection title={l("orders_re_check_fur_bestandskunden")}>
        <div className="space-y-3">
          {checking ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />{l("orders_patienten_re_check_wird_geladen")}
            </p>
          ) : recheck ? (
            <>
              <p className={blocked ? "text-sm font-medium text-amber-700" : "flex items-center gap-2 text-sm font-medium text-emerald-700"}>
                {!blocked ? <CheckCircle2 className="size-4 shrink-0" /> : null}
                {l(blocked ? "orders_blockiert_2" : "orders_bereit_fur_auftrag")}
              </p>
              {recheck.requires_recheck ? (
                <dl className="divide-y divide-border/60 text-sm">
                  {recheck.checks.map(check => (
                    <div key={check.key} className="flex items-start justify-between gap-4 py-2">
                      <dt>{CHECK_LABELS[check.key] ? l(CHECK_LABELS[check.key]) : check.label}</dt>
                      <dd className={check.passed ? "shrink-0 text-emerald-700" : "shrink-0 text-amber-700"}>
                        {check.passed ? t.common_yes : l("orders_aktualisierung_notig")}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {blocked ? (
                <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-3 pl-7 pr-3 text-sm text-amber-800">
                  {(recheck.blocking_reasons.length ? recheck.blocking_reasons : [l("orders_blockiert_2")]).map(reason => (
                    <li key={reason}>{localizeReason(reason)}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
          <Button type="button" variant="outline" size="sm" disabled={checking || saving} onClick={() => setRevision(value => value + 1)}>
            <RefreshCw className="size-4" />{lang === "de" ? "Erneut prüfen" : "Проверить снова"}
          </Button>
        </div>
      </PatientFormSection>
      <PatientFormSection title={t.leads_needs}>
        <Field label={t.leads_needs}>
          <textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={saving} rows={5} className={textareaClass} />
        </Field>
      </PatientFormSection>
    </PatientSheetScaffold>
  );
}
