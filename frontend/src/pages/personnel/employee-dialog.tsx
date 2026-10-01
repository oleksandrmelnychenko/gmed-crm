import { useEffect, useMemo, useState } from "react";

import { AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
import { Field, textareaClass } from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";

import { personnelApi, type PersonnelEmployee, type PersonnelLinkableUser } from "./api";
import {
  EMPTY_EMPLOYEE_FORM,
  employeeFormOf,
  employeeRequestBody,
  employmentRangeValid,
  type EmployeeForm,
} from "./model";
import { FormSection, errorMessage } from "./personnel-ui";

/** Creates a personnel file or edits its master data (never its documents), in a right sheet. */
export function EmployeeDialog({
  open,
  employee,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Absent: create a new personnel file. */
  employee?: PersonnelEmployee | null;
  onClose: () => void;
  onSaved: (employee: PersonnelEmployee) => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string | undefined>;
  const original = useMemo(() => (employee ? employeeFormOf(employee) : undefined), [employee]);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_EMPLOYEE_FORM);
  const [users, setUsers] = useState<PersonnelLinkableUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(original ?? EMPTY_EMPLOYEE_FORM);
    setError("");
    let cancelled = false;
    personnelApi
      .linkableUsers()
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, original]);

  const update = <K extends keyof EmployeeForm>(key: K, value: EmployeeForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const userOptions = useMemo(() => {
    const options = [
      { value: "", label: t.personnel_no_user_link },
      ...users.map((user) => ({
        value: user.id,
        label: `${user.name} · ${user.email}${tr[`role_${user.role}`] ? ` · ${tr[`role_${user.role}`]}` : ""}`,
      })),
    ];
    // The currently linked user is not "linkable" any more; keep it selectable.
    if (employee?.user_id && !users.some((user) => user.id === employee.user_id)) {
      options.splice(1, 0, { value: employee.user_id, label: employee.user_name ?? employee.user_id });
    }
    return options;
  }, [employee, t.personnel_no_user_link, tr, users]);

  const body = employeeRequestBody(form, original);
  const changed = Object.keys(body).length > 0;
  const rangeValid = employmentRangeValid(form);
  const valid = Boolean(form.first_name.trim() && form.last_name.trim()) && rangeValid;

  const submit = async () => {
    if (!valid || !changed) return;
    setBusy(true);
    setError("");
    try {
      const saved = employee
        ? await personnelApi.updateEmployee(employee.id, body)
        : await personnelApi.createEmployee(body);
      onSaved(saved);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, employee ? t.common_failed_update : t.common_failed_create));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)} dirty={changed}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
        {open ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <AdminSheetScaffold
              title={employee ? t.personnel_employee_edit : t.personnel_employee_new}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={employee ? t.common_save : t.common_create}
                  submitting={busy}
                  submitDisabled={!valid || !changed}
                  error={error || undefined}
                  onCancel={onClose}
                />
              }
            >
              <FormSection title={t.personnel_section_person} hint={t.personnel_employee_dialog_hint}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.personnel_salutation}>
                    <SelectField
                      value={form.salutation}
                      aria-label={t.personnel_salutation}
                      onValueChange={(value) => update("salutation", value as EmployeeForm["salutation"])}
                      options={[
                        { value: "frau", label: t.personnel_salutation_frau },
                        { value: "herr", label: t.personnel_salutation_herr },
                        { value: "none", label: t.personnel_salutation_none },
                      ]}
                    />
                  </Field>
                  <div className="hidden sm:block" />
                  <Field label={t.personnel_first_name} htmlFor="personnel-first-name" required>
                    <Input
                      id="personnel-first-name"
                      value={form.first_name}
                      maxLength={100}
                      onChange={(event) => update("first_name", event.target.value)}
                    />
                  </Field>
                  <Field label={t.personnel_last_name} htmlFor="personnel-last-name" required>
                    <Input
                      id="personnel-last-name"
                      value={form.last_name}
                      maxLength={100}
                      onChange={(event) => update("last_name", event.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">{t.personnel_name_file_hint}</p>
              </FormSection>
              <FormSection title={t.personnel_section_employment}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t.personnel_number} htmlFor="personnel-number">
                    <Input
                      id="personnel-number"
                      value={form.personnel_number}
                      maxLength={40}
                      onChange={(event) => update("personnel_number", event.target.value)}
                    />
                  </Field>
                  <Field label={t.personnel_employment_start} htmlFor="personnel-employment-start">
                    <Input
                      id="personnel-employment-start"
                      type="date"
                      value={form.employment_start}
                      onChange={(event) => update("employment_start", event.target.value)}
                    />
                  </Field>
                  <Field label={t.personnel_employment_end} htmlFor="personnel-employment-end">
                    <Input
                      id="personnel-employment-end"
                      type="date"
                      value={form.employment_end}
                      aria-invalid={!rangeValid}
                      onChange={(event) => update("employment_end", event.target.value)}
                    />
                  </Field>
                </div>
                {!rangeValid ? (
                  <p className="text-xs text-destructive">{t.personnel_employment_range_invalid}</p>
                ) : null}
              </FormSection>
              <FormSection title={t.personnel_user_link} hint={t.personnel_user_link_hint}>
                <SelectField
                  value={form.user_id}
                  aria-label={t.personnel_user_link}
                  onValueChange={(value) => update("user_id", value)}
                  options={userOptions}
                />
              </FormSection>
              <FormSection title={t.personnel_notes}>
                <textarea
                  id="personnel-notes"
                  aria-label={t.personnel_notes}
                  className={textareaClass}
                  value={form.notes}
                  maxLength={4000}
                  onChange={(event) => update("notes", event.target.value)}
                />
              </FormSection>
            </AdminSheetScaffold>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
