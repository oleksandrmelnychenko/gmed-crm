import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Plus,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import {
  buildInterpreterLanguagesPath,
  buildInterpreterListPath,
  emptyInterpreterLanguage,
  interpreterLanguageRecordToForm,
  interpreterLanguagesToPayload,
  type InterpreterLanguageForm,
  type InterpreterLanguageRecord,
} from "./interpreters.model";

type InterpreterRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  profile: InterpreterProfile;
  profile_updated_at: string | null;
};

type InterpreterProfile = Record<string, unknown>;

type InterpreterOperations = {
  summary: Record<string, unknown>;
  patients: Record<string, unknown>[];
  upcoming_appointments: Record<string, unknown>[];
  active_tasks: Record<string, unknown>[];
  recent_reports: Record<string, unknown>[];
  billing_lines: Record<string, unknown>[];
};

type CredentialForm = {
  credentialType: string;
  title: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  documentUrl: string;
  notes: string;
};

type InterpreterProfileForm = {
  gender: string;
  birthDate: string;
  status: string;
  contractType: string;
  contractStartDate: string;
  contractEndDate: string;
  employmentKind: string;
  phone: string;
  emailSecure: boolean;
  address: string;
  emergencyContact: string;
  workCountries: string;
  workLocations: string;
  languageProfile: string;
  certificates: string;
  credentials: CredentialForm[];
  medicalKnowledge: string;
  trainingHistory: string;
  confidentialityStatus: string;
  confidentialitySignedAt: string;
  confidentialityDocumentUrl: string;
  avvStatus: string;
  avvSignedAt: string;
  avvDocumentUrl: string;
  gdprTrainingAt: string;
  workPermitValidUntil: string;
  hourlyRate: string;
  salaryClass: string;
  bankDetails: string;
  taxNumber: string;
  ustIdnr: string;
  billingStatus: string;
  weeklyCapacityHours: string;
  accessLevel: string;
  autoBlockPolicy: string;
  internalNotes: string;
  equipment: string;
  retentionDeleteAt: string;
  erasureRequestStatus: string;
};

const inputClass =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm";
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

function asProfile(value: unknown): InterpreterProfile {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as InterpreterProfile)
    : {};
}

