import { useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  Field,
  Section,
  inputClass,
  selectClass,
  tokens,
} from "@/components/ui-shell";
import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  useLang,
  type Translations,
  type TranslationKey,
} from "@/lib/i18n";
import type {
  CreateOrderServiceGroupInput,
  OrderServiceGroup,
  OrderServiceGroupLinePreview,
  ServiceGroupParticipant,
  ServiceGroupParticipantInput,
} from "@/lib/api/clinical";

type ProviderOption = {
  id: string;
  name: string;
  address_city?: string | null;
};

type DoctorOption = {
  id: string;
  name: string;
  fachbereich?: string | null;
};

type OrderServiceGroupPanelProps = {
  group: Pick<
    OrderServiceGroup,
    "group_title" | "status" | "quantity" | "unit_price" | "currency" | "vat_rate"
  > & {
    participants: ServiceGroupParticipant[];
    generated_line_count?: number;
  };
  preview?: OrderServiceGroupLinePreview | null;
  generating?: boolean;
  error?: string;
  onGenerate?: (overrideDuplicates?: boolean) => void;
};

type WizardParticipant = {
  provider_id: string;
  doctor_id: string;
  role_label: string;
};

type WizardForm = {
  group_title: string;
  description: string;
  service_date: string;
  quantity: string;
  unit_price: string;
  currency: string;
  vat_rate: string;
  participants: WizardParticipant[];
};

type OrderServiceGroupWizardProps = {
  providers: ProviderOption[];
  providerDoctors: Record<string, DoctorOption[]>;
  creating?: boolean;
  error?: string | null;
  onLoadProviderDoctors?: (providerId: string) => void | Promise<void>;
  onCreate: (input: CreateOrderServiceGroupInput) => void | Promise<void>;
};

const blankParticipant: WizardParticipant = {
  provider_id: "",
  doctor_id: "",
  role_label: "",
};

const blankWizardForm: WizardForm = {
  group_title: "",
  description: "",
  service_date: "",
  quantity: "1",
  unit_price: "0",
  currency: "EUR",
  vat_rate: "19",
  participants: [{ ...blankParticipant }],
};

const SERVICE_GROUP_STATUS_LABEL_KEYS = {
  draft: "orders_service_group_status_draft",
  generated: "orders_service_group_status_generated",
  in_progress: "operations_status_in_progress",
  open: "orders_service_group_status_open",
  partially_generated: "orders_service_group_status_partially_generated",
  ready: "orders_service_group_status_ready",
} satisfies Partial<Record<string, TranslationKey>>;

const SERVICE_GROUP_LINE_ACTION_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  skip_duplicate: "orders_service_group_line_action_duplicate",
  generate: "orders_service_group_line_action_generate",
  update: "orders_service_group_line_action_update",
};

function formatCountMessage(template: string, count: number) {
  return template.replace(/\{count\}/g, String(count));
}

function serviceGroupStatusLabel(status: string, translations: Translations) {
  return formatEnumLabelFromKeys(status, SERVICE_GROUP_STATUS_LABEL_KEYS, translations);
}

function lineActionLabel(
  action: string,
  index: number,
  translations: Translations,
) {
  if (!action) {
    return `${translations.orders_service_group_line_action_line_prefix} ${index + 1}`;
  }
  return SERVICE_GROUP_LINE_ACTION_LABEL_KEYS[action]
    ? formatEnumLabelFromKeys(action, SERVICE_GROUP_LINE_ACTION_LABEL_KEYS, translations)
    : formatUnknownValue(action, translations);
}

