import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffLink } from "@/components/staff-link";
import { useLang } from "@/lib/i18n";
import { doctorSpecialtyLabel, type SpecializationLabelLang } from "@/pages/providers/model/specialization-labels";

import {
  type CaseOverviewForm,
  type CaseWorkspaceDetail,
  type CaseWorkspaceDoctor,
  useCaseWorkspace,
} from "./context";
import {
  Banner,
  Field,
  Panel,
  inputBaseClassName,
  nativeSelectClassName,
} from "./primitives";

function doctorOptionLabel(doctor: CaseWorkspaceDoctor, lang: SpecializationLabelLang) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialtyLabel = doctorSpecialtyLabel(doctor, lang);
  const specialty = specialtyLabel ? ` - ${specialtyLabel}` : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

function initialOverviewForm(
  detail: CaseWorkspaceDetail | null,
): CaseOverviewForm {
  if (!detail) {
    return {
      hauptanfragegrund: "",
      zuweiser_doctor_id: "",
      zuweiser: "",
    };
  }
  return {
    hauptanfragegrund: detail.hauptanfragegrund ?? "",
    zuweiser_doctor_id: detail.zuweiser_doctor_id ?? "",
    zuweiser: detail.zuweiser ?? "",
  };
}

export function OverviewSection() {
  const {
    detail,
    doctors,
    permissions,
    sectionBusy,
    sectionError,
    saveOverview,
  } = useCaseWorkspace();

  const revisionKey = detail?.updated_at ?? detail?.id ?? "empty";

  return (
    <div className="space-y-6">
      <CaseLinksPanel detail={detail} />
      <OverviewSectionForm
        key={revisionKey}
        detail={detail}
        doctors={doctors}
        canEdit={permissions.canEdit}
        busy={sectionBusy === "overview"}
        sectionError={sectionError}
        saveOverview={saveOverview}
      />
    </div>
  );
}

function CaseLinksPanel({ detail }: { detail: CaseWorkspaceDetail | null }) {
  const { t } = useLang();
  if (!detail) return null;

  const patientName = [detail.patient_last_name, detail.patient_first_name]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(", ");
  const patientLabel = [patientName, detail.patient_pid]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel title={t.cases_workspace_overview_links}>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-[11.5px] font-medium text-muted-foreground">
            {t.cases_workspace_overview_patient}
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {detail.patient_id ? (
              <StaffLink
                to={`/patients/${detail.patient_id}`}
                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
              >
                {patientLabel || detail.patient_id}
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </StaffLink>
            ) : (
              <span className="text-muted-foreground">{t.common_not_set}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11.5px] font-medium text-muted-foreground">
            {t.cases_workspace_overview_order}
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {detail.linked_order_id ? (
              <StaffLink
                to={`/orders/${detail.linked_order_id}`}
                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
              >
                {detail.linked_order_number ?? detail.linked_order_id}
                <ArrowUpRight className="size-3.5 text-muted-foreground" />
              </StaffLink>
            ) : (
              <span className="text-muted-foreground">{t.common_not_set}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11.5px] font-medium text-muted-foreground">
            {t.cases_workspace_overview_manager}
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {detail.manager_name?.trim() || (
              <span className="text-muted-foreground">{t.common_not_set}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11.5px] font-medium text-muted-foreground">
            {t.cases_workspace_overview_intake}
          </dt>
          <dd className="mt-1">
            <Badge
              variant="outline"
              className={
                detail.intake_completed_at
                  ? "rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "rounded-full border-amber-200 bg-amber-50 text-amber-700"
              }
            >
              {detail.intake_completed_at
                ? t.cases_workspace_overview_intake_done
                : t.cases_workspace_overview_intake_open}
            </Badge>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

type OverviewSectionFormProps = {
  detail: CaseWorkspaceDetail | null;
  doctors: CaseWorkspaceDoctor[];
  canEdit: boolean;
  busy: boolean;
  sectionError: string;
  saveOverview: (form: CaseOverviewForm) => Promise<boolean>;
};

function OverviewSectionForm({
  detail,
  doctors,
  canEdit,
  busy,
  sectionError,
  saveOverview,
}: OverviewSectionFormProps) {
  const { t, lang } = useLang();
  const [form, setForm] = useState<CaseOverviewForm>(() =>
    initialOverviewForm(detail),
  );

  function updateField<K extends keyof CaseOverviewForm>(
    field: K,
    value: CaseOverviewForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    await saveOverview(form);
  }

  return (
    <Panel title={t.cases_clinical_section_overview}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {sectionError ? <Banner tone="error">{sectionError}</Banner> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t.cases_workspace_overview_main_reason}
            required
          >
            <Input
              value={form.hauptanfragegrund}
              onChange={(event) => updateField("hauptanfragegrund", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit}
            />
          </Field>
          <Field label={t.cases_workspace_overview_referrer}>
            <NativeComboboxSelect
              value={form.zuweiser_doctor_id}
              onChange={(event) => {
                const doctorId = event.target.value;
                const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                setForm((current) => ({
                  ...current,
                  zuweiser_doctor_id: doctorId,
                  zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                }));
              }}
              className={nativeSelectClassName}
              disabled={!canEdit}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctorOptionLabel(doctor, lang)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field
            label={t.cases_workspace_overview_referrer_label}
          >
            <Input
              value={form.zuweiser}
              onChange={(event) => updateField("zuweiser", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t.cases_workspace_overview_save}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