function nested(profile: InterpreterProfile, key: string) {
  return asProfile(profile[key]);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function bool(value: unknown) {
  return value === true;
}

function listText(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join(", ")
    : text(value);
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function displayValue(value: unknown, fallback = "-") {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function displayNumber(value: unknown, suffix = "") {
  const textValue = displayValue(value, "0");
  return suffix ? `${textValue}${suffix}` : textValue;
}

function compactDate(value: unknown) {
  return typeof value === "string" && value ? value : "-";
}

function emptyCredential(): CredentialForm {
  return {
    credentialType: "certificate",
    title: "",
    issuer: "",
    issuedAt: "",
    expiresAt: "",
    documentUrl: "",
    notes: "",
  };
}

function credentialsToForm(value: unknown): CredentialForm[] {
  return Array.isArray(value)
    ? value
        .map((item) => asProfile(item))
        .map((item) => ({
          credentialType: text(item.credentialType) || "certificate",
          title: text(item.title),
          issuer: text(item.issuer),
          issuedAt: text(item.issuedAt),
          expiresAt: text(item.expiresAt),
          documentUrl: text(item.documentUrl),
          notes: text(item.notes),
        }))
        .filter((item) => item.title || item.issuer || item.documentUrl)
    : [];
}

function credentialsToProfile(credentials: CredentialForm[]) {
  return credentials
    .filter((credential) => credential.title.trim())
    .map((credential) => ({
      credentialType: credential.credentialType || "certificate",
      title: credential.title.trim(),
      issuer: credential.issuer.trim(),
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
      documentUrl: credential.documentUrl.trim(),
      notes: credential.notes.trim(),
    }));
}

function profileToForm(profile: InterpreterProfile): InterpreterProfileForm {
  const contact = nested(profile, "contact");
  const compliance = nested(profile, "compliance");
  const finance = nested(profile, "finance");
  const access = nested(profile, "access");

  return {
    gender: text(profile.gender),
    birthDate: text(profile.birthDate),
    status: text(profile.status) || "active",
    contractType: text(profile.contractType),
    contractStartDate: text(profile.contractStartDate),
    contractEndDate: text(profile.contractEndDate),
    employmentKind: text(profile.employmentKind),
    phone: text(profile.phone) || text(contact.phone),
    emailSecure: bool(profile.emailSecure ?? contact.emailSecure),
    address: text(profile.address) || text(contact.address),
    emergencyContact:
      text(profile.emergencyContact) || text(contact.emergencyContact),
    workCountries: listText(profile.workCountries),
    workLocations: listText(profile.workLocations),
    languageProfile: text(profile.languageProfile),
    certificates: text(profile.certificates),
    credentials: credentialsToForm(profile.credentials),
    medicalKnowledge: text(profile.medicalKnowledge),
    trainingHistory: text(profile.trainingHistory),
    confidentialityStatus:
      text(profile.confidentialityStatus) ||
      text(compliance.confidentialityStatus),
    confidentialitySignedAt:
      text(profile.confidentialitySignedAt) ||
      text(compliance.confidentialitySignedAt),
    confidentialityDocumentUrl:
      text(profile.confidentialityDocumentUrl) ||
      text(compliance.confidentialityDocumentUrl),
    avvStatus: text(profile.avvStatus) || text(compliance.avvStatus),
    avvSignedAt: text(profile.avvSignedAt) || text(compliance.avvSignedAt),
    avvDocumentUrl:
      text(profile.avvDocumentUrl) || text(compliance.avvDocumentUrl),
    gdprTrainingAt:
      text(profile.gdprTrainingAt) || text(compliance.gdprTrainingAt),
    workPermitValidUntil: text(profile.workPermitValidUntil),
    hourlyRate: text(profile.hourlyRate) || text(finance.hourlyRate),
    salaryClass: text(profile.salaryClass) || text(finance.salaryClass),
    bankDetails: text(profile.bankDetails) || text(finance.bankDetails),
    taxNumber: text(profile.taxNumber) || text(finance.taxNumber),
    ustIdnr: text(profile.ustIdnr) || text(finance.ustIdnr),
    billingStatus: text(profile.billingStatus) || text(finance.billingStatus),
    weeklyCapacityHours: text(profile.weeklyCapacityHours),
    accessLevel: text(profile.accessLevel) || text(access.level),
    autoBlockPolicy:
      text(profile.autoBlockPolicy) || text(access.autoBlockPolicy),
    internalNotes: text(profile.internalNotes),
    equipment: listText(profile.equipment),
    retentionDeleteAt: text(profile.retentionDeleteAt),
    erasureRequestStatus: text(profile.erasureRequestStatus),
  };
}

function formToProfile(form: InterpreterProfileForm) {
  return {
    gender: form.gender,
    birthDate: form.birthDate,
    status: form.status,
    contractType: form.contractType,
    contractStartDate: form.contractStartDate,
    contractEndDate: form.contractEndDate,
    employmentKind: form.employmentKind,
    phone: form.phone,
    emailSecure: form.emailSecure,
    address: form.address,
    emergencyContact: form.emergencyContact,
    workCountries: parseList(form.workCountries),
    workLocations: parseList(form.workLocations),
    languageProfile: form.languageProfile,
    certificates: form.certificates,
    credentials: credentialsToProfile(form.credentials),
    medicalKnowledge: form.medicalKnowledge,
    trainingHistory: form.trainingHistory,
    compliance: {
      confidentialityStatus: form.confidentialityStatus,
      confidentialitySignedAt: form.confidentialitySignedAt,
      confidentialityDocumentUrl: form.confidentialityDocumentUrl,
      avvStatus: form.avvStatus,
      avvSignedAt: form.avvSignedAt,
      avvDocumentUrl: form.avvDocumentUrl,
      gdprTrainingAt: form.gdprTrainingAt,
    },
    workPermitValidUntil: form.workPermitValidUntil,
    finance: {
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
      salaryClass: form.salaryClass,
      bankDetails: form.bankDetails,
      taxNumber: form.taxNumber,
      ustIdnr: form.ustIdnr,
      billingStatus: form.billingStatus,
    },
    weeklyCapacityHours: form.weeklyCapacityHours
      ? Number(form.weeklyCapacityHours)
      : null,
    access: {
      level: form.accessLevel,
      autoBlockPolicy: form.autoBlockPolicy,
    },
    internalNotes: form.internalNotes,
    equipment: parseList(form.equipment),
    retentionDeleteAt: form.retentionDeleteAt,
    erasureRequestStatus: form.erasureRequestStatus,
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block text-base font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function OperationsList({
  title,
  items,
  empty,
  renderItem,
}: {
  title: string;
  items: Record<string, unknown>[];
  empty: string;
  renderItem: (item: Record<string, unknown>) => ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? (
          items.slice(0, 4).map((item, index) => (
            <div
              key={text(item.id) || `${title}-${index}`}
              className="rounded-md bg-muted/35 px-3 py-2 text-xs text-foreground"
            >
              {renderItem(item)}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

export function InterpretersPage() {
  const { interpreterId } = useParams();
  const [items, setItems] = useState<InterpreterRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operations, setOperations] = useState<InterpreterOperations | null>(
    null,
  );
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [languages, setLanguages] = useState<InterpreterLanguageForm[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [contractFilter, setContractFilter] = useState("");
  const deferredSearch = useDeferredValue(search);
  const filtersActive =
    search.trim() !== "" || statusFilter !== "" || contractFilter !== "";

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const [form, setForm] = useState<InterpreterProfileForm>(() =>
    profileToForm({}),
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<InterpreterRecord[]>(
        buildInterpreterListPath({
          search: deferredSearch,
          status: statusFilter,
          contractType: contractFilter,
        }),
      );
      setItems(data);
      setSelectedId((current) => {
        if (interpreterId && data.some((item) => item.id === interpreterId)) {
          return interpreterId;
        }
        if (data.some((item) => item.id === current)) {
          return current;
        }
        return data[0]?.id || "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [contractFilter, deferredSearch, interpreterId, statusFilter]);

  const loadOperations = useCallback(async (id: string) => {
    setOperationsLoading(true);
    try {
      const data = await apiFetch<InterpreterOperations>(
        `/interpreters/${id}/profile/operations`,
      );
      setOperations(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
    } finally {
      setOperationsLoading(false);
    }
  }, []);

  const loadLanguages = useCallback(async (id: string) => {
    setLanguagesLoading(true);
    try {
      const data = await apiFetch<InterpreterLanguageRecord[]>(
        buildInterpreterLanguagesPath(id),
      );
      setLanguages(
        data
          .filter((item) => item.is_active)
          .map(interpreterLanguageRecordToForm),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed");
      setLanguages([]);
    } finally {
      setLanguagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (selected) {
      setForm(profileToForm(selected.profile));
      setNotice("");
      void loadOperations(selected.id);
      void loadLanguages(selected.id);
    } else {
      setOperations(null);
      setLanguages([]);
    }
  }, [loadLanguages, loadOperations, selected]);

  function patchForm(patch: Partial<InterpreterProfileForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function patchCredential(index: number, patch: Partial<CredentialForm>) {
    setForm((current) => ({
      ...current,
      credentials: current.credentials.map((credential, itemIndex) =>
        itemIndex === index ? { ...credential, ...patch } : credential,
      ),
    }));
  }

  function addCredential() {
    setForm((current) => ({
      ...current,
      credentials: [...current.credentials, emptyCredential()],
    }));
  }

  function removeCredential(index: number) {
    setForm((current) => ({
      ...current,
      credentials: current.credentials.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function patchLanguage(index: number, patch: Partial<InterpreterLanguageForm>) {
    setLanguages((current) =>
      current.map((language, itemIndex) =>
        itemIndex === index ? { ...language, ...patch } : language,
      ),
    );
  }

  function addLanguage() {
    setLanguages((current) => [...current, emptyInterpreterLanguage()]);
  }

  function removeLanguage(index: number) {
    setLanguages((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ profile: InterpreterProfile }>(
        `/interpreters/${selected.id}/profile`,
        {
          method: "PUT",
          body: JSON.stringify(formToProfile(form)),
        },
      );
      setItems((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, profile: result.profile } : item,
        ),
      );
      await apiFetch(buildInterpreterLanguagesPath(selected.id), {
        method: "POST",
        body: JSON.stringify({
          languages: interpreterLanguagesToPayload(languages),
        }),
      });
      await loadLanguages(selected.id);
      await loadOperations(selected.id);
      setNotice("Profile saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              Interpreter Profiles
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Contract, compliance, availability and internal interpreter data.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadItems()}
            disabled={loading}
          >
            <RefreshCcw className="size-4" />
            Refresh
          </Button>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UsersRound className="size-4 text-primary" />
              Team
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className={`${inputClass} w-full pl-8`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                />
              </div>
              <select
                className={selectClass}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="vacation">Vacation</option>
                <option value="sick">Sick</option>
                <option value="training">Training</option>
                <option value="blocked">Blocked</option>
                <option value="terminated">Terminated</option>
              </select>
              <select
                className={selectClass}
                value={contractFilter}
                onChange={(event) => setContractFilter(event.target.value)}
              >
                <option value="">All contract types</option>
                <option value="employee">Employee</option>
                <option value="freelancer">Freelancer</option>
                <option value="hourly">Hourly</option>
              </select>
              {filtersActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 w-full justify-start px-2 text-xs"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setContractFilter("");
                  }}
                >
                  <X className="size-3.5" />
                  Clear filters
                </Button>
              ) : null}
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                    selected?.id === item.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item.role} · {text(item.profile.status) || "no status"}
                  </span>
                </button>
              ))}
              {!loading && items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  No interpreters found.
                </div>
              ) : null}
            </div>
          </aside>

          {selected ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-6 rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">
                      {selected.name}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.email} · {selected.id}
                  </p>
                </div>
                <Button type="submit" disabled={saving}>
                  <Save className="size-4" />
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>

              <Section title="A. Core data">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Status">
                    <select
                      className={selectClass}
                      value={form.status}
                      onChange={(event) => patchForm({ status: event.target.value })}
                    >
                      <option value="active">Active</option>
                      <option value="vacation">Vacation</option>
                      <option value="sick">Sick</option>
                      <option value="training">Training</option>
                      <option value="blocked">Blocked</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </Field>
                  <Field label="Contract type">
                    <select
                      className={selectClass}
                      value={form.contractType}
                      onChange={(event) =>
                        patchForm({ contractType: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="employee">Employee</option>
                      <option value="freelancer">Freelancer</option>
                      <option value="hourly">Hourly</option>
                    </select>
                  </Field>
                  <Field label="Internal / external">
                    <select
                      className={selectClass}
                      value={form.employmentKind}
                      onChange={(event) =>
                        patchForm({ employmentKind: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="internal">Internal</option>
                      <option value="external">External</option>
                    </select>
                  </Field>
                  <Field label="Gender">
                    <Input
                      className={inputClass}
                      value={form.gender}
                      onChange={(event) => patchForm({ gender: event.target.value })}
                    />
                  </Field>
                  <Field label="Birth date">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.birthDate}
                      onChange={(event) =>
                        patchForm({ birthDate: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Contract start / end">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="date"
                        className={inputClass}
                        value={form.contractStartDate}
                        onChange={(event) =>
                          patchForm({ contractStartDate: event.target.value })
                        }
                      />
                      <Input
                        type="date"
                        className={inputClass}
                        value={form.contractEndDate}
                        onChange={(event) =>
                          patchForm({ contractEndDate: event.target.value })
                        }
                      />
                    </div>
                  </Field>
                </div>
              </Section>

              <Section title="B. Contact and availability">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Phone">
                    <Input
                      className={inputClass}
                      value={form.phone}
                      onChange={(event) => patchForm({ phone: event.target.value })}
                    />
                  </Field>
                  <Field label="Email security">
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.emailSecure}
                        onChange={(event) =>
                          patchForm({ emailSecure: event.target.checked })
                        }
                      />
                      Secure email verified
                    </label>
                  </Field>
                  <Field label="Address">
                    <Input
                      className={inputClass}
                      value={form.address}
                      onChange={(event) => patchForm({ address: event.target.value })}
                    />
                  </Field>
                  <Field label="Emergency contact">
                    <Input
                      className={inputClass}
                      value={form.emergencyContact}
                      onChange={(event) =>
                        patchForm({ emergencyContact: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Work countries">
                    <Input
                      className={inputClass}
                      value={form.workCountries}
                      onChange={(event) =>
                        patchForm({ workCountries: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Work locations">
                    <Input
                      className={inputClass}
                      value={form.workLocations}
                      onChange={(event) =>
                        patchForm({ workLocations: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section title="C. Qualification and languages">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Structured languages
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={addLanguage}
                    >
                      <Plus className="size-3.5" />
                      Add language
                    </Button>
                  </div>
                  {languagesLoading ? (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      Loading languages...
                    </p>
                  ) : languages.length > 0 ? (
                    languages.map((language, index) => (
                      <div
                        key={index}
                        className="grid gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-[minmax(80px,0.7fr)_minmax(0,1.1fr)_minmax(90px,0.7fr)_minmax(120px,0.9fr)_minmax(0,1.2fr)_auto]"
                      >
                        <Field label="Code">
                          <Input
                            className={inputClass}
                            value={language.languageCode}
                            onChange={(event) =>
                              patchLanguage(index, {
                                languageCode: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Label">
                          <Input
                            className={inputClass}
                            value={language.languageLabel}
                            onChange={(event) =>
                              patchLanguage(index, {
                                languageLabel: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="CEFR">
                          <select
                            className={selectClass}
                            value={language.cefrLevel}
                            onChange={(event) =>
                              patchLanguage(index, {
                                cefrLevel: event.target.value,
                              })
                            }
                          >
                            <option value="">Not set</option>
                            <option value="A1">A1</option>
                            <option value="A2">A2</option>
                            <option value="B1">B1</option>
                            <option value="B2">B2</option>
                            <option value="C1">C1</option>
                            <option value="C2">C2</option>
                          </select>
                        </Field>
                        <Field label="Proficiency">
                          <select
                            className={selectClass}
                            value={language.proficiency}
                            onChange={(event) =>
                              patchLanguage(index, {
                                proficiency: event.target.value,
                              })
                            }
                          >
                            <option value="native">Native</option>
                            <option value="fluent">Fluent</option>
                            <option value="working">Working</option>
                            <option value="basic">Basic</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </Field>
                        <Field label="Specialization">
                          <Input
                            className={inputClass}
                            value={language.specialization}
                            onChange={(event) =>
                              patchLanguage(index, {
                                specialization: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 px-2 text-xs"
                            onClick={() => removeLanguage(index)}
                          >
                            <Trash2 className="size-3.5" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      No structured languages yet.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Certificates">
                    <textarea
                      className={textareaClass}
                      value={form.certificates}
                      onChange={(event) =>
                        patchForm({ certificates: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Medical knowledge">
                    <Input
                      className={inputClass}
                      value={form.medicalKnowledge}
                      onChange={(event) =>
                        patchForm({ medicalKnowledge: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Training history">
                    <Input
                      className={inputClass}
                      value={form.trainingHistory}
                      onChange={(event) =>
                        patchForm({ trainingHistory: event.target.value })
                      }
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Structured credentials
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={addCredential}
                    >
                      <Plus className="size-3.5" />
                      Add credential
                    </Button>
                  </div>
                  {form.credentials.length > 0 ? (
                    form.credentials.map((credential, index) => (
                      <div
                        key={index}
                        className="grid gap-3 border-t border-border pt-3 md:grid-cols-4"
                      >
                        <Field label="Type">
                          <select
                            className={selectClass}
                            value={credential.credentialType}
                            onChange={(event) =>
                              patchCredential(index, {
                                credentialType: event.target.value,
                              })
                            }
                          >
                            <option value="certificate">Certificate</option>
                            <option value="sworn_interpreter">
                              Sworn interpreter
                            </option>
                            <option value="medical_translation">
                              Medical translation
                            </option>
                            <option value="training">Training</option>
                          </select>
                        </Field>
                        <Field label="Title">
                          <Input
                            className={inputClass}
                            value={credential.title}
                            onChange={(event) =>
                              patchCredential(index, {
                                title: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Issuer">
                          <Input
                            className={inputClass}
                            value={credential.issuer}
                            onChange={(event) =>
                              patchCredential(index, {
                                issuer: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Valid dates">
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="date"
                              className={inputClass}
                              value={credential.issuedAt}
                              onChange={(event) =>
                                patchCredential(index, {
                                  issuedAt: event.target.value,
                                })
                              }
                            />
                            <Input
                              type="date"
                              className={inputClass}
                              value={credential.expiresAt}
                              onChange={(event) =>
                                patchCredential(index, {
                                  expiresAt: event.target.value,
                                })
                              }
                            />
                          </div>
                        </Field>
                        <Field label="Document URL">
                          <Input
                            className={inputClass}
                            value={credential.documentUrl}
                            onChange={(event) =>
                              patchCredential(index, {
                                documentUrl: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Notes">
                          <Input
                            className={inputClass}
                            value={credential.notes}
                            onChange={(event) =>
                              patchCredential(index, {
                                notes: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 px-2 text-xs"
                            onClick={() => removeCredential(index)}
                          >
                            <Trash2 className="size-3.5" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      No structured credentials yet.
                    </p>
                  )}
                </div>
              </Section>

              <Section title="D. Legal and compliance">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Confidentiality">
                    <select
                      className={selectClass}
                      value={form.confidentialityStatus}
                      onChange={(event) =>
                        patchForm({ confidentialityStatus: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="signed">Signed</option>
                      <option value="missing">Missing</option>
                    </select>
                  </Field>
                  <Field label="Signed at">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.confidentialitySignedAt}
                      onChange={(event) =>
                        patchForm({ confidentialitySignedAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Document URL">
                    <Input
                      className={inputClass}
                      value={form.confidentialityDocumentUrl}
                      onChange={(event) =>
                        patchForm({
                          confidentialityDocumentUrl: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="AVV / work contract">
                    <select
                      className={selectClass}
                      value={form.avvStatus}
                      onChange={(event) =>
                        patchForm({ avvStatus: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="signed">Signed</option>
                      <option value="pending">Pending</option>
                    </select>
                  </Field>
                  <Field label="AVV signed at">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.avvSignedAt}
                      onChange={(event) =>
                        patchForm({ avvSignedAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="AVV document URL">
                    <Input
                      className={inputClass}
                      value={form.avvDocumentUrl}
                      onChange={(event) =>
                        patchForm({ avvDocumentUrl: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="GDPR training">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.gdprTrainingAt}
                      onChange={(event) =>
                        patchForm({ gdprTrainingAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Work permit valid until">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.workPermitValidUntil}
                      onChange={(event) =>
                        patchForm({ workPermitValidUntil: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section title="E. Finance and access">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Hourly rate">
                    <Input
                      type="number"
                      className={inputClass}
                      value={form.hourlyRate}
                      onChange={(event) =>
                        patchForm({ hourlyRate: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Salary class">
                    <Input
                      className={inputClass}
                      value={form.salaryClass}
                      onChange={(event) =>
                        patchForm({ salaryClass: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Billing status">
                    <select
                      className={selectClass}
                      value={form.billingStatus}
                      onChange={(event) =>
                        patchForm({ billingStatus: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="unpaid">Unpaid</option>
                      <option value="paid">Paid</option>
                      <option value="overdue">Overdue</option>
                    </select>
                  </Field>
                  <Field label="Bank details">
                    <Input
                      className={inputClass}
                      value={form.bankDetails}
                      onChange={(event) =>
                        patchForm({ bankDetails: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Tax number">
                    <Input
                      className={inputClass}
                      value={form.taxNumber}
                      onChange={(event) =>
                        patchForm({ taxNumber: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="USt-IdNr.">
                    <Input
                      className={inputClass}
                      value={form.ustIdnr}
                      onChange={(event) => patchForm({ ustIdnr: event.target.value })}
                    />
                  </Field>
                  <Field label="Access level">
                    <select
                      className={selectClass}
                      value={form.accessLevel}
                      onChange={(event) =>
                        patchForm({ accessLevel: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="appointment_only">Appointment only</option>
                      <option value="medical_shared">Medical data shared</option>
                      <option value="full">Full access</option>
                    </select>
                  </Field>
                  <Field label="Auto block policy">
                    <select
                      className={selectClass}
                      value={form.autoBlockPolicy}
                      onChange={(event) =>
                        patchForm({ autoBlockPolicy: event.target.value })
                      }
                    >
                      <option value="">Not set</option>
                      <option value="immediate">Immediate</option>
                      <option value="after_one_hour">After one hour</option>
                    </select>
                  </Field>
                </div>
              </Section>

              <Section title="F. Performance and live workload">
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="Weekly capacity hours">
                    <Input
                      type="number"
                      className={inputClass}
                      value={form.weeklyCapacityHours}
                      onChange={(event) =>
                        patchForm({ weeklyCapacityHours: event.target.value })
                      }
                    />
                  </Field>
                  <Metric
                    label="Booked this week"
                    value={displayNumber(
                      operations?.summary.booked_hours_week,
                      " h",
                    )}
                  />
                  <Metric
                    label="Capacity"
                    value={displayNumber(
                      operations?.summary.capacity_hours_week,
                      " h",
                    )}
                  />
                  <Metric
                    label="Utilization"
                    value={displayNumber(
                      operations?.summary.utilization_percent,
                      "%",
                    )}
                  />
                  <Metric
                    label="Average score"
                    value={`${displayNumber(
                      operations?.summary.average_feedback_score,
                    )}/5`}
                  />
                  <Metric
                    label="Feedback"
                    value={displayNumber(operations?.summary.feedback_count)}
                  />
                  <Metric
                    label="Next 30 days"
                    value={displayNumber(
                      operations?.summary.appointments_next_30_days,
                    )}
                  />
                  <Metric
                    label="Active tasks"
                    value={displayNumber(operations?.summary.active_tasks)}
                  />
                </div>

                {operationsLoading ? (
                  <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    Loading workload...
                  </div>
                ) : operations ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <OperationsList
                      title="Assigned patients"
                      items={operations.patients}
                      empty="No assigned patients"
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.patient_code)} ·{" "}
                            {displayValue(item.patient_name)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.appointment_count)} appointments ·
                            next {compactDate(item.next_appointment_date)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title="Upcoming appointments"
                      items={operations.upcoming_appointments}
                      empty="No upcoming appointments"
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {compactDate(item.date)} ·{" "}
                            {displayValue(item.time_start)}-
                            {displayValue(item.time_end)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.patient_code)} ·{" "}
                            {displayValue(item.title)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title="Active tasks"
                      items={operations.active_tasks}
                      empty="No active tasks"
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.priority)} ·{" "}
                            {displayValue(item.title)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            due {compactDate(item.due_date)} ·{" "}
                            {displayValue(item.order_number)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title="Recent reports"
                      items={operations.recent_reports}
                      empty="No reports"
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayNumber(item.hours, " h")} ·{" "}
                            {displayValue(item.approval_status)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {compactDate(item.appointment_date)} ·{" "}
                            {displayValue(item.patient_code)} · billing{" "}
                            {displayValue(item.billing_status)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title="Billing lines"
                      items={operations.billing_lines}
                      empty="No synced billing lines"
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.order_number)} ·{" "}
                            {displayValue(item.status)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.description)} ·{" "}
                            {displayNumber(item.unit_price)}{" "}
                            {displayValue(item.currency)}
                          </span>
                        </div>
                      )}
                    />
                  </div>
                ) : null}
              </Section>

              <Section title="I. Internal management">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Internal notes">
                    <textarea
                      className={textareaClass}
                      value={form.internalNotes}
                      onChange={(event) =>
                        patchForm({ internalNotes: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Equipment">
                    <Input
                      className={inputClass}
                      value={form.equipment}
                      onChange={(event) => patchForm({ equipment: event.target.value })}
                    />
                  </Field>
                  <Field label="Retention delete at">
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.retentionDeleteAt}
                      onChange={(event) =>
                        patchForm({ retentionDeleteAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Erasure request status">
                    <Input
                      className={inputClass}
                      value={form.erasureRequestStatus}
                      onChange={(event) =>
                        patchForm({ erasureRequestStatus: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>
            </form>
          ) : loading ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              Loading interpreter profiles...
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
