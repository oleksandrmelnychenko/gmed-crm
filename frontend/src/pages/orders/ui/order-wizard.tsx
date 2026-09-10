import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, checkboxClass, textareaClass } from "@/components/ui-shell";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { createContract, createQuote, fetchAgencyServices, fetchContracts } from "@/pages/contracts/data/contracts-api";
import type { AgencyServiceItem, ContractItem } from "@/pages/contracts/model/types";
import { downloadDocumentFile, fetchDocuments, generateDocument, markDocumentSigned } from "@/pages/documents/data/document-api";
import type { DocumentComplianceKind } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import type { PatientDetail } from "@/pages/patients/model/list-model";
import { OrderWizardShell } from "./order-wizard-shell";
import { OrderWizardChecksTable, OrderWizardDocumentsTable, OrderWizardLinesTable, OrderWizardSection } from "./order-wizard-tables";
import { createOrderIntake, fetchIntakeFacts, fetchOrderIntake, saveOrderIntake } from "../data/order-intake-api";
import { changedFacts, contractCoversOrder, emptyIntake, formatIntakeDate, intakeTotal } from "../model/order-intake";
import type { IntakeAction, IntakeDraft, IntakeFacts, IntakeWorkspace } from "../model/order-intake";

const STEPS = [
  ["Актуальные данные", "Aktuelle Daten"], ["Новый заказ", "Neuer Auftrag"],
  ["Услуги и стоимость", "Leistungen und Preise"], ["Договор", "Vertrag"],
  ["Документы и подписи", "Dokumente und Unterschriften"], ["Проверка", "Prüfung"],
];
const FACT_LABELS: Record<keyof IntakeFacts, [string, string]> = {
  insurance_type: ["Тип страхования", "Versicherungsart"], insurance_provider: ["Страховая компания", "Versicherung"],
  insurance_number: ["Номер полиса", "Versicherungsnummer"], phone_primary: ["Телефон", "Telefon"], email: ["Email", "E-Mail"],
  address_street: ["Улица и дом", "Straße und Hausnummer"], address_city: ["Город", "Ort"], address_zip: ["Индекс", "Postleitzahl"],
  address_country: ["Страна проживания", "Wohnsitzland"], pep_contract_partner: ["Пациент / партнёр договора — PEP", "Patient / Vertragspartner ist PEP"],
  pep_beneficial_owner: ["Бенефициар — PEP", "Wirtschaftlich Berechtigter ist PEP"],
  pep_office: ["Публичная должность / функция", "Öffentliches Amt / Funktion"], pep_asset_origin: ["Происхождение средств", "Vermögensherkunft"],
  representative_name: ["Представитель (если есть)", "Vertreter (falls vorhanden)"], representative_phone: ["Телефон представителя", "Telefon des Vertreters"],
  representative_authority: ["Основание полномочий", "Vertretungsbefugnis"],
};
const DOC_KINDS = [
  ["framework_contract", "Рамочный договор", "Rahmenvertrag"], ["single_order", "Заказ", "Einzelauftrag"],
  ["order_cost_estimate", "Согласование стоимости", "Kostenvereinbarung"], ["cost_estimate", "Смета", "Kostenvoranschlag"],
  ["privacy_consents", "Согласие на обработку данных", "Datenschutz-Einwilligung"],
  ["confidentiality_release", "Освобождение от врачебной тайны", "Schweigepflichtentbindung"],
  ["privacy_information", "Информация о защите данных", "Datenschutzinformation"],
  ["enhanced_due_diligence", "Проверка PEP", "PEP-Prüfung"],
] as const;
type CaseOption = { id: string; case_id: string; hauptanfragegrund?: string | null };

