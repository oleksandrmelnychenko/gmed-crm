import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import {
  appointmentElevatedSectionCardClassName,
  appointmentMetaPillClassName,
  appointmentMiniPillClassName,
  appointmentSoftPanelClassName,
  appointmentWhiteInputClassName,
  appointmentWhiteSelectControlClassName,
  appointmentWhiteTextareaControlClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import {
  blankConciergeServiceForm,
} from "@/pages/appointments/model/form-factories";
import {
  CONCIERGE_BILLING_STATUS_OPTIONS,
  CONCIERGE_SERVICE_KIND_OPTIONS,
  CONCIERGE_SERVICE_STATUS_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  appointmentText,
  billingStatusLabel,
  serviceKindLabel,
  taskStatusLabel,
} from "@/pages/appointments/model/labels";
import {
  formatAppointmentDateTimeLabel as formatDateTimeLabel,
  formatAppointmentMoneyLabel as formatMoneyLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  buildServiceDraft,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import type {
  AppointmentDetail,
  ConciergeServiceDraftState,
  ConciergeServiceEntry,
  ConciergeServiceFormState,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import {
  AppointmentSectionHeading,
  EmptyState,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentConciergeSectionProps = {
  detail: AppointmentDetail;
  services: ConciergeServiceEntry[];
  nonMedicalProviders: ProviderSummary[];
  conciergeStaff: StaffOption[];
  canManageConciergeServices: boolean;
  canManageConciergeBilling: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
};

const sectionCardClass = appointmentElevatedSectionCardClassName;
const selectClassName = appointmentWhiteSelectControlClassName;
const textareaClassName = appointmentWhiteTextareaControlClassName;

function AppointmentConciergeSection({
  detail,
  services,
  nonMedicalProviders,
  conciergeStaff,
  canManageConciergeServices,
  canManageConciergeBilling,
  onRefresh,
  onError,
}: AppointmentConciergeSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const buildCreateForm = useCallback(
    () =>
      blankConciergeServiceForm({
        providerId:
          detail.provider_id &&
          nonMedicalProviders.some((provider) => provider.id === detail.provider_id)
            ? detail.provider_id
            : "",
        assignedConciergeId:
          detail.owner_role === "concierge"
            ? (detail.owner_user_id ?? "")
            : (conciergeStaff[0]?.id ?? ""),
        serviceKind: detail.category?.toLowerCase().includes("transfer")
          ? "transfer"
          : "other",
        title: detail.title,
        startsAt: detail.time_start
          ? `${detail.date}T${detail.time_start.slice(0, 5)}`
          : "",
        endsAt: detail.time_end ? `${detail.date}T${detail.time_end.slice(0, 5)}` : "",
        currency: "EUR",
      }),
    [conciergeStaff, detail, nonMedicalProviders],
  );

  const [form, setForm] = useState<ConciergeServiceFormState>(() =>
    buildCreateForm(),
  );
  const [drafts, setDrafts] = useState<Record<string, ConciergeServiceDraftState>>(
    () =>
      Object.fromEntries(
        services.map((service) => [service.id, buildServiceDraft(service)]),
      ),
  );
  const [submitBusy, setSubmitBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    setForm(buildCreateForm());
    setDrafts(
      Object.fromEntries(
        services.map((service) => [service.id, buildServiceDraft(service)]),
      ),
    );
    setSubmitBusy(false);
    setActionBusy("");
  }, [buildCreateForm, services]);

  function updateDraft(
    serviceId: string,
    patch: Partial<ConciergeServiceDraftState>,
  ) {
    setDrafts((current) => {
      const existingDraft = current[serviceId];
      if (existingDraft) {
        return {
          ...current,
          [serviceId]: { ...existingDraft, ...patch },
        };
      }
      const service = services.find((item) => item.id === serviceId);
      if (!service) return current;
      return {
        ...current,
        [serviceId]: { ...buildServiceDraft(service), ...patch },
      };
    });
  }

  async function handleServiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitBusy(true);
    try {
      await apiFetch<ConciergeServiceEntry>("/concierge-services", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          appointment_id: detail.id,
          provider_id: form.providerId || null,
          assigned_concierge_id: form.assignedConciergeId || null,
          service_kind: form.serviceKind,
          title: form.title.trim(),
          vendor_name: form.vendorName.trim() || null,
          vendor_contact: form.vendorContact.trim() || null,
          starts_at: form.startsAt ? toRfc3339(form.startsAt) : null,
          ends_at: form.endsAt ? toRfc3339(form.endsAt) : null,
          cost_estimate: form.costEstimate ? Number(form.costEstimate) : null,
          currency: form.currency.trim().toUpperCase() || "EUR",
          service_notes: form.serviceNotes.trim() || null,
        }),
      });
      setForm(buildCreateForm());
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_create);
    } finally {
      setSubmitBusy(false);
    }
  }

  async function handleServiceSave(serviceId: string) {
    const draft = drafts[serviceId];
    if (!draft) return;
    setActionBusy(`service:${serviceId}`);
    try {
      const payload = canManageConciergeBilling
        ? {
            provider_id: draft.providerId || null,
            assigned_concierge_id: draft.assignedConciergeId || null,
            title: draft.title.trim(),
            status: draft.status,
            billing_status: draft.billingStatus,
            booking_reference: draft.bookingReference.trim() || null,
            vendor_name: draft.vendorName.trim() || null,
            vendor_contact: draft.vendorContact.trim() || null,
            starts_at: draft.startsAt ? toRfc3339(draft.startsAt) : null,
            ends_at: draft.endsAt ? toRfc3339(draft.endsAt) : null,
            actual_cost: draft.actualCost ? Number(draft.actualCost) : null,
            currency: draft.currency.trim().toUpperCase() || "EUR",
            service_notes: draft.serviceNotes.trim() || null,
            billing_notes: draft.billingNotes.trim() || null,
          }
        : {
            status: draft.status,
            booking_reference: draft.bookingReference.trim() || null,
            vendor_name: draft.vendorName.trim() || null,
            vendor_contact: draft.vendorContact.trim() || null,
            starts_at: draft.startsAt ? toRfc3339(draft.startsAt) : null,
            ends_at: draft.endsAt ? toRfc3339(draft.endsAt) : null,
            actual_cost: draft.actualCost ? Number(draft.actualCost) : null,
            service_notes: draft.serviceNotes.trim() || null,
          };
      await apiFetch<ConciergeServiceEntry>(`/concierge-services/${serviceId}/update`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : tr.common_failed_update);
    } finally {
      setActionBusy("");
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title="Concierge and VIP services"
          description="Travel, transfer and VIP execution linked to this appointment."
        />
        <span className={appointmentMetaPillClassName}>
          {services.length} service{services.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {services.length === 0 ? (
          <EmptyState text={tr.common_not_set} />
        ) : (
          services.map((service) => {
            const draft = drafts[service.id] ?? buildServiceDraft(service);
            return (
              <div
                key={service.id}
                className={appointmentSoftPanelClassName}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">
                          {service.title}
                        </p>
                        <span className={appointmentMiniPillClassName}>
                          {serviceKindLabel(service.service_kind)}
                        </span>
                        <span className={appointmentMiniPillClassName}>
                          {taskStatusLabel(service.status)}
                        </span>
                        <span className={appointmentMiniPillClassName}>
                          {billingStatusLabel(service.billing_status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {service.assigned_concierge_name || tr.common_not_set}
                        {service.provider_name ? ` · ${service.provider_name}` : ""}
                        {service.starts_at
                          ? ` · ${formatDateTimeLabel(service.starts_at)}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-xs text-slate-500 xl:text-right">
                      <div>
                        Estimate{" "}
                        {formatMoneyLabel(
                          service.cost_estimate,
                          draft.currency || service.currency,
                        )}
                      </div>
                      <div>
                        Actual{" "}
                        {formatMoneyLabel(
                          draft.actualCost || service.actual_cost,
                          draft.currency || service.currency,
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {canManageConciergeBilling ? (
                      <>
                        <Field label={t.appointments_title_col}>
                          <Input
                            value={draft.title}
                            onChange={(event) =>
                              updateDraft(service.id, { title: event.target.value })
                            }
                            className={appointmentWhiteInputClassName}
                          />
                        </Field>
                        <Field label={t.common_provider}>
                          <NativeComboboxSelect
                            value={draft.providerId}
                            onChange={(event) =>
                              updateDraft(service.id, {
                                providerId: event.target.value,
                              })
                            }
                            className={selectClassName}
                          >
                            <option value="">
                              {appointmentText(
                                "Kein Anbieter",
                                "Без провайдера",
                                "No provider",
                              )}
                            </option>
                            {nonMedicalProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={tr.role_concierge}>
                          <NativeComboboxSelect
                            value={draft.assignedConciergeId}
                            onChange={(event) =>
                              updateDraft(service.id, {
                                assignedConciergeId: event.target.value,
                              })
                            }
                            className={selectClassName}
                          >
                            <option value="">
                              {appointmentText(
                                "Ohne Concierge",
                                "Без concierge",
                                "No concierge",
                              )}
                            </option>
                            {conciergeStaff.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </Field>
                      </>
                    ) : null}
                    <Field label={tr.users_status}>
                      <NativeComboboxSelect
                        value={draft.status}
                        onChange={(event) =>
                          updateDraft(service.id, { status: event.target.value })
                        }
                        className={selectClassName}
                      >
                        {CONCIERGE_SERVICE_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {taskStatusLabel(status)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                    <Field label={tr.appointments_title_col}>
                      <Input
                        value={draft.bookingReference}
                        onChange={(event) =>
                          updateDraft(service.id, {
                            bookingReference: event.target.value,
                          })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    <Field label={tr.contracts_total}>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.actualCost}
                        onChange={(event) =>
                          updateDraft(service.id, { actualCost: event.target.value })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    <Field label={tr.common_provider}>
                      <Input
                        value={draft.vendorName}
                        onChange={(event) =>
                          updateDraft(service.id, { vendorName: event.target.value })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    <Field label={tr.field_phone}>
                      <Input
                        value={draft.vendorContact}
                        onChange={(event) =>
                          updateDraft(service.id, {
                            vendorContact: event.target.value,
                          })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    <Field label={tr.providers_service_valid_from}>
                      <Input
                        type="datetime-local"
                        value={draft.startsAt}
                        onChange={(event) =>
                          updateDraft(service.id, { startsAt: event.target.value })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    <Field label={tr.providers_service_valid_to}>
                      <Input
                        type="datetime-local"
                        value={draft.endsAt}
                        onChange={(event) =>
                          updateDraft(service.id, { endsAt: event.target.value })
                        }
                        className={appointmentWhiteInputClassName}
                      />
                    </Field>
                    {canManageConciergeBilling ? (
                      <>
                        <Field label={tr.users_status}>
                          <NativeComboboxSelect
                            value={draft.billingStatus}
                            onChange={(event) =>
                              updateDraft(service.id, {
                                billingStatus: event.target.value,
                              })
                            }
                            className={selectClassName}
                          >
                            {CONCIERGE_BILLING_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {billingStatusLabel(status)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={tr.contracts_total}>
                          <Input
                            value={draft.currency}
                            onChange={(event) =>
                              updateDraft(service.id, { currency: event.target.value })
                            }
                            className={appointmentWhiteInputClassName}
                            maxLength={3}
                          />
                        </Field>
                      </>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={tr.patients_notes}>
                      <textarea
                        value={draft.serviceNotes}
                        onChange={(event) =>
                          updateDraft(service.id, {
                            serviceNotes: event.target.value,
                          })
                        }
                        className={textareaClassName}
                        rows={3}
                      />
                    </Field>
                    {canManageConciergeBilling ? (
                      <Field label={tr.patients_notes}>
                        <textarea
                          value={draft.billingNotes}
                          onChange={(event) =>
                            updateDraft(service.id, {
                              billingNotes: event.target.value,
                            })
                          }
                          className={textareaClassName}
                          rows={3}
                        />
                      </Field>
                    ) : null}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      disabled={actionBusy === `service:${service.id}`}
                      onClick={() => handleServiceSave(service.id)}
                    >
                      {actionBusy === `service:${service.id}` ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : null}
                      Save service
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {canManageConciergeServices ? (
        <form onSubmit={handleServiceSubmit} className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label={tr.documents_category}>
            <NativeComboboxSelect
              value={form.serviceKind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  serviceKind: event.target.value,
                }))
              }
              className={selectClassName}
            >
              {CONCIERGE_SERVICE_KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {serviceKindLabel(kind)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.appointments_title_col}>
            <Input
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
              required
            />
          </Field>
          <Field label={t.common_provider}>
            <NativeComboboxSelect
              value={form.providerId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  providerId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">
                {appointmentText(
                  "Kein Anbieter",
                  "Без провайдера",
                  "No provider",
                )}
              </option>
              {nonMedicalProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.role_concierge}>
            <NativeComboboxSelect
              value={form.assignedConciergeId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedConciergeId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">
                {appointmentText(
                  "Ohne Concierge",
                  "Без concierge",
                  "No concierge",
                )}
              </option>
              {conciergeStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={tr.providers_service_valid_from}>
            <Input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startsAt: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
            />
          </Field>
          <Field label={tr.providers_service_valid_to}>
            <Input
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endsAt: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
            />
          </Field>
          <Field label={tr.common_provider}>
            <Input
              value={form.vendorName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  vendorName: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
            />
          </Field>
          <Field label={tr.field_phone}>
            <Input
              value={form.vendorContact}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  vendorContact: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
            />
          </Field>
          <Field label={tr.contracts_total}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.costEstimate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  costEstimate: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
            />
          </Field>
          <Field label={tr.contracts_total}>
            <Input
              value={form.currency}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  currency: event.target.value,
                }))
              }
              className={appointmentWhiteInputClassName}
              maxLength={3}
            />
          </Field>
          <Field label={tr.patients_notes}>
            <textarea
              value={form.serviceNotes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  serviceNotes: event.target.value,
                }))
              }
              className={textareaClassName}
              rows={3}
            />
          </Field>
          <div className="flex items-end justify-end md:col-span-2">
            <Button
              type="submit"
              disabled={submitBusy || !form.title.trim()}
            >
              {submitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Add service
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export const MemoizedAppointmentConciergeSection = memo(
  AppointmentConciergeSection,
);
