import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import type { ColumnDef } from "@/components/data-table/types";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type PainItem, useCaseWorkspace } from "./context";
import { Field, Panel, inputBaseClassName } from "./primitives";

function parseNrs(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nrsToString(value: number | null | undefined) {
  if (value == null) return "";
  return String(value);
}

const BLANK: PainItem = {
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

export function PainSection() {
  const { t } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    savePain,
  } = useCaseWorkspace();

  const columns = useMemo<ColumnDef<PainItem>[]>(
    () => [
      {
        id: "lokalisierung",
        label: t.cases_pain_location,
        accessor: (item) => item.lokalisierung,
        filterType: "text",
        searchable: true,
        sortable: true,
        required: true,
        width: 260,
        render: (item) => (
          <span className="block max-w-[260px] truncate text-xs font-medium text-foreground">
            {item.lokalisierung || t.cases_pain_no_location}
          </span>
        ),
      },
      {
        id: "nrs_aktuell",
        label: t.cases_pain_nrs_current,
        accessor: (item) => item.nrs_aktuell ?? "",
        sortable: true,
        width: 110,
        render: (item) =>
          item.nrs_aktuell != null ? (
            <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-[10px] font-medium text-rose-700">
              {t.uiText.cases_pain_nrs_label} {item.nrs_aktuell}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "seit_wann",
        label: t.cases_pain_since_when,
        accessor: (item) => item.seit_wann ?? "",
        filterType: "text",
        sortable: true,
        width: 150,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.seit_wann?.trim() || "—"}
          </span>
        ),
      },
      {
        id: "qualitaet",
        label: t.cases_pain_quality,
        accessor: (item) => item.qualitaet ?? "",
        filterType: "text",
        width: 180,
        render: (item) =>
          item.qualitaet?.trim() ? (
            <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
              {item.qualitaet}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "ursache",
        label: t.cases_pain_cause,
        accessor: (item) => item.ursache ?? "",
        filterType: "text",
        searchable: true,
        width: 320,
        render: (item) => (
          <span className="block max-w-[320px] truncate text-xs text-foreground">
            {item.ursache?.trim() || "—"}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <CaseItemList<PainItem>
      columns={columns}
      title={t.cases_pain_title}
      description={t.cases_pain_description}
      items={detail?.pain_records ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({ ...BLANK, ...item })}
      isValid={(form) => form.lokalisierung.trim().length > 0}
      save={savePain}
      busy={sectionBusy === "pain"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: t.cases_pain_sheet_create,
        edit: t.cases_pain_sheet_edit,
      }}
      sheetWidth="wide"
      emptyTitle={t.cases_pain_empty_title}
      addFirstLabel={t.cases_pain_add_first}
      missingPrimaryMessage={t.cases_pain_missing_location}
      formContent={({ form, updateField, disabled }) => (
        <>
          <Panel title={t.cases_pain_group_location_timing}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_location}>
                <Input
                  value={form.lokalisierung}
                  onChange={(event) => updateField("lokalisierung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_since_when}>
                <Input
                  value={form.seit_wann ?? ""}
                  onChange={(event) => updateField("seit_wann", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_characteristics}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_cause}>
                <Input
                  value={form.ursache ?? ""}
                  onChange={(event) => updateField("ursache", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_quality}>
                <Input
                  value={form.qualitaet ?? ""}
                  onChange={(event) => updateField("qualitaet", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_continuity}>
                <Input
                  value={form.kontinuitaet ?? ""}
                  onChange={(event) => updateField("kontinuitaet", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_evolution}>
                <Input
                  value={form.entwicklung ?? ""}
                  onChange={(event) => updateField("entwicklung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_intensity}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_nrs_current}>
                <Input
                  value={nrsToString(form.nrs_aktuell)}
                  onChange={(event) => updateField("nrs_aktuell", parseNrs(event.target.value))}
                  className={inputBaseClassName}
                  disabled={disabled}
                  inputMode="numeric"
                />
              </Field>
              <Field label={t.cases_pain_nrs_initial}>
                <Input
                  value={nrsToString(form.nrs_anfang)}
                  onChange={(event) => updateField("nrs_anfang", parseNrs(event.target.value))}
                  className={inputBaseClassName}
                  disabled={disabled}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_course}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_initial_duration}>
                <Input
                  value={form.dauer_anfang ?? ""}
                  onChange={(event) => updateField("dauer_anfang", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_current_duration}>
                <Input
                  value={form.dauer_aktuell ?? ""}
                  onChange={(event) => updateField("dauer_aktuell", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_radiation}>
                <Input
                  value={form.ausstrahlung ?? ""}
                  onChange={(event) => updateField("ausstrahlung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_triggers}>
                <Input
                  value={form.auftreten ?? ""}
                  onChange={(event) => updateField("auftreten", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>
        </>
      )}
    />
  );
}
