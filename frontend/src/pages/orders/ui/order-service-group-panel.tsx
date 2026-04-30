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

export function OrderServiceGroupPanel({
  group,
  preview,
  generating = false,
  error,
  onGenerate,
}: OrderServiceGroupPanelProps) {
  const [overrideDuplicates, setOverrideDuplicates] = useState(false);
  const previewCount = group.participants.length;
  const generatedLineCount = group.generated_line_count ?? 0;
  const duplicateCount = preview?.skip_duplicate_count ?? generatedLineCount;
  const generateCount = preview?.generate_count ?? Math.max(0, previewCount - generatedLineCount);

  return (
    <Section
      title="Split service by doctors"
      accessory={<CountBadge>{previewCount} participants</CountBadge>}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {group.group_title}
          </h3>
          <p className={tokens.text.muted}>
            {previewCount} doctors create {previewCount} generated billing lines.
            Each line is participant-scoped and existing lines are detected through source_service_group_participant_id.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full">
              {group.status}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {group.quantity} x {group.unit_price} {group.currency}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              VAT {group.vat_rate}%
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {generatedLineCount} generated
            </Badge>
            {duplicateCount > 0 ? (
              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                {duplicateCount} duplicate-safe
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
              Regenerate existing lines
            </label>
            <Button
              type="button"
              size="sm"
              className="rounded-lg"
              disabled={generating || previewCount === 0 || (!overrideDuplicates && generateCount === 0)}
              onClick={() => onGenerate(overrideDuplicates)}
            >
              {generating
                ? "Generating..."
                : overrideDuplicates
                  ? "Regenerate lines"
                  : "Generate new lines"}
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      {preview ? (
        <div className="grid gap-3 md:grid-cols-3">
          <PreviewMetric label="Will generate" value={preview.generate_count} />
          <PreviewMetric label="Will update" value={preview.update_count} />
          <PreviewMetric label="Will skip duplicates" value={preview.skip_duplicate_count} />
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
                  index={index}
                  action={line.action}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {line.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {line.quantity} x {line.unit_price} {line.currency} - VAT {line.vat_rate}%
                </p>
                {line.existing_leistung_id ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                    Existing line: {line.existing_leistung_id}
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] text-muted-foreground">
                    Preview only: a new billing line will be created.
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
                  index={index}
                  action={participant.generated_leistung_id ? "skip_duplicate" : "generate"}
                />
                {participant.role_label ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {participant.role_label}
                  </p>
                ) : null}
                {participant.generated_leistung_id ? (
                  <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    Generated line: {participant.generated_leistung_id}
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] text-muted-foreground">
                    Preview only: billing line will be created from this participant.
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
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WizardForm>(blankWizardForm);
  const [localError, setLocalError] = useState("");

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
      setLocalError("Group title is required");
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
      setLocalError("At least one doctor participant is required");
      return;
    }
    if (duplicateDoctorCount > 0) {
      setLocalError("A doctor can only appear once in a service group");
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
        error instanceof Error ? error.message : "Failed to create service group",
      );
      return;
    }
    setForm(blankWizardForm);
    setOpen(false);
  }

  return (
    <Section
      title="Multi-doctor service wizard"
      accessory={
        <Button
          type="button"
          size="sm"
          variant={open ? "outline" : "default"}
          className="rounded-lg"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Close wizard" : "Create split group"}
        </Button>
      }
    >
      <p className={tokens.text.muted}>
        Step 1: define the group. Step 2: add doctors. Step 3: review the
        preview. Step 4: generate participant-scoped billing lines from the
        saved group.
      </p>
      {!open ? null : (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
          {(error || localError) ? (
            <Banner tone="error" withIcon>{error ?? localError}</Banner>
          ) : null}
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Group title" className="md:col-span-2">
              <Input
                value={form.group_title}
                onChange={(event) => setForm({ ...form, group_title: event.target.value })}
                className={inputClass}
                placeholder="Cardiology board"
              />
            </Field>
            <Field label="Service date">
              <Input
                type="date"
                value={form.service_date}
                onChange={(event) => setForm({ ...form, service_date: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Currency">
              <Input
                value={form.currency}
                onChange={(event) => setForm({ ...form, currency: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Quantity">
              <Input
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Unit price">
              <Input
                value={form.unit_price}
                onChange={(event) => setForm({ ...form, unit_price: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="VAT %">
              <Input
                value={form.vat_rate}
                onChange={(event) => setForm({ ...form, vat_rate: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground">Doctors</h4>
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
                Add doctor
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
                  <Field label="Provider">
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
                      <option value="">Select provider</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label="Doctor">
                    <NativeComboboxSelect
                      value={participant.doctor_id}
                      onChange={(event) =>
                        updateParticipant(index, { doctor_id: event.target.value })
                      }
                      className={selectClass}
                      disabled={!participant.provider_id}
                    >
                      <option value="">Select doctor</option>
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}{doctor.fachbereich ? ` - ${doctor.fachbereich}` : ""}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label="Role label">
                    <Input
                      value={participant.role_label}
                      onChange={(event) =>
                        updateParticipant(index, { role_label: event.target.value })
                      }
                      className={inputClass}
                      placeholder="Lead, second opinion"
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
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/60 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Preview</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.participants.filter((item) => item.provider_id && item.doctor_id).length} selected doctors will create the same number of billing lines.
                </p>
              </div>
              <CountBadge>
                {duplicateDoctorCount > 0 ? "Duplicates" : "Ready"}
              </CountBadge>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" className="rounded-lg" disabled={creating}>
              {creating ? "Creating..." : "Save group preview"}
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
  index,
  action,
}: {
  doctorName: string;
  providerName: string;
  index: number;
  action: string;
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
        {action === "skip_duplicate" ? "duplicate" : action || `line ${index + 1}`}
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
