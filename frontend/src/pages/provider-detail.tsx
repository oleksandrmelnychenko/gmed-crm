import {
  startTransition,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderDetail = {
  id: string;
  name: string;
  provider_type: string;
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
};

type DoctorItem = {
  id: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
  phone?: string | null;
  email?: string | null;
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLang();

  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [version, setVersion] = useState(0);

  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

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

  if (loading) {
    return <div className="flex items-center justify-center py-20"><LoaderCircle className="size-6 animate-spin text-slate-400" /></div>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="gap-2" onClick={() => navigate("/providers")}><ArrowLeft className="size-4" /> {t.providers_title}</Button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || t.common_failed_load}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate("/providers")}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-12 rounded-full bg-sky-100 text-sky-700">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">{detail.name}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <Badge variant="outline" className={cn("rounded-full", detail.provider_type === "non_medical" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-sky-200 bg-sky-50 text-sky-700")}>
                  {detail.provider_type === "non_medical" ? t.providers_type_non_medical : t.providers_type_medical}
                </Badge>
                <Badge variant="outline" className={cn("rounded-full", detail.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
                  {detail.is_active ? t.common_active : t.common_inactive}
                </Badge>
                {detail.fachbereich && <span>{detail.fachbereich}</span>}
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

        {/* Linked Patients */}
        <TabsContent value="patients" className="mt-4 min-h-[400px]">
          {detail.linked_patients.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.providers_no_patients}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {detail.linked_patients.map((p) => (
                <button key={p.patient_id} type="button" onClick={() => navigate(`/patients/${p.patient_id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
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
                <button key={a.id} type="button" onClick={() => navigate(`/appointments?appointment=${a.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
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
