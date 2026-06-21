import { useMemo, useState, type FormEvent } from "react";

import type { Dispatch, ReactNode, SetStateAction } from "react";

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
import { doctorSpecialtyLabel } from "@/pages/providers/model/specialization-labels";
import type { ProviderTaxonomyNode, SpecializationItem } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
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
  provider_type?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_path?: Array<{ id?: string | null }>;
};

type DoctorOption = {
  id: string;
  name: string;
  fachbereich?: string | null;
  specializations?: SpecializationItem[];
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
  clientKey: string;
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
  taxonomyNodes: ProviderTaxonomyNode[];
  providerDoctors: Record<string, DoctorOption[]>;
  creating?: boolean;
  error?: string | null;
  embedded?: boolean;
  onLoadProviderDoctors?: (providerId: string) => void | Promise<void>;
  onCreate: (input: CreateOrderServiceGroupInput) => void | Promise<void>;
  onCreated?: () => void;
};

type WizardFormSetter = Dispatch<SetStateAction<WizardForm>>;

type UpdateWizardParticipant = (
  index: number,
  patch: Partial<WizardParticipant>,
) => void;

let wizardParticipantSequence = 0;

function createBlankParticipant(): WizardParticipant {
  wizardParticipantSequence += 1;
  return {
    clientKey: `participant-${wizardParticipantSequence}`,
    provider_id: "",
    doctor_id: "",
    role_label: "",
  };
}

