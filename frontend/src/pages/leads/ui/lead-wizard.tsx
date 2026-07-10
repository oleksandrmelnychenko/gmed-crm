import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  UserPlus,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { selectClass, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  createOrder,
  createOrderLeistung,
  updateOrderCommercialBasis,
} from "@/pages/orders/data/order-api";
import {
  fetchPatientClinical,
  savePatientClinicalWarnings,
  savePatientMedications,
  savePatientNarrative,
} from "@/pages/patients/data/patient-clinical";

import {
  fetchLeadDetail,
  updateLeadWizard,
  wizardConvertLead,
} from "../data/leads-api";
import {
  createFrameworkContract,
  fetchPatientRelations,
  upsertPatientRelation,
} from "@/pages/patients/data/patient-detail-mutations";
import { PatientDocumentGenerateDialog } from "@/pages/patients/ui/sheets/patient-document-generate-dialog";
import type { PatientOption } from "@/pages/documents/model/types";

import {
  PHASE_A_STEPS,
  blankClinicalIntake,
  blankGuardian,
  blankOrderLine,
  canConvert,
  canFinishOrder,
  clinicalIntakeHasAllergy,
  clinicalIntakeHasCave,
  clinicalIntakeHasMedication,
  clinicalIntakeHasNarrative,
  clinicalMedicationFingerprint,
  clinicalMedicationPayload,
  clinicalNarrativePayload,
  clinicalWarningFingerprint,
  clinicalWarningPayload,
  costEstimate,
  draftFromLead,
  guardianPayload,
  isMinor,
  nextStep,
  orderLineClientReference,
  orderLineIsValid,
  orderLinePayload,
  orderNeedsDescription,
  orderResumeFromLead,
  orderResumeWizardState,
  prevStep,
  resumeStep,
  stepIsComplete,
  wizardUpdatePayload,
  type ClinicalIntakeDraft,
  type GuardianDraft,
  type LegalSex,
  type WizardDraft,
  type WizardOrderLine,
  type WizardStepId,
} from "../model/lead-wizard.model";

type Bilingual = (ru: string, de: string) => string;

type LeadWizardProps = {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (patientId: string) => void;
  onOrderCreated?: (orderId: string) => void;
};

const LEGAL_SEX_OPTIONS: readonly LegalSex[] = ["female", "male", "diverse", "no_entry"];

function legalSexLabel(value: LegalSex, tx: Bilingual): string {
  switch (value) {
    case "female":
      return tx("Женский", "Weiblich");
    case "male":
      return tx("Мужской", "Männlich");
    case "diverse":
      return tx("Другое", "Divers");
    case "no_entry":
      return tx("Без указания", "Keine Angabe");
  }
}

