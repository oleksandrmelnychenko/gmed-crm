import {
  startTransition,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  LoaderCircle,
  Mail,
  Phone,
  Stethoscope,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderDetail = {
  id: string;
  name: string;
  provider_type: string;
  legal_name?: string | null;
  tax_id?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  fachbereich?: string | null;
  kooperationsvertrag?: unknown;
  notes?: string | null;
  is_active: boolean;
  updated_at: string;
  doctors: DoctorItem[];
  services: ServiceItem[];
  linked_patients: LinkedPatient[];
  interactions: InteractionItem[];
  templates: ProviderTemplateItem[];
};

type DoctorItem = {
  id: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
  languages?: string[];
  phone?: string | null;
  email?: string | null;
  license_number?: string | null;
  licensing_country?: string | null;
  licensing_valid_until?: string | null;
  notes?: string | null;
  patient_count: number;
  appointment_count: number;
};

type ServiceItem = {
  id: string;
  service_name: string;
  description?: string | null;
  price: unknown;
  currency: string;
  valid_from: string;
  valid_to?: string | null;
};

type LinkedPatient = {
  patient_id: string;
  first_name: string;
  last_name: string;
  appointment_count: number;
  leistung_count: number;
  last_interaction_at: string;
};

type InteractionItem = {
  kind: string;
  id: string;
  patient_name: string;
  doctor_name?: string | null;
  status: string;
  title: string;
  occurred_at: string;
};

type AppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  apt_type: string;
  status: string;
  patient_name: string;
  doctor_name?: string | null;
};

type ProviderTemplateItem = {
  id: string;
  provider_id: string;
  doctor_id?: string | null;
  doctor_name?: string | null;
  label: string;
  description?: string | null;
  art: string;
  category: string;
  default_auto_name: string;
  default_status: string;
  default_visibility: string;
  is_medical: boolean;
  supported_languages: string[];
  body_de?: string | null;
  body_en?: string | null;
  body_uk?: string | null;
  body_ru?: string | null;
  notes?: string | null;
  is_active: boolean;
  auto_send_on_confirmed_appointment: boolean;
  updated_at: string;
};

type ProviderTemplateFormState = {
  label: string;
  description: string;
  doctorId: string;
  art: string;
  category: string;
  defaultAutoName: string;
  defaultStatus: "draft" | "active" | "archived";
  defaultVisibility:
    | "internal"
    | "released_internal"
    | "released_external"
    | "patient_visible";
  isMedical: boolean;
  isActive: boolean;
  supportedLanguages: string[];
  bodyDe: string;
  bodyEn: string;
  bodyUk: string;
  bodyRu: string;
  notes: string;
  autoSendOnConfirmedAppointment: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v.includes("T") ? v : `${v}T00:00:00`));
  } catch { return v; }
}

function fieldVal(v: string | null | undefined, fb: string) {
  return v && v.trim() ? v : fb;
}

function card(extra?: string) {
  return cn("rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]", extra);
}

const inputClassName =
  "h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white";

const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:bg-white";

function emptyTemplateForm(): ProviderTemplateFormState {
  return {
    label: "",
    description: "",
    doctorId: "",
    art: "provider_template_instruction",
    category: "provider_template",
    defaultAutoName: "",
    defaultStatus: "draft",
    defaultVisibility: "patient_visible",
    isMedical: true,
    isActive: true,
    supportedLanguages: ["de"],
    bodyDe: "",
    bodyEn: "",
    bodyUk: "",
    bodyRu: "",
    notes: "",
    autoSendOnConfirmedAppointment: false,
  };
}