function createBlankWizardForm(): WizardForm {
  return {
    group_title: "",
    description: "",
    service_date: "",
    quantity: "1",
    unit_price: "0",
    currency: "EUR",
    vat_rate: "19",
    participants: [createBlankParticipant()],
  };
}

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
  const previewLines = preview?.lines ?? [];

  return (
    <article className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full break-words text-base font-semibold text-foreground">
              {group.group_title || t.orders_service_group_split_title}
            </h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCountMessage(t.orders_service_group_summary, previewCount)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Badge variant="outline" className="rounded-full bg-background">
            {serviceGroupStatusLabel(group.status, t)}
          </Badge>
          {duplicateCount > 0 ? (
            <Badge
              variant="outline"
              className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
            >
              {duplicateCount} {t.orders_service_group_duplicate_safe}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-x-8 gap-y-1">
        <PanelSummaryLine
          label={t.orders_service_group_quantity}
          value={`${group.quantity} x ${group.unit_price} ${group.currency}`}
        />
        <PanelSummaryLine
          label={t.orders_service_group_vat}
          value={`${group.vat_rate}%`}
        />
        <PanelSummaryLine
          label={t.orders_service_group_participants}
          value={previewCount}
        />
        <PanelSummaryLine
          label={t.orders_service_group_generated}
          value={generatedLineCount}
        />
        {preview ? (
          <>
            <PanelSummaryLine
              label={t.orders_service_group_preview_generate_metric}
              value={preview.generate_count}
            />
            <PanelSummaryLine
              label={t.orders_service_group_preview_update_metric}
              value={preview.update_count}
            />
            <PanelSummaryLine
              label={t.orders_service_group_preview_skip_duplicates_metric}
              value={preview.skip_duplicate_count}
            />
          </>
        ) : null}
      </div>

      {onGenerate ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
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
            className="h-auto min-h-7 w-full whitespace-normal rounded-lg text-center 2xl:w-auto"
            disabled={
              generating ||
              previewCount === 0 ||
              (!overrideDuplicates && generateCount === 0)
            }
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

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      <div className="mt-4 space-y-2.5">
        {previewLines.length > 0
          ? previewLines.map((line, index) => (
              <ServiceGroupLineRow
                key={line.participant_id}
                doctorName={line.doctor_name}
                providerName={line.provider_name}
                actionLabel={lineActionLabel(line.action, index, t)}
                detail={line.description}
                amount={`${line.quantity} x ${line.unit_price} ${line.currency} - ${t.orders_service_group_vat} ${line.vat_rate}%`}
                noticeLabel={
                  line.existing_leistung_id
                    ? t.orders_service_group_existing_line
                    : t.orders_service_group_preview_new_line_hint
                }
                noticeValue={line.existing_leistung_id ?? undefined}
                noticeTone={line.existing_leistung_id ? "amber" : "muted"}
              />
            ))
          : group.participants.map((participant, index) => (
              <ServiceGroupLineRow
                key={participant.id ?? `${participant.doctor_id}:${index}`}
                doctorName={participant.doctor_name ?? participant.doctor_id}
                providerName={participant.provider_name ?? participant.provider_id}
                actionLabel={lineActionLabel(
                  participant.generated_leistung_id ? "skip_duplicate" : "generate",
                  index,
                  t,
                )}
                detail={participant.role_label || t.orders_service_group_preview_participant_line_hint}
                amount={`${group.quantity} x ${group.unit_price} ${group.currency} - ${t.orders_service_group_vat} ${group.vat_rate}%`}
                noticeLabel={
                  participant.generated_leistung_id
                    ? t.orders_service_group_generated_line
                    : t.orders_service_group_preview_participant_line_hint
                }
                noticeValue={participant.generated_leistung_id ?? undefined}
                noticeTone={participant.generated_leistung_id ? "emerald" : "muted"}
              />
            ))}
      </div>
    </article>
  );
}

function PanelSummaryLine({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg py-2">
      <span className="min-w-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-4 flex-1 bg-border/70" />
      <span className="min-w-0 max-w-[50%] break-words text-right text-sm font-semibold leading-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function SheetSectionCard({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
          {description ? <p className={tokens.text.muted}>{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{title}</span>
    </span>
  );
}

function uiTextLabel(translations: Translations, key: string) {
  return translations.uiText[key] ?? key;
}

export function OrderServiceGroupWizard({
  providers,
  taxonomyNodes,
  providerDoctors,
  creating = false,
  error,
  embedded = false,
  onLoadProviderDoctors,
  onCreate,
  onCreated,
}: OrderServiceGroupWizardProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WizardForm>(createBlankWizardForm);
  const [localError, setLocalError] = useState("");
  const selectedDoctorCount = form.participants.filter(
    (item) => item.provider_id && item.doctor_id,
  ).length;

  const duplicateDoctorCount = useMemo(() => {
    const selected = form.participants.flatMap((participant) =>
      participant.doctor_id ? [participant.doctor_id] : [],
    );
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
    const participants = form.participants.reduce<ServiceGroupParticipantInput[]>((acc, participant) => {
      if (!participant.provider_id || !participant.doctor_id) return acc;
      acc.push({
        provider_id: participant.provider_id,
        doctor_id: participant.doctor_id,
        role_label: participant.role_label.trim() || null,
      });
      return acc;
    }, []);
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
    setForm(createBlankWizardForm());
    if (embedded) {
      onCreated?.();
    } else {
      setOpen(false);
    }
  }

  const formMarkup = (
    <OrderServiceGroupWizardForm
      form={form}
      translations={t}
      basisTitle={uiTextLabel(t, "orders_basis")}
      costTitle={uiTextLabel(t, "orders_kosten")}
      providers={providers}
      taxonomyNodes={taxonomyNodes}
      providerDoctors={providerDoctors}
      creating={creating}
      error={error}
      localError={localError}
      selectedDoctorCount={selectedDoctorCount}
      duplicateDoctorCount={duplicateDoctorCount}
      setForm={setForm}
      onSubmit={(event) => void handleSubmit(event)}
      onLoadProviderDoctors={onLoadProviderDoctors}
      onUpdateParticipant={updateParticipant}
    />
  );

  if (embedded) {
    return formMarkup;
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
      {!open ? null : formMarkup}
    </Section>
  );
}

function OrderServiceGroupWizardForm({
  form,
  translations: t,
  basisTitle,
  costTitle,
  providers,
  taxonomyNodes,
  providerDoctors,
  creating,
  error,
  localError,
  selectedDoctorCount,
  duplicateDoctorCount,
  setForm,
  onSubmit,
  onLoadProviderDoctors,
  onUpdateParticipant,
}: {
  form: WizardForm;
  translations: Translations;
  basisTitle: ReactNode;
  costTitle: ReactNode;
  providers: ProviderOption[];
  taxonomyNodes: ProviderTaxonomyNode[];
  providerDoctors: Record<string, DoctorOption[]>;
  creating: boolean;
  error?: string | null;
  localError: string;
  selectedDoctorCount: number;
  duplicateDoctorCount: number;
  setForm: WizardFormSetter;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLoadProviderDoctors?: (providerId: string) => void | Promise<void>;
  onUpdateParticipant: UpdateWizardParticipant;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error || localError ? (
        <Banner tone="error" withIcon>{error ?? localError}</Banner>
      ) : null}

      <WizardBasicsSection
        form={form}
        setForm={setForm}
        title={basisTitle}
        translations={t}
      />
      <WizardCostSection
        form={form}
        setForm={setForm}
        title={costTitle}
        translations={t}
      />
      <WizardParticipantsSection
        form={form}
        setForm={setForm}
        providers={providers}
        taxonomyNodes={taxonomyNodes}
        providerDoctors={providerDoctors}
        selectedDoctorCount={selectedDoctorCount}
        translations={t}
        onLoadProviderDoctors={onLoadProviderDoctors}
        onUpdateParticipant={onUpdateParticipant}
      />
      <WizardPreviewSection
        duplicateDoctorCount={duplicateDoctorCount}
        selectedDoctorCount={selectedDoctorCount}
        translations={t}
      />
      <WizardSubmitActions creating={creating} translations={t} />
    </form>
  );
}

function WizardBasicsSection({
  form,
  setForm,
  title,
  translations: t,
}: {
  form: WizardForm;
  setForm: WizardFormSetter;
  title: ReactNode;
  translations: Translations;
}) {
  return (
    <SheetSectionCard title={title}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={t.orders_service_group_title} className="md:col-span-2">
          <Input
            value={form.group_title}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                group_title: event.target.value,
              }))
            }
            className={inputClass}
            placeholder={t.orders_service_group_title_placeholder}
          />
        </Field>
        <Field label={t.orders_service_group_service_date}>
          <Input
            type="date"
            value={form.service_date}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                service_date: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label={t.orders_service_group_description}>
          <Input
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
      </div>
    </SheetSectionCard>
  );
}