export function OrderWizard({ patient, orderId, onClose, onCreated, onSaved }: {
  patient: PatientDetail; orderId?: string; onClose: () => void;
  onCreated: (orderId: string) => void; onSaved?: () => void;
}) {
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const language = lang === "de" ? 1 : 0;
  const tx = (ru: string, de: string) => language ? de : ru;
  const [requestId] = useState(() => crypto.randomUUID());
  const [data, setData] = useState<IntakeDraft | null>(null);
  const [workspace, setWorkspace] = useState<IntakeWorkspace | null>(null);
  const workspaceRef = useRef<IntakeWorkspace | null>(null);
  const baseline = useRef<IntakeFacts | null>(null);
  const [savedKey, setSavedKey] = useState("");
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [catalog, setCatalog] = useState<AgencyServiceItem[]>([]);
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFailed, setAutoFailed] = useState(false);
  const [editingFacts, setEditingFacts] = useState(false);
  const [newContractFrom, setNewContractFrom] = useState("");
  const [newContractTo, setNewContractTo] = useState("");
  const [retry, setRetry] = useState(0);
  const [documentKind, setDocumentKind] = useState<string>("single_order");

  const apply = useCallback((next: IntakeWorkspace) => {
    workspaceRef.current = next;
    baseline.current = next.baseline_facts;
    setWorkspace(next); setData(next.data); setSavedKey(JSON.stringify(next.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    void Promise.all([
      orderId ? fetchOrderIntake(orderId) : fetchIntakeFacts(patient.id),
      fetchContracts(`/framework-contracts?patient_id=${patient.id}`),
      fetchAgencyServices("/agency-services?active_only=true"),
      apiFetch<CaseOption[]>(`/patients/${patient.id}/cases`, { forceFresh: true }),
      fetchDocuments(`/documents?patient_id=${patient.id}`),
    ]).then(([initial, nextContracts, services, nextCases, docs]) => {
      if (cancelled) return;
      if ("order_id" in initial) apply(initial);
      else { baseline.current = initial.facts; const draft = emptyIntake(initial.facts); setData(draft); setSavedKey(JSON.stringify(draft)); }
      setContracts(nextContracts); setCatalog(services); setCases(nextCases); setDocuments(docs);
    }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load order preparation"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apply, orderId, patient.id, retry]);

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await operation(); setAutoFailed(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to save order preparation"); setAutoFailed(true); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);

  const persist = useCallback(async (draft: IntakeDraft, action: IntakeAction = "save") => {
    let current = workspaceRef.current;
    if (!current) {
      if (!baseline.current) throw new Error("Patient context is not loaded");
      current = await createOrderIntake(patient.id, requestId, baseline.current);
      workspaceRef.current = current;
    }
    const next = await saveOrderIntake(current.order_id, current.revision, draft, action);
    apply(next);
    onSaved?.();
    return next;
  }, [apply, onSaved, patient.id, requestId]);

  const dirty = data !== null && JSON.stringify(data) !== savedKey;
  useEffect(() => {
    if (!data || !dirty || busy || loading || autoFailed) return;
    const timer = window.setTimeout(() => { void run(async () => { await persist(data); }); }, 1200);
    return () => window.clearTimeout(timer);
  }, [autoFailed, busy, data, dirty, loading, persist, run]);

  function patch(patchData: Partial<IntakeDraft>) {
    setData(current => current ? { ...current, ...patchData } : current); setAutoFailed(false);
  }
  function patchFact(key: keyof IntakeFacts, value: string | boolean | null) {
    if (data) patch({ facts: { ...data.facts, [key]: value } });
  }
  async function refreshDocuments() {
    const [docs, nextContracts] = await Promise.all([fetchDocuments(`/documents?patient_id=${patient.id}`), fetchContracts(`/framework-contracts?patient_id=${patient.id}`)]);
    setDocuments(docs); setContracts(nextContracts);
    if (workspaceRef.current) apply(await fetchOrderIntake(workspaceRef.current.order_id));
  }
  async function prepare(draft: IntakeDraft) {
    const saved = await persist(draft, "prepare");
    await createQuote(saved.order_id, {});
    const fresh = await fetchOrderIntake(saved.order_id); apply(fresh);
    return fresh;
  }
  async function generate(kind: string) {
    if (!data) return;
    const prepared = await prepare(data);
    const previous = documents.find(doc => doc.order_id === prepared.order_id && doc.generated_template_id === kind && doc.is_latest_version && doc.status !== "archived");
    const f = data.facts;
    await generateDocument({ template_id: kind, patient_id: patient.id, order_id: prepared.order_id,
      language: lang, replace_document_id: previous?.id,
      bindings: { period_from: data.date_from, period_to: data.date_to, examination_purpose: data.needs_description,
        aml_enhanced_due_diligence: kind === "enhanced_due_diligence" ? {
          ...data.aml_review, internal_risk_analysis: false, individual_review: true,
          pep_contract_partner: f.pep_contract_partner === true, pep_beneficial_owner: f.pep_beneficial_owner === true,
          pep_office_function: f.pep_office, pep_asset_origin: f.pep_asset_origin,
          high_risk_country_transaction: false, high_risk_country_resident: false,
          unusual_complex_or_large: false, unusual_pattern: false, no_lawful_purpose: false,
        } : undefined },
    });
    await refreshDocuments();
  }

  const step = data?.step ?? 0;
  const amount = intakeTotal(data?.lines ?? []);
  const pep = data?.facts.pep_contract_partner === true || data?.facts.pep_beneficial_owner === true;
  const selectedContract = contracts.find(contract => contract.id === data?.contract_id);
  const matchingContracts = data ? contracts.filter(contract => contractCoversOrder(contract, data.date_from, data.date_to)) : [];
  const factsChanged = data && workspace ? changedFacts(workspace.baseline_facts, data.facts) : [];
  const prettyFact = (key: keyof IntakeFacts, value: string | boolean | null) => {
    if (value === null || value === "") return tx("Не указано", "Nicht angegeben");
    if (typeof value === "boolean") return value ? tx("Да", "Ja") : tx("Нет", "Nein");
    if (key === "insurance_type") return ({ private: tx("Частная", "Privat"), public: tx("Государственная", "Gesetzlich"), foreign: tx("Иностранная", "Ausländisch"), self_pay: tx("Без страховки / самостоятельно", "Selbstzahler") })[value] ?? value;
    return value;
  };
  const reviewEvidence = () => void run(async () => {
    if (data && workspaceRef.current) {
      const fresh = await fetchOrderIntake(workspaceRef.current.order_id);
      const docs = await fetchDocuments(`/documents?order_id=${fresh.order_id}`);
      const kinds: Record<string, DocumentComplianceKind> = { privacy_consents: "dsgvo", confidentiality_release: "confidentiality_release", enhanced_due_diligence: "enhanced_due_diligence" };
      for (const doc of docs) {
        const kind = kinds[doc.generated_template_id ?? ""];
        if (kind && doc.signed_at && doc.is_latest_version && fresh.current_document_ids.includes(doc.id) && doc.compliance_kind !== kind) {
          await markDocumentSigned(doc.id, kind, doc.signed_at);
        }
      }
      await persist(data, "review_documents");
    }
    await refreshDocuments();
  });

  return <OrderWizardShell dirty={dirty} busy={busy} loading={loading} disabled={busy || loading || !data}
    onClose={onClose} lang={lang} step={step} steps={STEPS.map(labels => labels[language])}
    onStepChange={index => { if (data) void run(async () => { await persist({ ...data, step: index }); }); }}
    title={workspace?.order_number ?? tx("Новый заказ пациента", "Neuer Patientenauftrag")}
    description={`${patient.first_name} ${patient.last_name} · ${patient.patient_id}`}
    error={error === "API route not found" ? tx("Сервис оформления заказа пока недоступен. Повторите загрузку позже.", "Die Auftragsvorbereitung ist derzeit nicht verfügbar. Bitte laden Sie später erneut.") : error}
    footer={<>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>{tx("Этап", "Schritt")} {step + 1} {tx("из", "von")} {STEPS.length}</span>
        <span role="status" className="inline-flex items-center gap-1.5">{busy ? <><LoaderCircle className="size-3 animate-spin" />{tx("Сохранение…", "Wird gespeichert…")}</> : dirty ? tx("Есть изменения", "Ungespeicherte Änderungen") : workspace ? <><Check className="size-3 text-emerald-700" />{tx("Черновик сохранён", "Entwurf gespeichert")}</> : ""}</span>
      </div>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 [&_button]:h-9">
      <Button type="button" variant="outline" disabled={busy || !data || step === 0} onClick={() => void run(async () => { if (data) await persist({ ...data, step: step - 1 }); })}><ArrowLeft className="size-3.5" />{tx("Назад", "Zurück")}</Button>
      <div className="flex flex-wrap items-center justify-end gap-2">
      {!data ? <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{tx("Закрыть", "Schließen")}</Button> : null}
      {data ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { await persist(data); })}><Save className="size-4" />{tx("Сохранить", "Speichern")}</Button> : null}
      {data && step < 5 ? <Button type="button" disabled={busy} onClick={() => void run(async () => { await persist({ ...data, step: step + 1 }); })}>{tx("Далее", "Weiter")}<ArrowRight className="size-4" /></Button> : null}
      {data && step === 5 ? <Button type="button" disabled={busy || dirty || !workspace || workspace.checks.some(check => check.status === "blocked")}
        onClick={() => void run(async () => { const done = await persist(data, "confirm"); onCreated(done.order_id); })}><Check className="size-4" />{tx("Оформить заказ", "Auftrag bestätigen")}</Button> : null}
      </div>
    </div></>}>
    {autoFailed && workspace ? <Button type="button" variant="outline" disabled={busy} onClick={() => void run(async () => { apply(await fetchOrderIntake(workspace.order_id)); })}><RefreshCw className="size-4" />{tx("Загрузить сохранённую версию", "Gespeicherte Version laden")}</Button> : null}
    {loading ? <p role="status" className="flex gap-2 py-8"><LoaderCircle className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</p> : !data ?
      <Button type="button" variant="outline" onClick={() => setRetry(v => v + 1)}><RefreshCw className="size-4" />{tx("Повторить загрузку", "Erneut laden")}</Button> :
      <fieldset disabled={busy} className="min-w-0 space-y-3 disabled:opacity-75">
        {step === 0 ? <>
          <OrderWizardSection title={tx("Что изменилось с прошлого обращения?", "Was hat sich seit dem letzten Aufenthalt geändert?")}>
            <p className="text-xs text-muted-foreground">{tx("Проверьте сохранённые сведения. Изменения попадут в карточку пациента после подтверждения.", "Prüfen Sie die gespeicherten Angaben. Änderungen werden nach Bestätigung in die Patientenakte übernommen.")}</p>
            <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(FACT_LABELS) as (keyof IntakeFacts)[]).filter(key => !["pep_office", "pep_asset_origin"].includes(key) || pep).map(key =>
                <div key={key} className="min-w-0 border-b border-border/50 py-2.5"><dt className="text-xs text-muted-foreground">{FACT_LABELS[key][language]}</dt><dd className="mt-1 break-words text-xs font-medium">{prettyFact(key, data.facts[key])}</dd></div>)}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingFacts(value => !value)}>{tx("Изменить сведения", "Angaben ändern")}</Button>
              <Button type="button" onClick={() => void run(async () => { await persist(data, "confirm_facts"); setEditingFacts(false); })}><Check className="size-4" />{factsChanged.length ? tx("Подтвердить изменения", "Änderungen bestätigen") : tx("Данные актуальны", "Angaben sind aktuell")}</Button>
              <Button type="button" variant="outline" onClick={() => void run(async () => {
                if (workspaceRef.current) await persist(data, "reload_facts");
                else { const fresh = await fetchIntakeFacts(patient.id); baseline.current = fresh.facts; patch({ facts: fresh.facts }); }
              })}><RefreshCw className="size-4" />{tx("Загрузить актуальные данные", "Aktuelle Daten laden")}</Button>
            </div>
            {workspace?.facts_confirmed_at ? <p className="mt-3 text-xs text-muted-foreground">{tx("Последнее подтверждение", "Zuletzt bestätigt")}: {formatIntakeDate(workspace.facts_confirmed_at)}</p> : null}
          </OrderWizardSection>
          {editingFacts ? <OrderWizardSection title={tx("Обновить данные", "Angaben aktualisieren")}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(FACT_LABELS) as (keyof IntakeFacts)[]).filter(key => !["pep_office", "pep_asset_origin"].includes(key) || pep).map(key =>
                <Field key={key} label={FACT_LABELS[key][language]}>{key.startsWith("pep_") && ["pep_contract_partner", "pep_beneficial_owner"].includes(key) ?
                  <NativeComboboxSelect aria-label={FACT_LABELS[key][language]} disabled={busy} className="h-9 w-full text-xs" value={data.facts[key] === null ? "" : String(data.facts[key])} onChange={event => patchFact(key, event.target.value === "" ? null : event.target.value === "true")}><option value="">{tx("Нужно уточнить", "Noch zu klären")}</option><option value="false">{tx("Нет", "Nein")}</option><option value="true">{tx("Да", "Ja")}</option></NativeComboboxSelect> : key === "insurance_type" ?
                  <NativeComboboxSelect aria-label={FACT_LABELS[key][language]} disabled={busy} className="h-9 w-full text-xs" value={data.facts[key]} onChange={event => patchFact(key, event.target.value)}>{["", "private", "public", "foreign", "self_pay"].map(value => <option key={value} value={value}>{prettyFact(key, value)}</option>)}</NativeComboboxSelect> :
                  <Input aria-label={FACT_LABELS[key][language]} value={String(data.facts[key] ?? "")} maxLength={key === "email" || key === "phone_primary" ? 255 : 2000} onChange={event => patchFact(key, event.target.value)} />}</Field>)}
            </div>
            {factsChanged.length ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="mb-2 font-medium">{tx("Будет изменено в карточке пациента", "Änderungen in der Patientenakte")}</p>{factsChanged.map(key => <p key={key}>{FACT_LABELS[key][language]}: {prettyFact(key, workspace!.baseline_facts[key])} → {prettyFact(key, data.facts[key])}</p>)}</div> : null}
          </OrderWizardSection> : null}
        </> : null}

        {step === 1 ? <OrderWizardSection title={tx("Новое обращение", "Neuer Behandlungsanlass")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label={tx("Цель и потребности этого заказа", "Ziel und Bedarf dieses Auftrags")}><textarea className={textareaClass} rows={4} value={data.needs_description} onChange={event => patch({ needs_description: event.target.value })} /></Field></div>
            <Field label={tx("Дата начала", "Beginn")}><Input type="date" value={data.date_from ?? ""} onChange={event => patch({ date_from: event.target.value || null })} /></Field>
            <Field label={tx("Дата окончания", "Ende")}><Input type="date" value={data.date_to ?? ""} min={data.date_from ?? undefined} onChange={event => patch({ date_to: event.target.value || null })} /></Field>
            <div className="sm:col-span-2"><Field label={tx("Клинический эпизод", "Behandlungsfall")}><NativeComboboxSelect aria-label={tx("Клинический эпизод", "Behandlungsfall")} disabled={busy} className="h-9 w-full text-xs" value={data.case_id ?? ""} onChange={event => patch({ case_id: event.target.value || null })}><option value="">{tx("Новый эпизод при оформлении", "Neuer Fall bei Bestätigung")}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.case_id} · {item.hauptanfragegrund}</option>)}</NativeComboboxSelect></Field></div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{tx("История лечения, диагнозы и медикаменты доступны в медицинской карточке.", "Behandlungshistorie, Diagnosen und Medikation stehen in der Patientenakte zur Verfügung.")}</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => void run(async () => { await persist(data); onClose(); staffGo(`/patients/${patient.id}?tab=clinical`); })}>{tx("Открыть медицинские данные", "Medizinische Daten öffnen")}</Button>
        </OrderWizardSection> : null}

        {step === 2 ? <>
          <OrderWizardLinesTable lines={data.lines} catalog={catalog} effectiveOn={data.date_from} lang={lang} busy={busy} onChange={lines => patch({ lines })} />
          <OrderWizardSection title={tx("Условия оплаты", "Zahlungsbedingungen")}>
            <label className="flex items-center gap-2 text-xs font-medium"><input className={checkboxClass} type="checkbox" checked={data.prepayment_required} onChange={event => patch({ prepayment_required: event.target.checked })} />{tx("Предоплата предусмотрена", "Vorauszahlung vorgesehen")}</label>
            {data.prepayment_required ? <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-2"><Field label={tx("Сумма предоплаты, EUR", "Vorauszahlung, EUR")}><Input aria-label={tx("Сумма предоплаты, EUR", "Vorauszahlung, EUR")} type="number" min="0" max={amount} step="0.01" value={data.prepayment_amount} onChange={event => patch({ prepayment_amount: event.target.value })} /></Field><Field label={tx("Срок оплаты", "Zahlungsfrist")}><Input type="date" value={data.prepayment_due_at?.slice(0, 10) ?? ""} onChange={event => patch({ prepayment_due_at: event.target.value ? `${event.target.value}T12:00:00Z` : null })} /></Field></div> : null}
            <Button type="button" variant="outline" className="h-auto min-h-9 whitespace-normal text-left" onClick={() => void run(async () => { await prepare(data); })}><Save className="size-3.5 shrink-0" />{tx("Сохранить услуги и подготовить смету", "Leistungen speichern und Kostenvoranschlag erstellen")}</Button>
          </OrderWizardSection>
        </> : null}

        {step === 3 ? <OrderWizardSection title={tx("Договор для этого периода", "Vertrag für diesen Zeitraum")}>
          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{formatIntakeDate(data.date_from)} – {formatIntakeDate(data.date_to)}</Badge>
          <Field label={tx("Рамочный договор", "Rahmenvertrag")}><NativeComboboxSelect aria-label={tx("Рамочный договор", "Rahmenvertrag")} disabled={busy} className="h-9 w-full text-xs" value={data.contract_id ?? ""} onChange={event => patch({ contract_id: event.target.value || null })}><option value="">{tx("Выберите договор", "Vertrag auswählen")}</option>{contracts.map(contract => <option key={contract.id} value={contract.id}>{contract.contract_number} · {formatIntakeDate(contract.valid_from)} – {formatIntakeDate(contract.valid_to)} · {contractCoversOrder(contract, data.date_from, data.date_to) ? tx("Подходит", "Geeignet") : contract.status}</option>)}</NativeComboboxSelect></Field>
          {!data.contract_id && matchingContracts.length === 1 ? <Button type="button" variant="outline" className="mt-3" onClick={() => patch({ contract_id: matchingContracts[0].id })}>{tx("Использовать подходящий договор", "Passenden Vertrag verwenden")}: {matchingContracts[0].contract_number}</Button> : null}
          {selectedContract ? <p className={`mt-3 text-sm ${contractCoversOrder(selectedContract, data.date_from, data.date_to) ? "text-emerald-700" : "text-amber-700"}`}>{contractCoversOrder(selectedContract, data.date_from, data.date_to) ? tx("Договор подписан и покрывает весь период заказа.", "Der unterzeichnete Vertrag deckt den gesamten Auftragszeitraum ab.") : tx("Проверьте подпись и срок: этот договор пока не покрывает весь период заказа.", "Unterschrift und Gültigkeit prüfen: Dieser Vertrag deckt den gesamten Zeitraum noch nicht ab.")}</p> : null}
          <details className="mt-5 rounded-lg border p-4"><summary className="cursor-pointer font-medium">{tx("Создать новый рамочный договор", "Neuen Rahmenvertrag erstellen")}</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label={tx("Действует с", "Gültig ab")}><Input type="date" value={newContractFrom || data.date_from || ""} onChange={event => setNewContractFrom(event.target.value)} /></Field><Field label={tx("Действует до (необязательно)", "Gültig bis (optional)")}><Input type="date" value={newContractTo} onChange={event => setNewContractTo(event.target.value)} /></Field></div><Button type="button" className="mt-3" onClick={() => void run(async () => {
            const from = newContractFrom || data.date_from; if (!from || (newContractTo && newContractTo < from)) throw new Error(tx("Проверьте период договора", "Vertragszeitraum prüfen"));
            const draft = await persist(data);
            const contract = await createContract({ patient_id: patient.id, status: "draft", valid_from: from, valid_to: newContractTo || null, client_reference: `order-intake:${draft.order_id}:framework:${from}:${newContractTo || "open"}` });
            setContracts(await fetchContracts(`/framework-contracts?patient_id=${patient.id}`));
            await persist({ ...data, contract_id: contract.id });
          })}><Plus className="size-4" />{tx("Создать договор", "Vertrag erstellen")}</Button></details>
        </OrderWizardSection> : null}

        {step === 4 ? <>
          {pep ? <OrderWizardSection title={tx("Актуальная проверка PEP", "Aktuelle PEP-Prüfung")}><div className="grid gap-3 sm:grid-cols-2">{([
            ["risk_reason", "Причина проверки", "Prüfungsgrund"], ["manager_approval_name", "Согласовал руководитель", "Freigabe durch Führungskraft"],
            ["continuous_monitoring", "Порядок дальнейшего контроля", "Laufende Überwachung"], ["reviewer_name", "Проверил", "Geprüft von"],
          ] as const).map(([key, ru, de]) => <Field key={key} label={tx(ru, de)}><Input value={data.aml_review[key]} onChange={event => patch({ aml_review: { ...data.aml_review, [key]: event.target.value } })} /></Field>)}<Field label={tx("Дата проверки", "Prüfdatum")}><Input type="date" value={data.aml_review.review_date ?? ""} onChange={event => patch({ aml_review: { ...data.aml_review, review_date: event.target.value || null } })} /></Field></div></OrderWizardSection> : null}
          <OrderWizardSection flush title={tx("Документы этого заказа", "Dokumente dieses Auftrags")}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2.5">
              <div className="w-full min-w-0 sm:w-80"><NativeComboboxSelect aria-label={tx("Документ для подготовки", "Dokument zur Erstellung")} disabled={busy} className="h-9 w-full text-xs" value={documentKind === "enhanced_due_diligence" && !pep ? "single_order" : documentKind} onChange={event => setDocumentKind(event.target.value)}>
                {DOC_KINDS.filter(([kind]) => kind !== "enhanced_due_diligence" || pep).map(([kind, ru, de]) => <option key={kind} value={kind}>{tx(ru, de)}</option>)}
              </NativeComboboxSelect></div>
              <Button type="button" variant="outline" size="sm" onClick={() => void run(async () => generate(documentKind === "enhanced_due_diligence" && !pep ? "single_order" : documentKind))}><Plus className="size-3.5" />{tx("Создать документ", "Dokument erstellen")}</Button>
              <Button type="button" variant="outline" size="sm" className="sm:ml-auto" onClick={reviewEvidence}><RefreshCw className="size-3.5" />{tx("Обновить проверки", "Prüfungen aktualisieren")}</Button>
            </div>
            <OrderWizardDocumentsTable documents={documents.filter(doc => doc.order_id === workspace?.order_id && doc.is_latest_version && doc.status !== "archived")} currentIds={workspace?.current_document_ids ?? []} lang={lang} busy={busy}
              documentTitle={doc => { const label = DOC_KINDS.find(([kind]) => kind === doc.generated_template_id); return label ? label[language + 1] : doc.auto_name; }}
              onDownload={doc => void run(async () => { await downloadDocumentFile(doc.id, doc.auto_name); })}
              onReview={reviewEvidence}
              onSigned={doc => void run(async () => {
                const kinds: Record<string, DocumentComplianceKind> = { framework_contract: "framework_contract", enhanced_due_diligence: "enhanced_due_diligence", privacy_consents: "dsgvo", confidentiality_release: "confidentiality_release" };
                const kind: DocumentComplianceKind = kinds[doc.generated_template_id ?? ""] ?? "other";
                await markDocumentSigned(doc.id, kind); await persist(data, "review_documents"); await refreshDocuments();
              })}
            />
          </OrderWizardSection>
          <OrderWizardSection title={tx("Существующие документы пациента", "Vorhandene Patientendokumente")}><p className="text-sm text-muted-foreground">{tx("Общие документы используются из карточки пациента. Их актуальность проверяется перед оформлением.", "Allgemeine Dokumente werden aus der Patientenakte verwendet. Ihre Gültigkeit wird vor Abschluss geprüft.")}</p><Button type="button" variant="outline" className="mt-3" onClick={() => void run(async () => { await persist(data); onClose(); staffGo(`/patients/${patient.id}?tab=documents`); })}>{tx("Открыть документы пациента", "Patientendokumente öffnen")}</Button></OrderWizardSection>
        </> : null}

        {step === 5 ? <OrderWizardSection title={tx("Проверка перед оформлением", "Prüfung vor Abschluss")}>
          <dl className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:grid-cols-3 [&_dd]:mt-1 [&_dd]:font-mono [&_dd]:text-sm [&_dd]:font-medium"><div><dt className="text-xs text-muted-foreground">{tx("Период", "Zeitraum")}</dt><dd>{formatIntakeDate(data.date_from)} – {formatIntakeDate(data.date_to)}</dd></div><div><dt className="text-xs text-muted-foreground">{tx("Стоимость", "Gesamtpreis")}</dt><dd>{amount.toFixed(2)} EUR</dd></div><div><dt className="text-xs text-muted-foreground">{tx("Договор", "Vertrag")}</dt><dd>{selectedContract?.contract_number ?? "—"}</dd></div></dl>
          <OrderWizardChecksTable checks={workspace?.checks ?? []} lang={lang} busy={busy} onStepChange={nextStep => void run(async () => { await persist({ ...data, step: nextStep }); })} />
          <Button type="button" variant="outline" className="mt-4" onClick={reviewEvidence}><RefreshCw className="size-4" />{tx("Проверить снова", "Erneut prüfen")}</Button>
          <p className="mt-4 text-xs text-muted-foreground">{tx("После оформления откроется рабочая карточка заказа. Допуск к выполнению и контроль оплаты сохраняют действующие правила.", "Nach Bestätigung öffnet sich die Auftragsübersicht. Ausführungsfreigabe und Zahlungsüberwachung folgen den bestehenden Regeln.")}</p>
        </OrderWizardSection> : null}
      </fieldset>}
  </OrderWizardShell>;
}
