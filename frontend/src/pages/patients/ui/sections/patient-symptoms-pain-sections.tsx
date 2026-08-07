import { useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import type { ColumnDef } from "@/components/data-table/types";
import { t as translateCatalog, useLang } from "@/lib/i18n";
import {
  fetchPatientPain,
  fetchPatientSymptoms,
  savePatientPain,
  savePatientSymptoms,
  type PatientPainItem,
  type PatientSymptomItem,
} from "@/pages/patients/data/patient-symptoms-pain";
import { CaseItemList } from "@/pages/case-workspace/case-item-list";
import { Field, Panel, inputBaseClassName } from "@/pages/case-workspace/primitives";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function normalizePatientPainNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nrsToString(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

const BLANK_SYMPTOM: PatientSymptomItem = { beschreibung: "", fachrichtung: "" };
const BLANK_PAIN: PatientPainItem = {
  lokalisierung: "",
  seit_wann: "",
  ursache: "",
  qualitaet: "",
  kontinuitaet: "",
  entwicklung: "",
  nrs_aktuell: null,
  nrs_anfang: null,
  dauer_anfang: "",
  dauer_aktuell: "",
  ausstrahlung: "",
  auftreten: "",
};

export function PatientSymptomsPainSections({
  patientId,
  canManage,
  refreshKey = 0,
}: {
  patientId: string;
  canManage: boolean;
  refreshKey?: number;
}) {
  const { lang, t } = useLang();
  const [symptoms, setSymptoms] = useState<PatientSymptomItem[]>([]);
  const [pain, setPain] = useState<PatientPainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"symptoms" | "pain" | null>(null);
  const [symptomError, setSymptomError] = useState("");
  const [painError, setPainError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([fetchPatientSymptoms(patientId), fetchPatientPain(patientId)])
      .then(([symptomResult, painResult]) => {
        if (!active) return;
        if (symptomResult.status === "fulfilled") {
          setSymptoms(symptomResult.value);
          setSymptomError("");
        } else {
          setSymptomError(String(symptomResult.reason));
        }
        if (painResult.status === "fulfilled") {
          setPain(painResult.value);
          setPainError("");
        } else {
          setPainError(String(painResult.reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId, refreshKey]);

  const saveSymptoms = useCallback(async (next: PatientSymptomItem[]) => {
    setBusy("symptoms");
    setSymptomError("");
    try {
      const sanitized = next.flatMap((item) => {
        const beschreibung = item.beschreibung.trim();
        return beschreibung
          ? [{ beschreibung, fachrichtung: optionalText(item.fachrichtung) }]
          : [];
      });
      await savePatientSymptoms(patientId, sanitized);
      setSymptoms(await fetchPatientSymptoms(patientId));
      return true;
    } catch (error) {
      setSymptomError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [patientId]);

  const savePain = useCallback(async (next: PatientPainItem[]) => {
    setBusy("pain");
    setPainError("");
    try {
      const sanitized = next.flatMap((item) => {
        const lokalisierung = item.lokalisierung.trim();
        return lokalisierung
          ? [{
              lokalisierung,
              seit_wann: optionalText(item.seit_wann),
              ursache: optionalText(item.ursache),
              qualitaet: optionalText(item.qualitaet),
              kontinuitaet: optionalText(item.kontinuitaet),
              entwicklung: optionalText(item.entwicklung),
              nrs_aktuell: normalizePatientPainNumber(item.nrs_aktuell),
              nrs_anfang: normalizePatientPainNumber(item.nrs_anfang),
              dauer_anfang: optionalText(item.dauer_anfang),
              dauer_aktuell: optionalText(item.dauer_aktuell),
              ausstrahlung: optionalText(item.ausstrahlung),
              auftreten: optionalText(item.auftreten),
            }]
          : [];
      });
      await savePatientPain(patientId, sanitized);
      setPain(await fetchPatientPain(patientId));
      return true;
    } catch (error) {
      setPainError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [patientId]);

  const symptomColumns = useMemo<ColumnDef<PatientSymptomItem>[]>(() => [
    {
      id: "beschreibung",
      label: tri(lang, "case_ws_description"),
      accessor: (item) => item.beschreibung,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      width: 420,
      render: (item) => (
        <span className="block max-w-[420px] truncate text-xs font-medium text-foreground">
          {item.beschreibung || tri(lang, "case_ws_untitled_3")}
        </span>
      ),
    },
    {
      id: "fachrichtung",
      label: tri(lang, "case_ws_specialty"),
      accessor: (item) => item.fachrichtung ?? "",
      filterType: "enum",
      filterOptions: () => Array.from(new Set(
        symptoms.map((item) => item.fachrichtung?.trim()).filter((value): value is string => Boolean(value)),
      )).map((value) => ({ value, label: value })),
      sortable: true,
      width: 240,
      render: (item) => item.fachrichtung?.trim() ? (
        <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
          {item.fachrichtung}
        </span>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
  ], [lang, symptoms]);

  const painColumns = useMemo<ColumnDef<PatientPainItem>[]>(() => [
    {
      id: "lokalisierung",
      label: t.cases_pain_location,
      accessor: (item) => item.lokalisierung,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      width: 260,
      render: (item) => <span className="block max-w-[260px] truncate text-xs font-medium text-foreground">
        {item.lokalisierung || t.cases_pain_no_location}
      </span>,
    },
    {
      id: "nrs_aktuell",
      label: t.cases_pain_nrs_current,
      accessor: (item) => item.nrs_aktuell ?? "",
      sortable: true,
      width: 110,
      render: (item) => item.nrs_aktuell != null ? (
        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10px] font-medium text-rose-700">
          {t.uiText.cases_pain_nrs_label} {item.nrs_aktuell}
        </span>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: "seit_wann",
      label: t.cases_pain_since_when,
      accessor: (item) => item.seit_wann ?? "",
      filterType: "text",
      sortable: true,
      width: 150,
      render: (item) => <span className="block truncate font-mono text-xs text-foreground">
        {item.seit_wann?.trim() || "—"}
      </span>,
    },
    {
      id: "qualitaet",
      label: t.cases_pain_quality,
      accessor: (item) => item.qualitaet ?? "",
      filterType: "text",
      width: 180,
      render: (item) => item.qualitaet?.trim() ? (
        <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
          {item.qualitaet}
        </span>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      id: "ursache",
      label: t.cases_pain_cause,
      accessor: (item) => item.ursache ?? "",
      filterType: "text",
      searchable: true,
      width: 320,
      render: (item) => <span className="block max-w-[320px] truncate text-xs text-foreground">
        {item.ursache?.trim() || "—"}
      </span>,
    },
  ], [t]);

  return (
    <>
      <CaseItemList<PatientSymptomItem>
        columns={symptomColumns}
        title={tri(lang, "case_ws_symptoms")}
        description={tri(lang, "case_ws_clinical_complaints_and_related_specialty")}
        items={symptoms}
        blankItem={BLANK_SYMPTOM}
        cloneItem={(item) => ({ ...item })}
        isValid={(form) => form.beschreibung.trim().length > 0}
        save={saveSymptoms}
        busy={loading || busy === "symptoms"}
        sectionError={symptomError}
        canEdit={canManage}
        sheetTitle={{ create: tri(lang, "case_ws_new_symptom"), edit: tri(lang, "case_ws_edit_symptom") }}
        emptyTitle={tri(lang, "case_ws_no_symptoms_recorded_yet")}
        addFirstLabel={tri(lang, "case_ws_add_first_entry_3")}
        missingPrimaryMessage={tri(lang, "case_ws_please_enter_a_description")}
        formContent={({ form, updateField, disabled }) => (
          <Panel title={tri(lang, "case_ws_symptoms")}>
            <Field label={tri(lang, "case_ws_description")} required>
              <Input value={form.beschreibung} onChange={(event) => updateField("beschreibung", event.target.value)} className={inputBaseClassName} disabled={disabled} />
            </Field>
            <Field label={tri(lang, "case_ws_specialty")}>
              <Input value={form.fachrichtung ?? ""} onChange={(event) => updateField("fachrichtung", event.target.value)} className={inputBaseClassName} disabled={disabled} />
            </Field>
          </Panel>
        )}
      />

      <CaseItemList<PatientPainItem>
        columns={painColumns}
        title={t.cases_pain_title}
        description={t.cases_pain_description}
        items={pain}
        blankItem={BLANK_PAIN}
        cloneItem={(item) => ({ ...BLANK_PAIN, ...item })}
        isValid={(form) => form.lokalisierung.trim().length > 0}
        save={savePain}
        busy={loading || busy === "pain"}
        sectionError={painError}
        canEdit={canManage}
        sheetTitle={{ create: t.cases_pain_sheet_create, edit: t.cases_pain_sheet_edit }}
        sheetWidth="wide"
        emptyTitle={t.cases_pain_empty_title}
        addFirstLabel={t.cases_pain_add_first}
        missingPrimaryMessage={t.cases_pain_missing_location}
        formContent={({ form, updateField, disabled }) => (
          <>
            <Panel title={t.cases_pain_group_location_timing}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_location}><Input value={form.lokalisierung} onChange={(event) => updateField("lokalisierung", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
                <Field label={t.cases_pain_since_when}><Input value={form.seit_wann ?? ""} onChange={(event) => updateField("seit_wann", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
              </div>
            </Panel>
            <Panel title={t.cases_pain_group_characteristics}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_cause}><Input value={form.ursache ?? ""} onChange={(event) => updateField("ursache", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
                <Field label={t.cases_pain_quality}><Input value={form.qualitaet ?? ""} onChange={(event) => updateField("qualitaet", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_continuity}><Input value={form.kontinuitaet ?? ""} onChange={(event) => updateField("kontinuitaet", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
                <Field label={t.cases_pain_evolution}><Input value={form.entwicklung ?? ""} onChange={(event) => updateField("entwicklung", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
              </div>
            </Panel>
            <Panel title={t.cases_pain_group_intensity}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_nrs_current}><Input value={nrsToString(form.nrs_aktuell)} onChange={(event) => updateField("nrs_aktuell", normalizePatientPainNumber(event.target.value))} className={inputBaseClassName} disabled={disabled} inputMode="numeric" /></Field>
                <Field label={t.cases_pain_nrs_initial}><Input value={nrsToString(form.nrs_anfang)} onChange={(event) => updateField("nrs_anfang", normalizePatientPainNumber(event.target.value))} className={inputBaseClassName} disabled={disabled} inputMode="numeric" /></Field>
              </div>
            </Panel>
            <Panel title={t.cases_pain_group_course}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_initial_duration}><Input value={form.dauer_anfang ?? ""} onChange={(event) => updateField("dauer_anfang", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
                <Field label={t.cases_pain_current_duration}><Input value={form.dauer_aktuell ?? ""} onChange={(event) => updateField("dauer_aktuell", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.cases_pain_radiation}><Input value={form.ausstrahlung ?? ""} onChange={(event) => updateField("ausstrahlung", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
                <Field label={t.cases_pain_triggers}><Input value={form.auftreten ?? ""} onChange={(event) => updateField("auftreten", event.target.value)} className={inputBaseClassName} disabled={disabled} /></Field>
              </div>
            </Panel>
          </>
        )}
      />
    </>
  );
}