export function OrderServiceGroupPanel({
  group,
  preview,
  generating = false,
  error,
  onGenerate,
}: OrderServiceGroupPanelProps) {
  const { t } = useLang();
  const [overrideDuplicates, setOverrideDuplicates] = useState(false);
  const previewCount = group.participants.length;
  const generatedLineCount = group.generated_line_count ?? 0;
  const duplicateCount = preview?.skip_duplicate_count ?? generatedLineCount;
  const generateCount = preview?.generate_count ?? Math.max(0, previewCount - generatedLineCount);

  return (
    <Section
      title={t.orders_service_group_split_title}
      accessory={<CountBadge>{previewCount} {t.orders_service_group_participants}</CountBadge>}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {group.group_title}
          </h3>
          <p className={tokens.text.muted}>
            {formatCountMessage(t.orders_service_group_summary, previewCount)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">
              {serviceGroupStatusLabel(group.status, t)}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {group.quantity} x {group.unit_price} {group.currency}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {t.orders_service_group_vat} {group.vat_rate}%
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {generatedLineCount} {t.orders_service_group_generated}
            </Badge>
            {duplicateCount > 0 ? (
              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                {duplicateCount} {t.orders_service_group_duplicate_safe}
              </Badge>
            ) : null}
          </div>
        </div>
        {onGenerate ? (
          <div className="flex flex-col items-start gap-2 md:items-end">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={overrideDuplicates}
                onChange={(event) => setOverrideDuplicates(event.target.checked)}
              />
              {t.orders_service_group_regenerate_existing}
            </label>
            <Button
              type="button"
              size="sm"
              className="rounded-lg"
              disabled={generating || previewCount === 0 || (!overrideDuplicates && generateCount === 0)}
              onClick={() => onGenerate(overrideDuplicates)}
            >
              {generating
                ? t.orders_service_group_generating
                : overrideDuplicates
                  ? t.orders_service_group_regenerate_lines
                  : t.orders_service_group_generate_new_lines}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      {preview ? (
        <div className="grid gap-3 md:grid-cols-3">
          <PreviewMetric label={t.orders_service_group_preview_generate_metric} value={preview.generate_count} />
          <PreviewMetric label={t.orders_service_group_preview_update_metric} value={preview.update_count} />
          <PreviewMetric label={t.orders_service_group_preview_skip_duplicates_metric} value={preview.skip_duplicate_count} />
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(preview?.lines ?? []).length > 0
          ? preview?.lines.map((line, index) => (
              <article
                key={line.participant_id}
                className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
              >
                <LineHeader
                  doctorName={line.doctor_name}
                  providerName={line.provider_name}
                  actionLabel={lineActionLabel(line.action, index, t)}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {line.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {line.quantity} x {line.unit_price} {line.currency} - {t.orders_service_group_vat} {line.vat_rate}%
                </p>
                {line.existing_leistung_id ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                    {t.orders_service_group_existing_line}: {line.existing_leistung_id}
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] text-muted-foreground">
                    {t.orders_service_group_preview_new_line_hint}
                  </p>
                )}
              </article>
            ))
          : group.participants.map((participant, index) => (
              <article
                key={participant.id ?? `${participant.doctor_id}:${index}`}
                className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
              >
                <LineHeader
                  doctorName={participant.doctor_name ?? participant.doctor_id}
                  providerName={participant.provider_name ?? participant.provider_id}
                  actionLabel={lineActionLabel(
                    participant.generated_leistung_id ? "skip_duplicate" : "generate",
                    index,
                    t,
                  )}
                />
                {participant.role_label ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {participant.role_label}
                  </p>
                ) : null}
                {participant.generated_leistung_id ? (
                  <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {t.orders_service_group_generated_line}: {participant.generated_leistung_id}
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] text-muted-foreground">
                    {t.orders_service_group_preview_participant_line_hint}
                  </p>
                )}
              </article>
            ))}
      </div>
    </Section>
  );
}

export function OrderServiceGroupWizard({
  providers,
  providerDoctors,
  creating = false,
  error,
  onLoadProviderDoctors,
  onCreate,
}: OrderServiceGroupWizardProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WizardForm>(blankWizardForm);
  const [localError, setLocalError] = useState("");
  const selectedDoctorCount = form.participants.filter(
    (item) => item.provider_id && item.doctor_id,
  ).length;

  const duplicateDoctorCount = useMemo(() => {
    const selected = form.participants
      .map((participant) => participant.doctor_id)
      .filter(Boolean);
    return selected.length - new Set(selected).size;
  }, [form.participants]);

  function updateParticipant(index: number, patch: Partial<WizardParticipant>) {
    setForm((current) => ({
      ...current,
      participants: current.participants.map((participant, participantIndex) =>
        participantIndex === index ? { ...participant, ...patch } : participant,
      ),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.group_title.trim();
    if (!title) {
      setLocalError(t.orders_service_group_wizard_title_required);
      return;
    }
    const participants = form.participants
      .filter((participant) => participant.provider_id && participant.doctor_id)
      .map<ServiceGroupParticipantInput>((participant) => ({
        provider_id: participant.provider_id,
        doctor_id: participant.doctor_id,
        role_label: participant.role_label.trim() || null,
      }));
    if (participants.length === 0) {
      setLocalError(t.orders_service_group_wizard_doctor_required);
      return;
    }
    if (duplicateDoctorCount > 0) {
      setLocalError(t.orders_service_group_wizard_duplicate_doctor);
      return;
    }

    setLocalError("");
    try {
      await onCreate({
        group_title: title,
        description: form.description.trim() || null,
        service_date: form.service_date || null,
        quantity: numberOrNull(form.quantity) ?? 1,
        unit_price: numberOrNull(form.unit_price) ?? 0,
        currency: form.currency.trim().toUpperCase() || "EUR",
        vat_rate: numberOrNull(form.vat_rate) ?? 19,
        participants,
      });
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : t.orders_service_group_failed_create,
      );
      return;
    }
    setForm(blankWizardForm);
    setOpen(false);
  }

  return (
    <Section
      title={t.orders_service_group_wizard_title}
      accessory={
        <Button
          type="button"
          size="sm"
          variant={open ? "outline" : "default"}
          className="rounded-lg"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? t.orders_service_group_wizard_close : t.orders_service_group_wizard_create}
        </Button>
      }
    >
      <p className={tokens.text.muted}>
        {t.orders_service_group_wizard_steps}
      </p>
      {!open ? null : (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          {(error || localError) ? (
            <Banner tone="error" withIcon>{error ?? localError}</Banner>
          ) : null}
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t.orders_service_group_title} className="md:col-span-2">
              <Input
                value={form.group_title}
                onChange={(event) => setForm({ ...form, group_title: event.target.value })}
                className={inputClass}
                placeholder={t.orders_service_group_title_placeholder}
              />
            </Field>
            <Field label={t.orders_service_group_service_date}>
              <Input
                type="date"
                value={form.service_date}
                onChange={(event) => setForm({ ...form, service_date: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={t.orders_service_group_currency}>
              <Input
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t.orders_service_group_quantity}>
              <Input
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={t.orders_service_group_unit_price}>
              <Input
                value={form.unit_price}
                onChange={(event) => setForm({ ...form, unit_price: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={t.orders_service_group_vat_percent}>
              <Input
                value={form.vat_rate}
                onChange={(event) => setForm({ ...form, vat_rate: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label={t.orders_service_group_description}>
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">{t.orders_service_group_doctors}</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    participants: [...current.participants, { ...blankParticipant }],
                  }))
                }
              >
                {t.orders_service_group_add_doctor}
              </Button>
            </div>
            {form.participants.map((participant, index) => {
              const doctors = participant.provider_id
                ? providerDoctors[participant.provider_id] ?? []
                : [];
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-xl border border-border/50 bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <Field label={t.orders_service_group_provider}>
                    <NativeComboboxSelect
                      value={participant.provider_id}
                      onChange={(event) => {
                        const providerId = event.target.value;
                        updateParticipant(index, {
                          provider_id: providerId,
                          doctor_id: "",
                        });
                        if (providerId) void onLoadProviderDoctors?.(providerId);
                      }}
                      className={selectClass}
                    >
                      <option value="">{t.orders_service_group_select_provider}</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={t.orders_service_group_doctor}>
                    <NativeComboboxSelect
                      value={participant.doctor_id}
                      onChange={(event) =>
                        updateParticipant(index, { doctor_id: event.target.value })
                      }
                      className={selectClass}
                      disabled={!participant.provider_id}
                    >
                      <option value="">{t.orders_service_group_select_doctor}</option>
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}{doctor.fachbereich ? ` - ${doctor.fachbereich}` : ""}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={t.orders_service_group_role_label}>
                    <Input
                      value={participant.role_label}
                      onChange={(event) =>
                        updateParticipant(index, { role_label: event.target.value })
                      }
                      className={inputClass}
                      placeholder={t.orders_service_group_role_placeholder}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      disabled={form.participants.length === 1}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          participants: current.participants.filter(
                            (_, participantIndex) => participantIndex !== index,
                          ),
                        }))
                      }
                    >
                      {t.orders_service_group_remove}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{t.orders_service_group_preview}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatCountMessage(t.orders_service_group_wizard_preview_summary, selectedDoctorCount)}
                </p>
              </div>
              <CountBadge>
                {duplicateDoctorCount > 0 ? t.orders_service_group_duplicates : t.orders_service_group_ready}
              </CountBadge>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" className="rounded-lg" disabled={creating}>
              {creating ? t.orders_service_group_creating : t.orders_service_group_save_preview}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function LineHeader({
  doctorName,
  providerName,
  actionLabel,
}: {
  doctorName: string;
  providerName: string;
  actionLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">
          {doctorName}
        </p>
        <p className="truncate text-xs text-muted-foreground">{providerName}</p>
      </div>
      <Badge variant="outline" className="rounded-full">
        {actionLabel}
      </Badge>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function numberOrNull(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