function stepLabel(step: WizardStepId, tx: Bilingual): string {
  switch (step) {
    case "identity":
      return tx("Личность", "Identität");
    case "eligibility":
      return tx("Причина", "Anliegen");
    case "specialties":
      return tx("Специалисты", "Fachärzte");
  }
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ChipEditor({
  items,
  placeholder,
  onAdd,
  onRemove,
}: {
  items: string[];
  placeholder: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [value, setValue] = useState("");
  function commit() {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={commit}
          disabled={!value.trim()}
          aria-label={placeholder}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="remove"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LeadWizard({
  leadId,
  open,
  onOpenChange,
  onConverted,
  onOrderCreated,
}: LeadWizardProps) {
  const { lang } = useLang();
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);

  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [step, setStep] = useState<WizardStepId>("identity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  // Phase B — after conversion the wizard forms the actual order (#8).
  const [phase, setPhase] = useState<"lead" | "order">("lead");
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdPatientId, setCreatedPatientId] = useState<string | null>(null);
  const [createdPatientPid, setCreatedPatientPid] = useState("");
  const [genDocOpen, setGenDocOpen] = useState(false);
  const [orderLines, setOrderLines] = useState<WizardOrderLine[]>(() => [blankOrderLine()]);
  const [savedOrderLineKeys, setSavedOrderLineKeys] = useState<string[]>([]);
  const [guardian, setGuardian] = useState<GuardianDraft>(blankGuardian());
  const [clinicalIntake, setClinicalIntake] = useState<ClinicalIntakeDraft>(
    blankClinicalIntake(),
  );
  const [startContract, setStartContract] = useState(true);
  const [contractId, setContractId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !leadId) return;
    let active = true;
    setLoadError(false);
    setError("");
    setDraft(null);
    setPhase("lead");
    setCreatedOrderId(null);
    setCreatedPatientId(null);
    setCreatedPatientPid("");
    setGenDocOpen(false);
    setOrderLines([blankOrderLine()]);
    setSavedOrderLineKeys([]);
    setGuardian(blankGuardian());
    setClinicalIntake(blankClinicalIntake());
    setStartContract(true);
    setContractId(null);
    fetchLeadDetail(leadId)
      .then((lead) => {
        if (!active) return;
        const nextDraft = draftFromLead(lead);
        setDraft(nextDraft);
        setStep(resumeStep(lead));
        const orderResume = orderResumeFromLead(lead);
        if (orderResume) {
          setCreatedPatientId(orderResume.patientId);
          setCreatedPatientPid(orderResume.patientPid);
          setCreatedOrderId(orderResume.orderId);
          setSavedOrderLineKeys(orderResume.savedOrderLineKeys);
          setOrderLines(
            orderResume.orderLines.length > 0 ? orderResume.orderLines : [blankOrderLine()],
          );
          setGuardian(orderResume.guardian);
          setClinicalIntake(orderResume.clinicalIntake);
          setStartContract(orderResume.startContract);
          setContractId(orderResume.contractId);
          setPhase("order");
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [open, leadId]);

  function patch(update: Partial<WizardDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  async function persist(targetStep: WizardStepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    setBusy(true);
    setError("");
    try {
      await updateLeadWizard(leadId, wizardUpdatePayload(draft, targetStep));
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось сохранить", "Speichern fehlgeschlagen"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function persistOrderResumeState(
    patientId: string,
    orderId: string,
    lineKeys = savedOrderLineKeys,
    nextContractId = contractId,
  ) {
    if (!leadId || !draft) return;
    await updateLeadWizard(leadId, {
      wizard_state: orderResumeWizardState(
        draft,
        step,
        {
          patientId,
          patientPid: createdPatientPid,
          orderId,
          savedOrderLineKeys: lineKeys,
          orderLines,
          guardian,
          clinicalIntake,
          startContract,
          contractId: nextContractId,
        },
      ),
    });
  }

  async function persistOrderCompletedState(
    patientId: string,
    orderId: string,
    lineKeys = savedOrderLineKeys,
    nextContractId = contractId,
  ) {
    if (!leadId || !draft) return;
    await updateLeadWizard(leadId, {
      wizard_state: {
        ...orderResumeWizardState(
          draft,
          step,
          {
            patientId,
            patientPid: createdPatientPid,
            orderId,
            savedOrderLineKeys: lineKeys,
            orderLines,
            guardian,
            clinicalIntake,
            startContract,
            contractId: nextContractId,
          },
        ),
        phase: "completed",
      },
    });
  }

  async function goNext() {
    const target = nextStep(step);
    if (!target) return;
    if (await persist(target)) setStep(target);
  }

  function goBack() {
    const target = prevStep(step);
    if (target) setStep(target);
  }

  async function handleConvert() {
    if (!leadId || !draft || !canConvert(draft)) return;
    if (!(await persist(step))) return;
    setBusy(true);
    setError("");
    try {
      const result = await wizardConvertLead(leadId);
      setCreatedPatientId(result.patient_id);
      setCreatedPatientPid(result.patient_pid);
      setClinicalIntake(blankClinicalIntake(draft));
      // Form the draft order — the goal of the wizard (#8) — carrying the
      // captured concern and requested specialists into needs_description.
      try {
        const order = await createOrder({
          patient_id: result.patient_id,
          needs_description: orderNeedsDescription(draft),
          source_lead_id: leadId,
        });
        // Stay open and move into Phase B to build the order's line items.
        setCreatedOrderId(order.id);
        setPhase("order");
        try {
          await updateLeadWizard(leadId, {
            wizard_state: orderResumeWizardState(draft, step, {
              patientId: result.patient_id,
              patientPid: result.patient_pid,
              orderId: order.id,
              savedOrderLineKeys: [],
              orderLines,
              guardian,
              clinicalIntake: blankClinicalIntake(draft),
              startContract,
              contractId: null,
            }),
          });
        } catch (resumeError) {
          setError(
            resumeError instanceof Error
              ? resumeError.message
              : tx(
                  "Черновик заказа создан, но состояние обработки не удалось сохранить.",
                  "Auftragsentwurf erstellt, aber der Bearbeitungsstatus konnte nicht gespeichert werden.",
                ),
          );
        }
      } catch (orderError) {
        setError(
          orderError instanceof Error
            ? orderError.message
            : tx(
                "Пациент создан, но черновик заказа не удалось сформировать. Повторите шаг.",
                "Patient angelegt, aber der Auftragsentwurf konnte nicht erstellt werden. Schritt erneut versuchen.",
              ),
        );
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось конвертировать", "Konvertierung fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  function patchLine(index: number, update: Partial<WizardOrderLine>) {
    setOrderLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...update } : line)),
    );
  }

  function patchClinicalIntake(update: Partial<ClinicalIntakeDraft>) {
    setClinicalIntake((current) => ({ ...current, ...update }));
  }

  async function saveClinicalIntake(patientId: string) {
    const hasClinicalData =
      clinicalIntakeHasNarrative(clinicalIntake) ||
      clinicalIntakeHasMedication(clinicalIntake) ||
      clinicalIntakeHasAllergy(clinicalIntake) ||
      clinicalIntakeHasCave(clinicalIntake);
    if (!hasClinicalData) return;

    const clinical = await fetchPatientClinical(patientId);
    if (clinicalIntakeHasNarrative(clinicalIntake)) {
      await savePatientNarrative(
        patientId,
        clinicalNarrativePayload(clinicalIntake, clinical.narrative),
      );
    }

    const medication = clinicalMedicationPayload(clinicalIntake);
    if (medication) {
      const existingKeys = new Set(
        (clinical.medications ?? []).map((item) => clinicalMedicationFingerprint(item)),
      );
      const medicationKey = clinicalMedicationFingerprint(medication);
      if (!existingKeys.has(medicationKey)) {
        await savePatientMedications(patientId, [...(clinical.medications ?? []), medication]);
      }
    }

    const allergy = clinicalWarningPayload(clinicalIntake, "allergie");
    if (allergy) {
      const existingKeys = new Set(
        (clinical.allergien ?? []).map((item) => clinicalWarningFingerprint(item)),
      );
      if (!existingKeys.has(clinicalWarningFingerprint(allergy))) {
        await savePatientClinicalWarnings(patientId, "allergie", [
          ...(clinical.allergien ?? []),
          allergy,
        ]);
      }
    }

    const cave = clinicalWarningPayload(clinicalIntake, "cave");
    if (cave) {
      const existingKeys = new Set(
        (clinical.cave ?? []).map((item) => clinicalWarningFingerprint(item)),
      );
      if (!existingKeys.has(clinicalWarningFingerprint(cave))) {
        await savePatientClinicalWarnings(patientId, "cave", [...(clinical.cave ?? []), cave]);
      }
    }
  }

  async function ensureGuardianRelation(patientId: string) {
    const expected = guardianPayload(guardian);
    const expectedName = String(expected.related_name).trim().toLowerCase();
    const expectedPhone = String(expected.phone ?? "").trim().toLowerCase();
    const relations = await fetchPatientRelations(patientId);
    const exists = relations.some(
      (relation) =>
        relation.relation_type === "guardian" &&
        relation.related_name.trim().toLowerCase() === expectedName &&
        (relation.phone ?? "").trim().toLowerCase() === expectedPhone,
    );
    if (!exists) {
      await upsertPatientRelation(patientId, expected);
    }
  }

  async function handleFinishOrder() {
    if (!createdOrderId || !createdPatientId || !leadId) return;
    setBusy(true);
    setError("");
    const billable = orderLines
      .map((line) => ({ line, key: line.clientKey }))
      .filter(({ line }) => orderLineIsValid(line));
    try {
      await persistOrderResumeState(createdPatientId, createdOrderId);
      const completedLineKeys = new Set(savedOrderLineKeys);
      for (const { line, key } of billable) {
        if (completedLineKeys.has(key)) continue;
        await createOrderLeistung(
          createdOrderId,
          orderLinePayload(
            line,
            createdPatientId,
            orderLineClientReference(leadId, line),
          ),
        );
        completedLineKeys.add(key);
        const nextLineKeys = Array.from(completedLineKeys);
        setSavedOrderLineKeys(nextLineKeys);
        await persistOrderResumeState(
          createdPatientId,
          createdOrderId,
          nextLineKeys,
          contractId,
        );
      }
      // A minor's guardian is recorded before the order is opened (#2/#11).
      if (minor) {
        await ensureGuardianRelation(createdPatientId);
      }
      await saveClinicalIntake(createdPatientId);
      // Create the framework contract only after line items and clinical intake
      // are saved, so a retry after an earlier failure does not stack contracts.
      let effectiveContractId = contractId;
      if (startContract && !effectiveContractId) {
        const contract = await createFrameworkContract({
          patient_id: createdPatientId,
          status: "draft",
          client_reference: `lead-wizard:${leadId}:${createdOrderId}:framework-contract`,
          conditions: {
            source: "lead_wizard",
            lead_id: leadId,
            order_id: createdOrderId,
          },
        });
        effectiveContractId = contract.id;
        setContractId(contract.id);
        await persistOrderResumeState(
          createdPatientId,
          createdOrderId,
          Array.from(completedLineKeys),
          contract.id,
        );
      }
      await updateOrderCommercialBasis(createdOrderId, {
        total_estimated: estimate.gross.toFixed(2),
        contract_id: effectiveContractId,
      });
      await persistOrderCompletedState(
        createdPatientId,
        createdOrderId,
        Array.from(completedLineKeys),
        effectiveContractId,
      );
      const orderId = createdOrderId;
      onOpenChange(false);
      if (onOrderCreated) onOrderCreated(orderId);
      else if (createdPatientId) onConverted?.(createdPatientId);
    } catch (nextError) {
      const retryHint = tx(
        "Окно обработки остаётся открытым — исправьте ошибку и повторите.",
        "Die Bearbeitung bleibt geöffnet — Fehler beheben und erneut versuchen.",
      );
      setError(
        nextError instanceof Error
          ? `${nextError.message} ${retryHint}`
          : tx(
              "Не удалось завершить. Окно обработки остаётся открытым — исправьте ошибку и повторите.",
              "Abschluss fehlgeschlagen. Die Bearbeitung bleibt geöffnet — Fehler beheben und erneut versuchen.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveOrderDraft() {
    if (!createdPatientId || !createdOrderId) return false;
    setBusy(true);
    setError("");
    try {
      await persistOrderResumeState(createdPatientId, createdOrderId);
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось сохранить черновик", "Entwurf konnte nicht gespeichert werden"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function handleWizardOpenChange(nextOpen: boolean) {
    if (nextOpen || phase !== "order" || !createdPatientId || !createdOrderId) {
      onOpenChange(nextOpen);
      return;
    }
    void saveOrderDraft().then((saved) => {
      if (saved) onOpenChange(false);
    });
  }

  const minor = draft ? isMinor(draft.dateOfBirth, new Date()) : false;
  const estimate = costEstimate(orderLines);
  const hasBillableLines = orderLines.some(orderLineIsValid);
  const patientOption: PatientOption | undefined =
    createdPatientId && draft
      ? {
          id: createdPatientId,
          patient_id: createdPatientPid,
          first_name: draft.firstName,
          last_name: draft.lastName,
          languages: draft.primaryLanguage ? [draft.primaryLanguage] : [],
        }
      : undefined;

  return (
    <>
      <Sheet open={open} onOpenChange={handleWizardOpenChange}>
        <SheetContent className="w-[calc(100%-1.5rem)]! gap-0 overflow-hidden p-0 sm:max-w-2xl!">
        <header className="shrink-0 border-b border-border/70 bg-popover px-5 pb-4 pt-4 pr-14">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg font-semibold text-foreground">
              {phase === "order"
                ? tx("Формирование заказа", "Auftrag erstellen")
                : tx("Обработка лида", "Lead bearbeiten")}
            </SheetTitle>
            {minor ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                {tx("Ребёнок", "Minderjährig")}
              </Badge>
            ) : null}
          </div>
          <ol className="mt-4 grid grid-cols-3 gap-2">
            {PHASE_A_STEPS.map((phaseStep, index) => {
              const done = draft ? stepIsComplete(phaseStep, draft) : false;
              const active = phaseStep === step;
              return (
                <li key={phaseStep}>
                  <button
                    type="button"
                    onClick={() => setStep(phaseStep)}
                    className={cn(
                      "flex min-h-10 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : done
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums",
                        active
                          ? "border-primary/40 bg-background"
                          : done
                            ? "border-emerald-300 bg-white"
                            : "border-border bg-muted/40",
                      )}
                    >
                      {done ? <Check className="size-3" /> : index + 1}
                    </span>
                    <span className="min-w-0 leading-tight">{stepLabel(phaseStep, tx)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-muted/10 px-5 py-5">
          {loadError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {tx("Не удалось загрузить лид", "Lead konnte nicht geladen werden")}
            </div>
          ) : phase === "order" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {tx(
                  "Пациент создан. Сформируйте заказ: добавьте позиции и оцените стоимость.",
                  "Patient angelegt. Bilden Sie den Auftrag: Positionen hinzufügen und Kosten schätzen.",
                )}
              </div>
              {minor ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-800">
                    {tx(
                      "Пациент — несовершеннолетний. Укажите законного представителя.",
                      "Minderjährig — bitte gesetzlichen Vertreter angeben.",
                    )}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={tx("ФИО представителя", "Name des Vertreters")}>
                      <Input
                        value={guardian.name}
                        onChange={(event) =>
                          setGuardian((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </Field>
                    <Field label={tx("Телефон", "Telefon")}>
                      <Input
                        value={guardian.phone}
                        onChange={(event) =>
                          setGuardian((current) => ({ ...current, phone: event.target.value }))
                        }
                      />
                    </Field>
                  </div>
                </div>
              ) : null}
              <div className="space-y-3 rounded-lg border border-border/60 bg-background p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {tx("Клинический приём", "Klinische Aufnahme")}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Field label={tx("Текущая жалоба / Anamnese", "Aktuelle Beschwerden / Anamnese")}>
                    <textarea
                      className={textareaClass}
                      rows={2}
                      value={clinicalIntake.currentComplaint}
                      onChange={(event) =>
                        patchClinicalIntake({ currentComplaint: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Предыдущая история", "Vorgeschichte")}>
                    <textarea
                      className={textareaClass}
                      rows={2}
                      value={clinicalIntake.anamneseHistory}
                      onChange={(event) =>
                        patchClinicalIntake({ anamneseHistory: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={tx("Медикамент", "Medikament")}>
                    <Input
                      value={clinicalIntake.medicationName}
                      placeholder="Ibuprofen"
                      onChange={(event) =>
                        patchClinicalIntake({ medicationName: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Дозировка", "Stärke")}>
                    <Input
                      value={clinicalIntake.medicationStrength}
                      placeholder="400 mg"
                      onChange={(event) =>
                        patchClinicalIntake({ medicationStrength: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Форма", "Darreichungsform")}>
                    <Input
                      value={clinicalIntake.medicationForm}
                      placeholder="TABL"
                      onChange={(event) =>
                        patchClinicalIntake({ medicationForm: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Приём", "Einnahmeform")}>
                    <Input
                      value={clinicalIntake.medicationRoute}
                      placeholder="Oral"
                      onChange={(event) =>
                        patchClinicalIntake({ medicationRoute: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Схема", "Schema")}>
                    <Input
                      value={clinicalIntake.medicationDose}
                      placeholder="1-0-1"
                      onChange={(event) =>
                        patchClinicalIntake({ medicationDose: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Причина", "Grund")}>
                    <Input
                      value={clinicalIntake.medicationReason}
                      onChange={(event) =>
                        patchClinicalIntake({ medicationReason: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Указания", "Hinweise")}>
                    <Input
                      value={clinicalIntake.medicationNotes}
                      onChange={(event) =>
                        patchClinicalIntake({ medicationNotes: event.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={tx("Аллергия", "Allergie")}>
                    <Input
                      value={clinicalIntake.allergyLabel}
                      placeholder={tx("Пенициллин", "Penicillin")}
                      onChange={(event) =>
                        patchClinicalIntake({ allergyLabel: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Реакция", "Reaktion")}>
                    <Input
                      value={clinicalIntake.allergyReaction}
                      onChange={(event) =>
                        patchClinicalIntake({ allergyReaction: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Тяжесть", "Schweregrad")}>
                    <Input
                      value={clinicalIntake.allergySeverity}
                      onChange={(event) =>
                        patchClinicalIntake({ allergySeverity: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Примечание аллергии", "Allergie-Notiz")}>
                    <Input
                      value={clinicalIntake.allergyNotes}
                      onChange={(event) =>
                        patchClinicalIntake({ allergyNotes: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="CAVE">
                    <Input
                      value={clinicalIntake.caveLabel}
                      placeholder={tx("Антикоагуляция", "Antikoagulation")}
                      onChange={(event) =>
                        patchClinicalIntake({ caveLabel: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={tx("Примечание CAVE", "CAVE-Notiz")}>
                    <Input
                      value={clinicalIntake.caveNotes}
                      onChange={(event) =>
                        patchClinicalIntake({ caveNotes: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--brand)]"
                  checked={startContract}
                  onChange={(event) => setStartContract(event.target.checked)}
                />
                {tx(
                  "Начать рамочный договор (Rahmenvertrag)",
                  "Rahmenvertrag anlegen",
                )}
              </label>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background p-3">
                <span className="text-sm text-foreground">
                  {tx("Комплаенс-документы", "Compliance-Dokumente")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={!createdPatientId}
                  onClick={() => setGenDocOpen(true)}
                >
                  {tx("Сгенерировать документ", "Dokument generieren")}
                </Button>
              </div>
              <div className="space-y-3">
                {orderLines.map((line, index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
                  >
                    <Input
                      value={line.description}
                      placeholder={tx("Описание позиции", "Positionsbeschreibung")}
                      onChange={(event) => patchLine(index, { description: event.target.value })}
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label={tx("Кол-во", "Menge")}>
                        <Input
                          value={line.quantity}
                          inputMode="decimal"
                          onChange={(event) => patchLine(index, { quantity: event.target.value })}
                        />
                      </Field>
                      <Field label={tx("Цена", "Preis")}>
                        <Input
                          value={line.unitPrice}
                          inputMode="decimal"
                          onChange={(event) => patchLine(index, { unitPrice: event.target.value })}
                        />
                      </Field>
                      <Field label={tx("НДС %", "MwSt %")}>
                        <Input
                          value={line.vatRate}
                          inputMode="decimal"
                          onChange={(event) => patchLine(index, { vatRate: event.target.value })}
                        />
                      </Field>
                    </div>
                    {orderLines.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOrderLines((current) => current.filter((_, i) => i !== index))
                        }
                        className="text-xs text-muted-foreground hover:text-rose-600"
                      >
                        {tx("Удалить позицию", "Position entfernen")}
                      </button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOrderLines((current) => [...current, blankOrderLine()])}
                >
                  {tx("Добавить позицию", "Position hinzufügen")}
                </Button>
              </div>
              <div className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tx("Нетто", "Netto")}</span>
                  <span className="font-medium tabular-nums">{estimate.net.toFixed(2)} €</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{tx("НДС", "MwSt")}</span>
                  <span className="font-medium tabular-nums">{estimate.vat.toFixed(2)} €</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
                  <span>{tx("Итого (брутто)", "Gesamt (Brutto)")}</span>
                  <span className="tabular-nums">{estimate.gross.toFixed(2)} €</span>
                </div>
              </div>
              {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </div>
          ) : !draft ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {tx("Загрузка…", "Wird geladen…")}
            </div>
          ) : (
            <>
              {step === "identity" ? (
                <div className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={tx("Имя", "Vorname")} htmlFor="lw-first">
                      <Input
                        id="lw-first"
                        value={draft.firstName}
                        onChange={(event) => patch({ firstName: event.target.value })}
                      />
                    </Field>
                    <Field label={tx("Фамилия", "Nachname")} htmlFor="lw-last">
                      <Input
                        id="lw-last"
                        value={draft.lastName}
                        onChange={(event) => patch({ lastName: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={tx("Дата рождения", "Geburtsdatum")} htmlFor="lw-dob">
                      <Input
                        id="lw-dob"
                        type="date"
                        value={draft.dateOfBirth}
                        onChange={(event) => patch({ dateOfBirth: event.target.value })}
                      />
                    </Field>
                    <Field label={tx("Пол (юр.)", "Rechtl. Geschlecht")} htmlFor="lw-sex">
                      <NativeComboboxSelect
                        value={draft.legalSex || "__unset__"}
                        className={selectClass}
                        onChange={(event) =>
                          patch({
                            legalSex:
                              event.target.value && event.target.value !== "__unset__"
                                ? (event.target.value as LegalSex)
                                : "",
                          })
                        }
                      >
                        <option value="__unset__">{tx("Не указано", "Nicht gesetzt")}</option>
                        {LEGAL_SEX_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {legalSexLabel(option, tx)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={tx("E-mail", "E-Mail")} htmlFor="lw-email">
                      <Input
                        id="lw-email"
                        value={draft.email}
                        onChange={(event) => patch({ email: event.target.value })}
                      />
                    </Field>
                    <Field label={tx("Телефон", "Telefon")} htmlFor="lw-phone">
                      <Input
                        id="lw-phone"
                        value={draft.phone}
                        onChange={(event) => patch({ phone: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label={tx("Улица", "Straße")} htmlFor="lw-street">
                      <Input
                        id="lw-street"
                        value={draft.streetAddress}
                        onChange={(event) => patch({ streetAddress: event.target.value })}
                      />
                    </Field>
                    <Field label={tx("Город", "Stadt")} htmlFor="lw-city">
                      <Input
                        id="lw-city"
                        value={draft.city}
                        onChange={(event) => patch({ city: event.target.value })}
                      />
                    </Field>
                    <Field label={tx("Индекс", "PLZ")} htmlFor="lw-zip">
                      <Input
                        id="lw-zip"
                        value={draft.zipCode}
                        onChange={(event) => patch({ zipCode: event.target.value })}
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--brand)]"
                      checked={draft.needsInterpreter}
                      onChange={(event) => patch({ needsInterpreter: event.target.checked })}
                    />
                    {tx("Нужен переводчик", "Dolmetscher benötigt")}
                  </label>
                </div>
              ) : null}

              {step === "eligibility" ? (
                <div className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
                  <Field label={tx("Основная жалоба", "Hauptanliegen")} htmlFor="lw-concern">
                    <textarea
                      id="lw-concern"
                      className={textareaClass}
                      rows={4}
                      value={draft.primaryConcernText}
                      onChange={(event) => patch({ primaryConcernText: event.target.value })}
                    />
                  </Field>
                  <Field label={tx("Дополнительно", "Weitere Anliegen")} htmlFor="lw-additional">
                    <textarea
                      id="lw-additional"
                      className={textareaClass}
                      rows={3}
                      value={draft.additionalConcerns}
                      onChange={(event) => patch({ additionalConcerns: event.target.value })}
                    />
                  </Field>
                  <Field label={tx("Программа", "Programm")} htmlFor="lw-program">
                    <Input
                      id="lw-program"
                      value={draft.selectedProgram}
                      onChange={(event) => patch({ selectedProgram: event.target.value })}
                    />
                  </Field>
                  <Field label={tx("Услуги", "Leistungen")}>
                    <ChipEditor
                      items={draft.services}
                      placeholder={tx("Добавить услугу…", "Leistung hinzufügen…")}
                      onAdd={(value) => patch({ services: [...draft.services, value] })}
                      onRemove={(index) =>
                        patch({ services: draft.services.filter((_, i) => i !== index) })
                      }
                    />
                  </Field>
                </div>
              ) : null}

              {step === "specialties" ? (
                <div className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
                  <p className="text-sm text-muted-foreground">
                    {tx(
                      "Каких специалистов нужно привлечь (травматолог, ортопед…).",
                      "Welche Fachärzte werden benötigt (Traumatologe, Orthopäde…).",
                    )}
                  </p>
                  <Field label={tx("Специалисты", "Fachärzte")}>
                    <ChipEditor
                      items={draft.requestedSpecialties}
                      placeholder={tx("Добавить специальность…", "Fachrichtung hinzufügen…")}
                      onAdd={(value) =>
                        patch({ requestedSpecialties: [...draft.requestedSpecialties, value] })
                      }
                      onRemove={(index) =>
                        patch({
                          requestedSpecialties: draft.requestedSpecialties.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-border/70 bg-popover px-5 py-3">
          {phase === "order" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {tx("Черновик заказа создан", "Auftragsentwurf erstellt")}
              </span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void saveOrderDraft()}
                  disabled={busy}
                >
                  {tx("Сохранить черновик", "Entwurf speichern")}
                </Button>
                <Button
                  type="button"
                  variant="default"
                  className="h-auto min-h-8 w-full whitespace-normal text-center sm:w-auto"
                  onClick={handleFinishOrder}
                  disabled={busy || !canFinishOrder(minor, guardian) || !hasBillableLines}
                  title={
                    !canFinishOrder(minor, guardian)
                      ? tx(
                          "Для несовершеннолетнего нужен представитель",
                          "Für Minderjährige ist ein Vertreter erforderlich",
                        )
                      : !hasBillableLines
                        ? tx(
                            "Добавьте минимум одну позицию заказа",
                            "Mindestens eine Auftragsposition hinzufügen",
                          )
                        : undefined
                  }
                >
                  {tx("Завершить и открыть заказ", "Abschließen und Auftrag öffnen")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-center sm:w-auto"
                onClick={goBack}
                disabled={busy || !prevStep(step)}
              >
                <ChevronLeft className="size-4" />
                {tx("Назад", "Zurück")}
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {nextStep(step) ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={goNext}
                    disabled={busy || !draft}
                  >
                    {tx("Дальше", "Weiter")}
                    <ChevronRight className="size-4" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="default"
                  className="w-full sm:w-auto"
                  onClick={handleConvert}
                  disabled={busy || !draft || !canConvert(draft)}
                  title={
                    draft && !canConvert(draft)
                      ? tx(
                          "Нужны дата рождения, пол и контакт",
                          "Geburtsdatum, Geschlecht und Kontakt erforderlich",
                        )
                      : undefined
                  }
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <UserPlus className="size-4" />
                  )}
                  {tx("Создать пациента", "Patient anlegen")}
                </Button>
              </div>
            </div>
          )}
        </footer>
        </SheetContent>
      </Sheet>
      <PatientDocumentGenerateDialog
        open={genDocOpen}
        patientId={createdPatientId ?? undefined}
        patient={patientOption}
        onOpenChange={setGenDocOpen}
      />
    </>
  );
}
