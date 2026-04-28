import { NativeComboboxSelect } from "@/components/ui/combobox-select";
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
import { checkboxClass, tokens } from "@/components/ui-shell";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { PROVIDER_DETAIL_STATUS_COLORS } from "./appearance/status-appearance";
import {
  createProviderTemplate,
  fetchProviderAppointments,
  fetchProviderRouteDetail,
  setProviderActive,
  updateProviderTemplate,
} from "./data/provider-api";
import {
  detailFieldValue,
  emptyTemplateForm,
  formatProviderDetailDate,
  templateToFormState,
} from "./model/detail-model";
import type {
  AppointmentItem,
  ProviderRouteDetail as ProviderDetail,
  ProviderTemplateFormState,
  ProviderTemplateItem,
} from "./model/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function card(extra?: string) {
  return cn("rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]", extra);
}

const inputClassName =
  "h-10 rounded-xl border border-slate-200 bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

const textareaClassName =
  "min-h-[104px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
const PROVIDER_DETAIL_REALTIME_EVENTS = [
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.template_created",
  "provider.template_updated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
] as const;

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { staffGo } = useStaffNavigate();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

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

  useRealtimeSubscription(PROVIDER_DETAIL_REALTIME_EVENTS, (event) => {
    if (!id || event.entity_type !== "provider" || event.entity_id !== id) return;
    clearApiCache(`/providers/${id}`);
    clearApiCache(`/providers/${id}/templates`);
    clearApiCache(`/providers/${id}/patients`);
    clearApiCache(`/appointments?provider_id=${id}`);
    startTransition(() => {
      setVersion((current) => current + 1);
    });
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetchProviderRouteDetail(id)
      .then((d) => { if (!cancelled) startTransition(() => setDetail(d)); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, version]);

  useEffect(() => {
    if (!id || activeTab !== "appointments") return;
    let cancelled = false;

    fetchProviderAppointments(id)
      .then((r) => { if (!cancelled) setAppointments(r); })
      .catch(() => { if (!cancelled) setAppointments([]); })
      .finally(() => { if (!cancelled) setTabLoading(false); });

    return () => { cancelled = true; };
  }, [id, activeTab, version]);

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
        await updateProviderTemplate(id, selectedTemplateId, payload);
      } else {
        const created = await createProviderTemplate(id, payload);
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
                {detail.tax_id && <span>{`${l("Steuer-ID", "Налоговый ID", "Tax ID")} ${detail.tax_id}`}</span>}
              </div>
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={async () => {
              await setProviderActive(detail.id, !detail.is_active).catch(() => {});
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
            <TabsTrigger value="templates" className="px-4 py-2">{l("Vorlagen", "Шаблоны", "Templates")}</TabsTrigger>
            <TabsTrigger value="patients" className="px-4 py-2">{t.providers_linked_patients}</TabsTrigger>
            <TabsTrigger value="appointments" className="px-4 py-2">{t.appointments_title}</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6 mt-4 min-h-[400px]">
          <div className={card("p-6")}>
            <h2 className="text-sm font-semibold text-slate-950 mb-4">{t.providers_detail}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <InfoRow label={t.providers_street} value={detailFieldValue(detail.address_street, t.common_not_set)} />
              <InfoRow label={t.providers_city} value={detailFieldValue(detail.address_city, t.common_not_set)} />
              <InfoRow label={t.providers_zip} value={detailFieldValue(detail.address_zip, t.common_not_set)} />
              <InfoRow label={t.providers_country} value={detailFieldValue(detail.address_country, t.common_not_set)} />
              <InfoRow label={t.field_phone} value={detailFieldValue(detail.phone, t.common_not_set)} />
              <InfoRow label={t.field_email} value={detailFieldValue(detail.email, t.common_not_set)} />
              <InfoRow label={l("Rechtlicher Name", "Юридическое название", "Legal name")} value={detailFieldValue(detail.legal_name, t.common_not_set)} />
              <InfoRow label={l("Steuer-ID", "Налоговый ID", "Tax ID")} value={detailFieldValue(detail.tax_id, t.common_not_set)} />
              <InfoRow label={t.providers_website} value={detailFieldValue(detail.website, t.common_not_set)} />
              <InfoRow label={t.providers_fachbereich} value={detailFieldValue(detail.fachbereich, t.common_not_set)} />
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
                    <div>{`${l("Lizenz", "Лицензия", "License")} ${doc.license_number || t.common_not_set}`}</div>
                    <div>{`${l("Land", "Страна", "Country")} ${doc.licensing_country || t.common_not_set}`}</div>
                    <div>{`${l("Gültig bis", "Действует до", "Valid until")} ${formatProviderDetailDate(doc.licensing_valid_until, t.common_not_set)}`}</div>
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
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-card px-5 py-2.5 font-mono">
                {[t.providers_service_name, t.providers_service_price, t.providers_service_valid_from, t.providers_service_valid_to].map((h) => (
                  <span key={h} className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/80">{h}</span>
                ))}
              </div>
              {detail.services.map((svc, idx) => (
                <div
                  key={svc.id}
                  className={cn(
                    "grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/45",
                    idx < detail.services.length - 1 && "border-b border-border/45",
                  )}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{svc.service_name}</p>
                    {svc.description && <p className="mt-0.5 text-xs text-muted-foreground">{svc.description}</p>}
                  </div>
                  <span className="text-sm tabular-nums text-foreground">{String(svc.price)} {svc.currency}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatProviderDetailDate(svc.valid_from, t.common_not_set)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatProviderDetailDate(svc.valid_to, t.common_not_set)}</span>
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
                    {l("Klinikvorlagen", "Шаблоны клиники", "Clinic templates")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {l("Speichern Sie anbieterbezogene Dokumentvorlagen für die Generierung.", "Сохраняйте шаблоны документов, специфичные для провайдера, для генерации.", "Store provider-specific document templates for generation.")}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={startNewTemplate}
                  >
                    {l("Neue Vorlage", "Новый шаблон", "New template")}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-3">
                {detail.templates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    {l("Noch keine Vorlagen für diesen Anbieter.", "Для этого провайдера пока нет шаблонов.", "No provider templates yet.")}
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
                          <span>{l("Automatisch bei Bestätigung senden", "Автоотправка при подтверждении", "Auto-send on confirmation")}</span>
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
                    {selectedTemplateId ? l("Vorlage bearbeiten", "Редактировать шаблон", "Edit template") : l("Vorlage erstellen", "Создать шаблон", "Create template")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {l(
                      "Generierte Dokumente verwenden die ausgewählte Anbietervorlage im Dokumentenbereich.",
                      "Сгенерированные документы будут использовать выбранный шаблон провайдера в разделе документов.",
                      "Generated documents will use the selected provider template in the documents workspace.",
                    )}
                  </p>
                </div>
                {selectedTemplateId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={startNewTemplate}
                  >
                    {l("Zurücksetzen", "Сбросить", "Reset")}
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
                  <Label>{l("Label", "Метка", "Label")}</Label>
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
                  <Label>{l("Standard-Dateiname", "Имя файла по умолчанию", "Default file name")}</Label>
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
                  <Label>{l("Beschreibung", "Описание", "Description")}</Label>
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
                  <Label>{l("Arztbindung", "Привязка к врачу", "Doctor binding")}</Label>
                  <NativeComboboxSelect
                    value={templateForm.doctorId}
                    onChange={(event) =>
                      setTemplateForm((current) => ({
                        ...current,
                        doctorId: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="">{l("Beliebiger Arzt dieser Klinik", "Любой врач этой клиники", "Any doctor in this clinic")}</option>
                    {detail.doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.title ? `${doctor.title} ` : ""}
                        {doctor.name}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </div>
                <div className="space-y-2">
                  <Label>{l("Status", "Статус", "Status")}</Label>
                  <NativeComboboxSelect
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
                    <option value="draft">{l("Entwurf", "Черновик", "Draft")}</option>
                    <option value="active">{l("Aktiv", "Активно", "Active")}</option>
                    <option value="archived">{l("Archiviert", "В архиве", "Archived")}</option>
                  </NativeComboboxSelect>
                </div>
                <div className="space-y-2">
                  <Label>{l("Dokumentart", "Тип документа", "Document art")}</Label>
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
                  <Label>{l("Kategorie", "Категория", "Category")}</Label>
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
                  <Label>{l("Sichtbarkeit", "Видимость", "Visibility")}</Label>
                  <NativeComboboxSelect
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
                    <option value="patient_visible">{l("Für Patienten sichtbar", "Видно пациенту", "Patient visible")}</option>
                    <option value="internal">{l("Intern", "Внутреннее", "Internal")}</option>
                    <option value="released_internal">{l("Intern freigegeben", "Внутренне опубликовано", "Released internal")}</option>
                    <option value="released_external">{l("Extern freigegeben", "Внешне опубликовано", "Released external")}</option>
                  </NativeComboboxSelect>
                </div>
                <div className="flex flex-wrap items-center gap-5 md:col-span-2">
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={templateForm.isMedical}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          isMedical: event.target.checked,
                        }))
                      }
                    />
                    {l("Medizinische Daten", "Медицинские данные", "Medical data")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={templateForm.isActive}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          isActive: event.target.checked,
                        }))
                      }
                    />
                    {l("Aktiv", "Активно", "Active")}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={templateForm.autoSendOnConfirmedAppointment}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          autoSendOnConfirmedAppointment: event.target.checked,
                        }))
                      }
                    />
                    {l("Automatisch senden, wenn der Termin bestätigt ist", "Автоотправка при подтверждении записи", "Auto-send when appointment is confirmed")}
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <Lbl>{l("Lokalisierte Inhalte", "Локализованные тексты", "Localized bodies")}</Lbl>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {[
                    ["de", l("Deutsch", "Немецкий", "German"), "bodyDe"],
                    ["en", l("Englisch", "Английский", "English"), "bodyEn"],
                    ["uk", l("Ukrainisch", "Украинский", "Ukrainian"), "bodyUk"],
                    ["ru", l("Russisch", "Русский", "Russian"), "bodyRu"],
                  ].map(([language, label, field]) => {
                    const checked =
                      templateForm.supportedLanguages.includes(language);
                    return (
                      <div
                        key={language}
                        className={cn("rounded-lg p-4", tokens.surface.mutedCard)}
                      >
                        <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                          <input
                            type="checkbox"
                            className={checkboxClass}
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
                          placeholder={l(
                            "Platzhalter wie {{patient_name}}, {{provider_name}}, {{appointment_date}} verwenden.",
                            "Используйте плейсхолдеры вроде {{patient_name}}, {{provider_name}}, {{appointment_date}}.",
                            "Use placeholders like {{patient_name}}, {{provider_name}}, {{appointment_date}}.",
                          )}
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
                <Label>{l("Interne Notizen", "Внутренние заметки", "Internal notes")}</Label>
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
                    {selectedTemplateId ? l("Vorlage speichern", "Сохранить шаблон", "Save template") : l("Vorlage erstellen", "Создать шаблон", "Create template")}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  {l("Nur Lesezugriff. CEO oder Patientenmanager können Klinikvorlagen bearbeiten.", "Только чтение. CEO или менеджер пациента могут редактировать шаблоны клиники.", "Read-only access. CEO or patient manager can edit clinic templates.")}
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
                  <p className="mt-2 text-xs text-slate-400">{t.providers_last_activity}: {formatProviderDetailDate(p.last_interaction_at)}</p>
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
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", PROVIDER_DETAIL_STATUS_COLORS[a.status] ?? "")}>{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{a.title}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{formatProviderDetailDate(a.date)}</span>
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