function templateToFormState(template: ProviderTemplateItem): ProviderTemplateFormState {
  return {
    label: template.label,
    description: template.description ?? "",
    doctorId: template.doctor_id ?? "",
    art: template.art,
    category: template.category,
    defaultAutoName: template.default_auto_name,
    defaultStatus:
      (template.default_status as ProviderTemplateFormState["defaultStatus"]) ??
      "draft",
    defaultVisibility:
      (template.default_visibility as ProviderTemplateFormState["defaultVisibility"]) ??
      "patient_visible",
    isMedical: template.is_medical,
    isActive: template.is_active,
    supportedLanguages: template.supported_languages,
    bodyDe: template.body_de ?? "",
    bodyEn: template.body_en ?? "",
    bodyUk: template.body_uk ?? "",
    bodyRu: template.body_ru ?? "",
    notes: template.notes ?? "",
    autoSendOnConfirmedAppointment:
      template.auto_send_on_confirmed_appointment ?? false,
  };
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</span>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Lbl>{label}</Lbl>
      <span className="text-sm text-slate-900">{value}</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  confirmed: "border-sky-200 bg-sky-50 text-sky-700",
  planned: "border-sky-200 bg-sky-50 text-sky-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  const { t } = useLang();

  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [version, setVersion] = useState(0);

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState<ProviderTemplateFormState>(
    () => emptyTemplateForm(),
  );
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState("");

  const canManage = user?.role === "ceo" || user?.role === "patient_manager";
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    apiFetch<ProviderDetail>(`/providers/${id}`)
      .then((d) => { if (!cancelled) startTransition(() => setDetail(d)); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, version]);

  useEffect(() => {
    if (!id || activeTab !== "appointments") return;
    let cancelled = false;

    apiFetch<AppointmentItem[]>(`/appointments?provider_id=${id}`)
      .then((r) => { if (!cancelled) setAppointments(r); })
      .catch(() => { if (!cancelled) setAppointments([]); })
      .finally(() => { if (!cancelled) setTabLoading(false); });

    return () => { cancelled = true; };
  }, [id, activeTab]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    const selectedTemplate = selectedTemplateId
      ? detail.templates.find((item) => item.id === selectedTemplateId) ?? null
      : null;
    if (selectedTemplate) {
      setCreatingTemplate(false);
      setTemplateForm(templateToFormState(selectedTemplate));
      return;
    }
    if (detail.templates.length > 0 && !creatingTemplate) {
      setSelectedTemplateId(detail.templates[0].id);
      return;
    }
    setSelectedTemplateId(null);
    setTemplateForm(emptyTemplateForm());
  }, [creatingTemplate, detail, selectedTemplateId]);

  async function saveTemplate() {
    if (!id) return;
    setTemplateBusy(true);
    setTemplateError("");
    try {
      const payload = {
        label: templateForm.label,
        description: templateForm.description || null,
        doctor_id: templateForm.doctorId || null,
        art: templateForm.art,
        category: templateForm.category,
        default_auto_name: templateForm.defaultAutoName,
        default_status: templateForm.defaultStatus,
        default_visibility: templateForm.defaultVisibility,
        is_medical: templateForm.isMedical,
        is_active: templateForm.isActive,
        supported_languages: templateForm.supportedLanguages,
        body_de: templateForm.bodyDe || null,
        body_en: templateForm.bodyEn || null,
        body_uk: templateForm.bodyUk || null,
        body_ru: templateForm.bodyRu || null,
        notes: templateForm.notes || null,
        auto_send_on_confirmed_appointment:
          templateForm.autoSendOnConfirmedAppointment,
      };
      if (selectedTemplateId) {
        await apiFetch(`/providers/${id}/templates/${selectedTemplateId}/update`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        const created = await apiFetch<{ id: string }>(`/providers/${id}/templates`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setCreatingTemplate(false);
        setSelectedTemplateId(created.id);
      }
      reload();
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : String(error));
    } finally {
      setTemplateBusy(false);
    }
  }

  function startNewTemplate() {
    setCreatingTemplate(true);
    setSelectedTemplateId(null);
    setTemplateError("");
    setTemplateForm(emptyTemplateForm());
  }

  function openTemplateEditor(template: ProviderTemplateItem) {
    setCreatingTemplate(false);
    setSelectedTemplateId(template.id);
    setTemplateError("");
    setTemplateForm(templateToFormState(template));
  }

  function toggleLanguage(language: string, checked: boolean) {
    setTemplateForm((current) => ({
      ...current,
      supportedLanguages: checked
        ? current.supportedLanguages.includes(language)
          ? current.supportedLanguages
          : [...current.supportedLanguages, language]
        : current.supportedLanguages.filter((item) => item !== language),
    }));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><LoaderCircle className="size-6 animate-spin text-slate-400" /></div>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="gap-2" onClick={() => staffGo("/providers")}><ArrowLeft className="size-4" /> {t.providers_title}</Button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || t.common_failed_load}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => staffGo("/providers")}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-12 rounded-full bg-sky-100 text-sky-700">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">{detail.name}</h1>
              {detail.legal_name && detail.legal_name !== detail.name ? (
                <p className="mt-1 text-sm font-medium text-slate-700">{detail.legal_name}</p>
              ) : null}
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <Badge variant="outline" className={cn("rounded-full", detail.provider_type === "non_medical" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-sky-200 bg-sky-50 text-sky-700")}>
                  {detail.provider_type === "non_medical" ? t.providers_type_non_medical : t.providers_type_medical}
                </Badge>
                <Badge variant="outline" className={cn("rounded-full", detail.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
                  {detail.is_active ? t.common_active : t.common_inactive}
                </Badge>
                {detail.fachbereich && <span>{detail.fachbereich}</span>}
                {detail.tax_id && <span>{`Tax ID ${detail.tax_id}`}</span>}
              </div>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={async () => {
              const path = detail.is_active ? `/providers/${id}/deactivate` : `/providers/${id}/activate`;
              await apiFetch(path, { method: "POST" }).catch(() => {});
              reload();
            }}>
              <UserX className="size-3.5" />
              {detail.is_active ? t.users_deactivate : t.users_activate}
            </Button>
          </div>
        )}
      </div>

      {/* Quick info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.providers_doctors}</Lbl>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{detail.doctors.length}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.providers_services}</Lbl>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{detail.services.length}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.providers_linked_patients}</Lbl>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{detail.linked_patients.length}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.providers_interactions}</Lbl>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{detail.interactions.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => {
        setActiveTab(value);
        if (value === "appointments") setTabLoading(true);
      }}>
        <div className="border-b border-slate-200 flex justify-center">
          <TabsList variant="line" className="w-auto">
            <TabsTrigger value="overview" className="px-4 py-2">{t.providers_detail}</TabsTrigger>
            <TabsTrigger value="doctors" className="px-4 py-2">{t.providers_doctors}</TabsTrigger>
            <TabsTrigger value="services" className="px-4 py-2">{t.providers_services}</TabsTrigger>
            <TabsTrigger value="templates" className="px-4 py-2">Templates</TabsTrigger>
            <TabsTrigger value="patients" className="px-4 py-2">{t.providers_linked_patients}</TabsTrigger>
            <TabsTrigger value="appointments" className="px-4 py-2">{t.appointments_title}</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6 mt-4 min-h-[400px]">
          <div className={card("p-6")}>
            <h2 className="text-sm font-semibold text-slate-950 mb-4">{t.providers_detail}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <InfoRow label={t.providers_street} value={fieldVal(detail.address_street, t.common_not_set)} />
              <InfoRow label={t.providers_city} value={fieldVal(detail.address_city, t.common_not_set)} />
              <InfoRow label={t.providers_zip} value={fieldVal(detail.address_zip, t.common_not_set)} />
              <InfoRow label={t.providers_country} value={fieldVal(detail.address_country, t.common_not_set)} />
              <InfoRow label={t.field_phone} value={fieldVal(detail.phone, t.common_not_set)} />
              <InfoRow label={t.field_email} value={fieldVal(detail.email, t.common_not_set)} />
              <InfoRow label="Legal name" value={fieldVal(detail.legal_name, t.common_not_set)} />
              <InfoRow label="Tax ID" value={fieldVal(detail.tax_id, t.common_not_set)} />
              <InfoRow label={t.providers_website} value={fieldVal(detail.website, t.common_not_set)} />
              <InfoRow label={t.providers_fachbereich} value={fieldVal(detail.fachbereich, t.common_not_set)} />
            </div>
          </div>
          {detail.notes && (
            <div className={card("p-6")}>
              <h2 className="text-sm font-semibold text-slate-950 mb-2">{t.providers_notes}</h2>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{detail.notes}</p>
            </div>
          )}
        </TabsContent>

        {/* Doctors */}
        <TabsContent value="doctors" className="mt-4 min-h-[400px]">
          {detail.doctors.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {detail.doctors.map((doc) => (
                <div key={doc.id} className={card("p-5")}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center size-10 rounded-full bg-sky-100 text-sky-700">
                      <Stethoscope className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{doc.title ? `${doc.title} ` : ""}{doc.name}</p>
                      <p className="text-xs text-slate-500">{doc.fachbereich || t.common_not_set}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div className="flex items-center gap-1"><Phone className="size-3" />{doc.phone || t.common_not_set}</div>
                    <div className="flex items-center gap-1"><Mail className="size-3" />{doc.email || t.common_not_set}</div>
                  </div>
                  {doc.languages && doc.languages.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {doc.languages.map((language) => (
                        <Badge key={`${doc.id}-${language}`} variant="outline" className="rounded-full border-slate-200 bg-white text-slate-700">
                          {language}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500">
                    <div>{`License ${doc.license_number || t.common_not_set}`}</div>
                    <div>{`Country ${doc.licensing_country || t.common_not_set}`}</div>
                    <div>{`Valid until ${fmtDate(doc.licensing_valid_until, t.common_not_set)}`}</div>
                  </div>
                  <div className="mt-3 flex gap-3 text-xs text-slate-400">
                    <span>{doc.patient_count} {t.providers_linked_patients}</span>
                    <span>{doc.appointment_count} {t.appointments_title}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Services */}
        <TabsContent value="services" className="mt-4 min-h-[400px]">
          {detail.services.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className={card("overflow-hidden")}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bg-slate-900">
                {[t.providers_service_name, t.providers_service_price, t.providers_service_valid_from, t.providers_service_valid_to].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{h}</span>
                ))}
              </div>
              {detail.services.map((svc, idx) => (
                <div key={svc.id} className={cn("grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-center px-5 py-3", idx < detail.services.length - 1 && "border-b border-border/30")}>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{svc.service_name}</p>
                    {svc.description && <p className="text-xs text-slate-500 mt-0.5">{svc.description}</p>}
                  </div>
                  <span className="text-sm text-slate-900">{String(svc.price)} {svc.currency}</span>
                  <span className="text-xs text-slate-500">{fmtDate(svc.valid_from, t.common_not_set)}</span>
                  <span className="text-xs text-slate-500">{fmtDate(svc.valid_to, t.common_not_set)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="mt-4 min-h-[400px]">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_1.4fr]">
            <div className={card("p-5")}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    Clinic templates
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Store provider-specific document templates for generation.
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={startNewTemplate}
                  >
                    New template
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-3">
                {detail.templates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No provider templates yet.
                  </div>
                ) : (
                  detail.templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={cn(
                        "w-full rounded-2xl border px-4 py-4 text-left transition",
                        selectedTemplateId === template.id
                          ? "border-sky-300 bg-sky-50/80 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300",
                      )}
                      onClick={() => openTemplateEditor(template)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            {template.label}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {template.description || template.default_auto_name}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full",
                            template.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-100 text-slate-600",
                          )}
                        >
                          {template.is_active ? t.common_active : t.common_inactive}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{template.art}</span>
                        {template.auto_send_on_confirmed_appointment ? (
                          <span>Auto-send on confirmation</span>
                        ) : null}
                        <span>· {template.category}</span>
                        {template.doctor_name ? (
                          <span>· {template.doctor_name}</span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {template.supported_languages.map((language) => (
                          <Badge
                            key={`${template.id}-${language}`}
                            variant="outline"
                            className="rounded-full border-slate-200 bg-white text-slate-700"
                          >
                            {language.toUpperCase()}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className={card("p-5")}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">
                    {selectedTemplateId ? "Edit template" : "Create template"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Generated documents will use the selected provider template
                    in the documents workspace.
                  </p>
                </div>
                {selectedTemplateId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={startNewTemplate}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>

              {templateError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {templateError}
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input
                    value={templateForm.label}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Default file name</Label>
                  <Input
                    value={templateForm.defaultAutoName}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        defaultAutoName: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Description</Label>
                  <textarea
                    value={templateForm.description}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className={textareaClassName}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Doctor binding</Label>
                  <select
                    value={templateForm.doctorId}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        doctorId: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">Any doctor in this clinic</option>
                    {detail.doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.title ? `${doctor.title} ` : ""}
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    value={templateForm.defaultStatus}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        defaultStatus:
                          event.target
                            .value as ProviderTemplateFormState["defaultStatus"],
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Document art</Label>
                  <Input
                    value={templateForm.art}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        art: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input
                    value={templateForm.category}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Visibility</Label>
                  <select
                    value={templateForm.defaultVisibility}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        defaultVisibility:
                          event.target
                            .value as ProviderTemplateFormState["defaultVisibility"],
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="patient_visible">patient_visible</option>
                    <option value="internal">internal</option>
                    <option value="released_internal">released_internal</option>
                    <option value="released_external">released_external</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-5 md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={templateForm.isMedical}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          isMedical: event.target.checked,
                        }))
                      }
                    />
                    Medical data
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={templateForm.isActive}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          isActive: event.target.checked,
                        }))
                      }
                    />
                    Active
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={templateForm.autoSendOnConfirmedAppointment}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          autoSendOnConfirmedAppointment: event.target.checked,
                        }))
                      }
                    />
                    Auto-send when appointment is confirmed
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <Lbl>Localized bodies</Lbl>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {[
                    ["de", "German", "bodyDe"],
                    ["en", "English", "bodyEn"],
                    ["uk", "Ukrainian", "bodyUk"],
                    ["ru", "Russian", "bodyRu"],
                  ].map(([language, label, field]) => {
                    const checked =
                      templateForm.supportedLanguages.includes(language);
                    return (
                      <div
                        key={language}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleLanguage(language, event.target.checked)
                            }
                          />
                          {label}
                        </label>
                        <textarea
                          value={
                            field === "bodyDe"
                              ? templateForm.bodyDe
                              : field === "bodyEn"
                                ? templateForm.bodyEn
                                : field === "bodyUk"
                                  ? templateForm.bodyUk
                                  : templateForm.bodyRu
                          }
                          onChange={(event) =>
                            setTemplateForm((current) => ({
                              ...current,
                              [field]: event.target.value,
                            }))
                          }
                          disabled={!checked}
                          placeholder="Use placeholders like {{patient_name}}, {{provider_name}}, {{appointment_date}}."
                          className={cn(
                            textareaClassName,
                            "mt-3 min-h-[140px]",
                            !checked && "opacity-60",
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <Label>Internal notes</Label>
                <textarea
                  value={templateForm.notes}
                  onChange={(event) =>
                    setTemplateForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={textareaClassName}
                />
              </div>

              {canManage ? (
                <div className="mt-6 flex justify-end">
                  <Button
                    className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                    onClick={() => void saveTemplate()}
                    disabled={templateBusy}
                  >
                    {templateBusy ? (
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {selectedTemplateId ? "Save template" : "Create template"}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  Read-only access. CEO or patient manager can edit clinic
                  templates.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Linked Patients */}
        <TabsContent value="patients" className="mt-4 min-h-[400px]">
          {detail.linked_patients.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.providers_no_patients}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {detail.linked_patients.map((p) => (
                <button key={p.patient_id} type="button" onClick={() => staffGo(`/patients/${p.patient_id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center size-10 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                      {p.first_name?.[0]?.toUpperCase()}{p.last_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{p.first_name} {p.last_name}</p>
                      <div className="flex gap-3 text-xs text-slate-400 mt-0.5">
                        <span>{p.appointment_count} {t.appointments_title}</span>
                        <span>{p.leistung_count} {t.providers_leistungen}</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{t.providers_last_activity}: {fmtDate(p.last_interaction_at)}</p>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Appointments */}
        <TabsContent value="appointments" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : appointments.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {appointments.map((a) => (
                <button key={a.id} type="button" onClick={() => staffGo(`/appointments?appointment=${a.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{a.apt_type}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[a.status] ?? "")}>{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{a.title}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{fmtDate(a.date)}</span>
                    {a.time_start && <span>{a.time_start}</span>}
                    <span>· {a.patient_name}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