function WizardCostSection({
  form,
  setForm,
  title,
  translations: t,
}: {
  form: WizardForm;
  setForm: WizardFormSetter;
  title: ReactNode;
  translations: Translations;
}) {
  return (
    <SheetSectionCard title={title}>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={t.orders_service_group_quantity}>
          <Input
            value={form.quantity}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quantity: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label={t.orders_service_group_unit_price}>
          <Input
            value={form.unit_price}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                unit_price: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label={t.orders_service_group_vat_percent}>
          <Input
            value={form.vat_rate}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                vat_rate: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
        <Field label={t.orders_service_group_currency}>
          <Input
            value={form.currency}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                currency: event.target.value,
              }))
            }
            className={inputClass}
          />
        </Field>
      </div>
    </SheetSectionCard>
  );
}

function WizardParticipantsSection({
  form,
  setForm,
  providers,
  taxonomyNodes,
  providerDoctors,
  selectedDoctorCount,
  translations: t,
  onLoadProviderDoctors,
  onUpdateParticipant,
}: {
  form: WizardForm;
  setForm: WizardFormSetter;
  providers: ProviderOption[];
  taxonomyNodes: ProviderTaxonomyNode[];
  providerDoctors: Record<string, DoctorOption[]>;
  selectedDoctorCount: number;
  translations: Translations;
  onLoadProviderDoctors?: (providerId: string) => void | Promise<void>;
  onUpdateParticipant: UpdateWizardParticipant;
}) {
  function addParticipant() {
    setForm((current) => ({
      ...current,
      participants: [...current.participants, createBlankParticipant()],
    }));
  }

  function removeParticipant(index: number) {
    setForm((current) => ({
      ...current,
      participants: current.participants.filter(
        (_, participantIndex) => participantIndex !== index,
      ),
    }));
  }

  return (
    <SheetSectionCard
      title={t.orders_service_group_doctors}
      description={formatCountMessage(
        t.orders_service_group_wizard_preview_summary,
        selectedDoctorCount,
      )}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={addParticipant}
        >
          {t.orders_service_group_add_doctor}
        </Button>
      }
    >
      <div className="space-y-2">
        {form.participants.map((participant, index) => (
          <WizardParticipantRow
            key={participant.clientKey}
            participant={participant}
            index={index}
            doctors={
              participant.provider_id
                ? providerDoctors[participant.provider_id] ?? []
                : []
            }
            providers={providers}
            taxonomyNodes={taxonomyNodes}
            translations={t}
            canRemove={form.participants.length > 1}
            onLoadProviderDoctors={onLoadProviderDoctors}
            onRemove={() => removeParticipant(index)}
            onUpdateParticipant={onUpdateParticipant}
          />
        ))}
      </div>
    </SheetSectionCard>
  );
}

