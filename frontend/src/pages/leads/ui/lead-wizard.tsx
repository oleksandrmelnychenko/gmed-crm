import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { selectClass, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { createOrder, createOrderLeistung } from "@/pages/orders/data/order-api";

import {
  fetchLeadDetail,
  updateLeadWizard,
  wizardConvertLead,
} from "../data/leads-api";
import {
  PHASE_A_STEPS,
  blankOrderLine,
  canConvert,
  costEstimate,
  draftFromLead,
  isMinor,
  nextStep,
  orderLineIsValid,
  orderLinePayload,
  orderNeedsDescription,
  prevStep,
  resumeStep,
  stepIsComplete,
  wizardUpdatePayload,
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
    <div className="space-y-1.5">
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
        <Button type="button" variant="outline" onClick={commit} disabled={!value.trim()}>
          +
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
                className="text-muted-foreground hover:text-foreground"
                aria-label="remove"
              >
                ×
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
  const [orderLines, setOrderLines] = useState<WizardOrderLine[]>([blankOrderLine()]);

  useEffect(() => {
    if (!open || !leadId) return;
    let active = true;
    setLoadError(false);
    setError("");
    setDraft(null);
    setPhase("lead");
    setCreatedOrderId(null);
    setCreatedPatientId(null);
    setOrderLines([blankOrderLine()]);
    fetchLeadDetail(leadId)
      .then((lead) => {
        if (!active) return;
        setDraft(draftFromLead(lead));
        setStep(resumeStep(lead));
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
      // Form the draft order — the goal of the wizard (#8) — carrying the
      // captured concern and requested specialists into needs_description.
      try {
        const order = await createOrder({
          patient_id: result.patient_id,
          needs_description: orderNeedsDescription(draft),
        });
        // Stay open and move into Phase B to build the order's line items.
        setCreatedOrderId(order.id);
        setPhase("order");
      } catch {
        // The patient exists even if the order draft failed; finish on the patient.
        onOpenChange(false);
        onConverted?.(result.patient_id);
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

  async function handleFinishOrder() {
    if (!createdOrderId) return;
    setBusy(true);
    setError("");
    const billable = orderLines.filter(orderLineIsValid);
    try {
      for (const line of billable) {
        await createOrderLeistung(createdOrderId, orderLinePayload(line));
      }
      const orderId = createdOrderId;
      onOpenChange(false);
      if (onOrderCreated) onOrderCreated(orderId);
      else if (createdPatientId) onConverted?.(createdPatientId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : tx("Не удалось сохранить позиции", "Positionen konnten nicht gespeichert werden"),
      );
    } finally {
      setBusy(false);
    }
  }

  const minor = draft ? isMinor(draft.dateOfBirth, new Date()) : false;
  const estimate = costEstimate(orderLines);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <header className="border-b border-border/60 pb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">
              {tx("Мастер обработки лида", "Lead-Assistent")}
            </h2>
            {minor ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                {tx("Ребёнок", "Minderjährig")}
              </Badge>
            ) : null}
          </div>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {PHASE_A_STEPS.map((phaseStep, index) => {
              const done = draft ? stepIsComplete(phaseStep, draft) : false;
              const active = phaseStep === step;
              return (
                <li key={phaseStep}>
                  <button
                    type="button"
                    onClick={() => setStep(phaseStep)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="tabular-nums">{index + 1}.</span> {stepLabel(phaseStep, tx)}
                    {done ? " ✓" : ""}
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        <div className="flex-1 space-y-4 py-4">
          {loadError ? (
            <p className="text-sm text-rose-600">
              {tx("Не удалось загрузить лид", "Lead konnte nicht geladen werden")}
            </p>
          ) : phase === "order" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                {tx(
                  "Пациент создан. Сформируйте заказ: добавьте позиции и оцените стоимость.",
                  "Patient angelegt. Bilden Sie den Auftrag: Positionen hinzufügen und Kosten schätzen.",
                )}
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
                    <div className="grid grid-cols-3 gap-2">
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
              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            </div>
          ) : !draft ? (
            <p className="text-sm text-muted-foreground">{tx("Загрузка…", "Wird geladen…")}</p>
          ) : (
            <>
              {step === "identity" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-3 gap-3">
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
                      checked={draft.needsInterpreter}
                      onChange={(event) => patch({ needsInterpreter: event.target.checked })}
                    />
                    {tx("Нужен переводчик", "Dolmetscher benötigt")}
                  </label>
                </div>
              ) : null}

              {step === "eligibility" ? (
                <div className="space-y-4">
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
                <div className="space-y-4">
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

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border/60 pt-4">
          {phase === "order" ? (
            <>
              <span className="text-xs text-muted-foreground">
                {tx("Черновик заказа создан", "Auftragsentwurf erstellt")}
              </span>
              <Button type="button" variant="default" onClick={handleFinishOrder} disabled={busy}>
                {tx("Завершить и открыть заказ", "Abschließen und Auftrag öffnen")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={goBack}
                disabled={busy || !prevStep(step)}
              >
                {tx("Назад", "Zurück")}
              </Button>
              <div className="flex items-center gap-2">
                {nextStep(step) ? (
                  <Button type="button" onClick={goNext} disabled={busy || !draft}>
                    {tx("Дальше", "Weiter")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="default"
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
                  {tx("Создать пациента", "Patient anlegen")}
                </Button>
              </div>
            </>
          )}
        </footer>
      </SheetContent>
    </Sheet>
  );
}