function WizardParticipantRow({
  participant,
  index,
  doctors,
  providers,
  taxonomyNodes,
  translations: t,
  canRemove,
  onLoadProviderDoctors,
  onRemove,
  onUpdateParticipant,
}: {
  participant: WizardParticipant;
  index: number;
  doctors: DoctorOption[];
  providers: ProviderOption[];
  taxonomyNodes: ProviderTaxonomyNode[];
  translations: Translations;
  canRemove: boolean;
  onLoadProviderDoctors?: (providerId: string) => void | Promise<void>;
  onRemove: () => void;
  onUpdateParticipant: UpdateWizardParticipant;
}) {
  const { lang } = useLang();

  function handleProviderChange(providerId: string) {
    onUpdateParticipant(index, {
      provider_id: providerId,
      doctor_id: "",
    });
    if (providerId) void onLoadProviderDoctors?.(providerId);
  }

  return (
    <div className="grid gap-2 rounded-xl border border-border/50 bg-card/70 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <Field label={t.orders_service_group_provider}>
        <ProviderSelectWithTaxonomyFilter
          value={participant.provider_id}
          providers={providers}
          taxonomyNodes={taxonomyNodes}
          providerPlaceholder={t.orders_service_group_select_provider}
          taxonomyPlaceholder={t.providers_category}
          taxonomyAllLabel={t.providers_all}
          containerClassName="grid-cols-1"
          taxonomySelectClassName={selectClass}
          providerSelectClassName={selectClass}
          providerLabel={(provider) => provider.name}
          onChange={handleProviderChange}
        />
      </Field>
      <Field label={t.orders_service_group_doctor}>
        <NativeComboboxSelect
          value={participant.doctor_id}
          onChange={(event) =>
            onUpdateParticipant(index, { doctor_id: event.target.value })
          }
          className={selectClass}
          disabled={!participant.provider_id}
        >
          <option value="">{t.orders_service_group_select_doctor}</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.name}
              {doctorSpecialtyLabel(doctor, lang) ? ` - ${doctorSpecialtyLabel(doctor, lang)}` : ""}
            </option>
          ))}
        </NativeComboboxSelect>
      </Field>
      <Field label={t.orders_service_group_role_label}>
        <Input
          value={participant.role_label}
          onChange={(event) =>
            onUpdateParticipant(index, { role_label: event.target.value })
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
          disabled={!canRemove}
          onClick={onRemove}
        >
          {t.orders_service_group_remove}
        </Button>
      </div>
    </div>
  );
}

function WizardPreviewSection({
  duplicateDoctorCount,
  selectedDoctorCount,
  translations: t,
}: {
  duplicateDoctorCount: number;
  selectedDoctorCount: number;
  translations: Translations;
}) {
  return (
    <SheetSectionCard title={t.orders_service_group_preview}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={tokens.text.muted}>
          {formatCountMessage(
            t.orders_service_group_wizard_preview_summary,
            selectedDoctorCount,
          )}
        </p>
        <CountBadge>
          {duplicateDoctorCount > 0
            ? t.orders_service_group_duplicates
            : t.orders_service_group_ready}
        </CountBadge>
      </div>
    </SheetSectionCard>
  );
}

function WizardSubmitActions({
  creating,
  translations: t,
}: {
  creating: boolean;
  translations: Translations;
}) {
  return (
    <div className="flex justify-end">
      <Button type="submit" className="rounded-lg" disabled={creating}>
        {creating
          ? t.orders_service_group_creating
          : t.orders_service_group_save_preview}
      </Button>
    </div>
  );
}

function ServiceGroupLineRow({
  doctorName,
  providerName,
  actionLabel,
  detail,
  amount,
  noticeLabel,
  noticeValue,
  noticeTone,
}: {
  doctorName: string;
  providerName: string;
  actionLabel: string;
  detail: ReactNode;
  amount: ReactNode;
  noticeLabel: ReactNode;
  noticeValue?: ReactNode;
  noticeTone: "amber" | "emerald" | "muted";
}) {
  const noticeClassName =
    noticeTone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : noticeTone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-border bg-background text-muted-foreground";

  return (
    <article className="rounded-xl border border-border bg-background/70 p-3">
      <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="min-w-0 max-w-full break-words text-sm font-semibold text-foreground">
              {doctorName}
            </h4>
            <span className="size-1 rounded-full bg-muted-foreground/35" />
            <p className="min-w-0 max-w-full break-words text-xs text-muted-foreground">
              {providerName}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="w-fit shrink-0 rounded-full bg-card">
          {actionLabel}
        </Badge>
      </div>

      <div className="mt-2.5 rounded-lg border border-border/70 bg-card px-3 py-2">
        <p className="break-words text-xs leading-snug text-muted-foreground">
          {detail}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground">
          <span className="text-muted-foreground">{amount}</span>
        </span>
        <span
          className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${noticeClassName}`}
        >
          <span className="min-w-0 truncate">{noticeLabel}</span>
          {noticeValue ? (
            <code className="min-w-0 max-w-[11rem] truncate font-mono text-[11px]">
              {noticeValue}
            </code>
          ) : null}
        </span>
      </div>
    </article>
  );
}

function numberOrNull(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
