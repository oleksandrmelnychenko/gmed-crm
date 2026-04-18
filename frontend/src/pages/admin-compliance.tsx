import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Download, ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, downloadApiFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Translations } from "@/lib/i18n";

interface ConsentTypeSummary {
  consent_type: string;
  total: number;
  active: number;
}

interface ConsentChange {
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  user_name: string;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface ConsentDashboard {
  total: number;
  granted_active: number;
  revoked: number;
  by_type: ConsentTypeSummary[];
  recent_changes: ConsentChange[];
}

interface ExpiredConsent {
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  user_name: string;
  consent_type: string;
  granted_at: string | null;
  expires_at: string | null;
}

interface PatientConsentRecord {
  id: string;
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  managed_by_name: string;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  note?: string | null;
  created_at: string;
}

interface RecordSummary {
  appointments?: number;
  cases?: number;
  orders?: number;
  documents?: number;
  invoices?: number;
  active_assignments?: number;
}

interface PrivacyRequestRecord {
  id: string;
  patient_id: string;
  patient_pid: string;
  patient_name: string;
  requested_by_name: string;
  reviewed_by_name?: string | null;
  executed_by_name?: string | null;
  request_type: string;
  source: string;
  status: string;
  reason?: string | null;
  due_at: string | null;
  retention_until: string | null;
  review_note?: string | null;
  requested_at: string;
  reviewed_at: string | null;
  executed_at: string | null;
  record_summary?: RecordSummary | null;
  manual_override: boolean;
  is_overdue: boolean;
}

type PrivacyRequestType = "erasure" | "restriction" | "third_party_revoke";
type PrivacyReviewAction = "approve" | "hold" | "reject";

const CONSENT_TYPE_VALUES = [
  "dsgvo_data_transfer",
  "schweigepflicht_release",
  "patient_portal_release",
  "treatment_contract",
  "third_party_sharing",
] as const;

const PRIVACY_REQUEST_TYPE_VALUES = [
  "erasure",
  "restriction",
  "third_party_revoke",
] as const;

function compactDt(dt: string | null | undefined): string {
  if (!dt) return "\u2014";
  return dt.split("T")[0] ?? dt;
}

function isPastDate(dt: string | null | undefined): boolean {
  if (!dt) return false;
  const timestamp = Date.parse(dt);
  if (Number.isNaN(timestamp)) return false;
  return timestamp < Date.now();
}

function consentTypeLabel(consentType: string, t: Translations): string {
  switch (consentType) {
    case "dsgvo_data_transfer":
      return t.compliance_consent_type_dsgvo;
    case "schweigepflicht_release":
      return t.compliance_consent_type_schweigepflicht;
    case "patient_portal_release":
      return t.compliance_consent_type_portal;
    case "treatment_contract":
      return t.compliance_consent_type_treatment;
    case "third_party_sharing":
      return t.compliance_consent_type_third_party;
    default:
      return consentType.replaceAll("_", " ");
  }
}

function privacyRequestTypeLabel(
  requestType: string,
  t: Translations,
): string {
  switch (requestType) {
    case "erasure":
      return t.compliance_request_type_erasure;
    case "restriction":
      return t.compliance_request_type_restriction;
    case "third_party_revoke":
      return t.compliance_request_type_third_party_revoke;
    default:
      return requestType.replaceAll("_", " ");
  }
}

function privacyStatusLabel(status: string, t: Translations) {
  switch (status) {
    case "requested":
      return t.compliance_privacy_status_requested;
    case "retention_hold":
      return t.compliance_privacy_status_retention_hold;
    case "approved":
      return t.compliance_privacy_status_approved;
    case "rejected":
      return t.compliance_privacy_status_rejected;
    case "completed":
      return t.compliance_privacy_status_completed;
    default:
      return status.replaceAll("_", " ");
  }
}

function privacyStatusBadgeClass(status: string) {
  switch (status) {
    case "requested":
      return "bg-amber-500/15 text-amber-700";
    case "retention_hold":
      return "bg-orange-500/15 text-orange-700";
    case "approved":
      return "bg-sky-500/15 text-sky-700";
    case "rejected":
      return "bg-slate-500/15 text-slate-700";
    case "completed":
      return "bg-green-500/15 text-green-700";
    default:
      return "bg-slate-500/15 text-slate-700";
  }
}

function patientLabel(patientPid?: string | null, patientName?: string | null) {
  const normalizedName = patientName?.trim();
  const normalizedPid = patientPid?.trim();
  if (normalizedPid && normalizedName) {
    return `${normalizedPid} · ${normalizedName}`;
  }
  return normalizedPid || normalizedName || "\u2014";
}

function recordSummaryLabel(summary?: RecordSummary | null) {
  if (!summary) {
    return "\u2014";
  }

  return [
    `A ${summary.appointments ?? 0}`,
    `C ${summary.cases ?? 0}`,
    `O ${summary.orders ?? 0}`,
    `D ${summary.documents ?? 0}`,
    `I ${summary.invoices ?? 0}`,
  ].join(" · ");
}

function privacyNotesLabel(record: PrivacyRequestRecord) {
  const parts = [record.reason?.trim(), record.review_note?.trim()].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" / ") : "\u2014";
}

function canExecutePrivacyRequest(
  role: string | null | undefined,
  requestType: string,
) {
  if (role === "ceo" || role === "it_admin") {
    return true;
  }

  return role === "patient_manager" && requestType === "third_party_revoke";
}

export function AdminCompliancePage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientParam = searchParams.get("patient") ?? "";

  const [dashboard, setDashboard] = useState<ConsentDashboard | null>(null);
  const [expired, setExpired] = useState<ExpiredConsent[]>([]);
  const [loading, setLoading] = useState(true);

  const [privacyQueue, setPrivacyQueue] = useState<PrivacyRequestRecord[]>([]);
  const [privacyQueueLoading, setPrivacyQueueLoading] = useState(true);

  const [patientInput, setPatientInput] = useState(patientParam);
  const [activePatientId, setActivePatientId] = useState(patientParam);
  const [patientConsents, setPatientConsents] = useState<
    PatientConsentRecord[]
  >([]);
  const [patientPrivacyRequests, setPatientPrivacyRequests] = useState<
    PrivacyRequestRecord[]
  >([]);
  const [patientLoading, setPatientLoading] = useState(false);
  const [patientError, setPatientError] = useState("");

  const [consentType, setConsentType] = useState<string>(
    CONSENT_TYPE_VALUES[0],
  );
  const [consentNote, setConsentNote] = useState("");
  const [consentExpiresAt, setConsentExpiresAt] = useState("");
  const [consentBusy, setConsentBusy] = useState<"grant" | "revoke" | null>(
    null,
  );

  const [privacyRequestType, setPrivacyRequestType] =
    useState<PrivacyRequestType>("erasure");
  const [privacyReason, setPrivacyReason] = useState("");
  const [privacyCreateBusy, setPrivacyCreateBusy] = useState(false);
  const [privacyActionBusy, setPrivacyActionBusy] = useState<string | null>(
    null,
  );

  const [exportResult, setExportResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const activePatientLabel = useMemo(() => {
    const latestConsent = patientConsents[0];
    if (latestConsent) {
      return patientLabel(
        latestConsent.patient_pid,
        latestConsent.patient_name,
      );
    }

    const latestPrivacyRequest = patientPrivacyRequests[0];
    if (latestPrivacyRequest) {
      return patientLabel(
        latestPrivacyRequest.patient_pid,
        latestPrivacyRequest.patient_name,
      );
    }

    return activePatientId || "\u2014";
  }, [activePatientId, patientConsents, patientPrivacyRequests]);

  const privacyCounters = useMemo(() => {
    const requested = privacyQueue.filter(
      (record) => record.status === "requested",
    ).length;
    const retentionHold = privacyQueue.filter(
      (record) => record.status === "retention_hold",
    ).length;
    const approved = privacyQueue.filter(
      (record) => record.status === "approved",
    ).length;
    const overdue = privacyQueue.filter(
      (record) =>
        record.is_overdue &&
        (record.status === "requested" ||
          record.status === "retention_hold" ||
          record.status === "approved"),
    ).length;

    return {
      requested,
      retentionHold,
      approved,
      overdue,
      open: requested + retentionHold + approved,
    };
  }, [privacyQueue]);

  const syncPatientQuery = useCallback(
    (value: string) => {
      const normalized = value.trim();
      const current = searchParams.get("patient") ?? "";
      if (normalized === current) {
        return;
      }

      const next = new URLSearchParams(searchParams);
      if (normalized) {
        next.set("patient", normalized);
      } else {
        next.delete("patient");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const loadConsentDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, exp] = await Promise.all([
        apiFetch<ConsentDashboard>("/admin/compliance/consents"),
        apiFetch<ExpiredConsent[]>("/admin/compliance/consents/expired"),
      ]);
      setDashboard(dash);
      setExpired(exp);
    } catch {
      setDashboard(null);
      setExpired([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrivacyQueue = useCallback(async () => {
    setPrivacyQueueLoading(true);
    try {
      const items = await apiFetch<PrivacyRequestRecord[]>(
        "/admin/compliance/privacy-requests",
      );
      setPrivacyQueue(items);
    } catch {
      setPrivacyQueue([]);
    } finally {
      setPrivacyQueueLoading(false);
    }
  }, []);

  const loadPatientWorkspace = useCallback(async (patientId: string) => {
    setPatientLoading(true);
    setPatientError("");

    try {
      const [consents, privacyRequests] = await Promise.all([
        apiFetch<PatientConsentRecord[]>(
          `/admin/compliance/patient/${patientId}/consents`,
        ),
        apiFetch<PrivacyRequestRecord[]>(
          `/admin/compliance/patient/${patientId}/privacy-requests`,
        ),
      ]);
      setPatientConsents(consents);
      setPatientPrivacyRequests(privacyRequests);
    } catch (error) {
      setPatientConsents([]);
      setPatientPrivacyRequests([]);
      setPatientError(error instanceof Error ? error.message : String(error));
    } finally {
      setPatientLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConsentDashboard();
    void loadPrivacyQueue();
  }, [loadConsentDashboard, loadPrivacyQueue]);

  useEffect(() => {
    if (!patientParam || patientParam === activePatientId) {
      return;
    }

    setPatientInput(patientParam);
    setActivePatientId(patientParam);
    void loadPatientWorkspace(patientParam);
  }, [activePatientId, loadPatientWorkspace, patientParam]);

  const handleLoadPatientRegister = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const targetPatientId = patientInput.trim();
    setActionError("");

    if (!targetPatientId) {
      setActivePatientId("");
      setPatientConsents([]);
      setPatientPrivacyRequests([]);
      setPatientError("");
      syncPatientQuery("");
      return;
    }

    syncPatientQuery(targetPatientId);
    setActivePatientId(targetPatientId);
    await loadPatientWorkspace(targetPatientId);
  };

  const handleConsentAction = async (action: "grant" | "revoke") => {
    const targetPatientId = (activePatientId || patientInput).trim();
    if (!targetPatientId) {
      setActionError(t.compliance_uuid_required);
      return;
    }

    setConsentBusy(action);
    setActionError("");

    try {
      await apiFetch(`/admin/compliance/patient/${targetPatientId}/consents`, {
        method: "POST",
        body: JSON.stringify({
          consent_type: consentType,
          action,
          note: consentNote.trim() || undefined,
          expires_at:
            action === "grant" ? consentExpiresAt.trim() || undefined : undefined,
        }),
      });

      setActivePatientId(targetPatientId);
      setConsentNote("");
      setConsentExpiresAt("");
      syncPatientQuery(targetPatientId);
      await Promise.all([
        loadConsentDashboard(),
        loadPatientWorkspace(targetPatientId),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConsentBusy(null);
    }
  };

  const handleCreatePrivacyRequest = async () => {
    const targetPatientId = (activePatientId || patientInput).trim();
    if (!targetPatientId) {
      setActionError(t.compliance_uuid_required);
      return;
    }

    setPrivacyCreateBusy(true);
    setActionError("");

    try {
      await apiFetch(
        `/admin/compliance/patient/${targetPatientId}/privacy-requests`,
        {
          method: "POST",
          body: JSON.stringify({
            request_type: privacyRequestType,
            source: "patient_request",
            reason: privacyReason.trim() || undefined,
          }),
        },
      );

      setActivePatientId(targetPatientId);
      setPrivacyReason("");
      syncPatientQuery(targetPatientId);
      await Promise.all([
        loadPrivacyQueue(),
        loadPatientWorkspace(targetPatientId),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrivacyCreateBusy(false);
    }
  };

  const handleReviewPrivacyRequest = async (
    requestId: string,
    patientId: string,
    action: PrivacyReviewAction,
  ) => {
    const busyToken = `${requestId}:${action}`;
    setPrivacyActionBusy(busyToken);
    setActionError("");

    try {
      await apiFetch(`/admin/compliance/privacy-requests/${requestId}/review`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });

      await Promise.all([
        loadPrivacyQueue(),
        activePatientId === patientId
          ? loadPatientWorkspace(patientId)
          : Promise.resolve(),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrivacyActionBusy(null);
    }
  };

  const handleExecutePrivacyRequest = async (
    requestId: string,
    patientId: string,
    requestType: string,
  ) => {
    if (
      requestType === "erasure" &&
      !window.confirm(t.compliance_anonymize_confirm)
    ) {
      return;
    }

    const busyToken = `${requestId}:execute`;
    setPrivacyActionBusy(busyToken);
    setActionError("");

    try {
      const payload = await apiFetch<unknown>(
        `/admin/compliance/privacy-requests/${requestId}/execute`,
        { method: "POST" },
      );
      setExportResult(JSON.stringify(payload, null, 2));

      await Promise.all([
        loadPrivacyQueue(),
        loadConsentDashboard(),
        activePatientId === patientId
          ? loadPatientWorkspace(patientId)
          : Promise.resolve(),
      ]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPrivacyActionBusy(null);
    }
  };

  const doExport = async () => {
    const targetPatientId = (activePatientId || patientInput).trim();
    if (!targetPatientId) {
      setActionError(t.compliance_uuid_required);
      return;
    }

    setActionError("");
    setExportResult(null);

    try {
      const filename = await downloadApiFile(
        `/admin/compliance/patient/${targetPatientId}/export?format=zip`,
        `${targetPatientId}-dsgvo-export.zip`,
      );
      setExportResult(`${t.compliance_downloaded} ${filename}`);
    } catch (error) {
      setExportResult(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const stats = [
    { label: t.compliance_consents, value: dashboard?.total ?? 0 },
    { label: t.compliance_granted, value: dashboard?.granted_active ?? 0 },
    { label: t.compliance_revoked, value: dashboard?.revoked ?? 0 },
    { label: t.compliance_expired, value: expired.length },
    { label: t.compliance_stat_privacy_queue, value: privacyCounters.open },
    {
      label: t.compliance_stat_ready_for_execution,
      value: privacyCounters.approved,
    },
    {
      label: t.compliance_stat_overdue_privacy,
      value: privacyCounters.overdue,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.compliance_title}</h1>
        <p className="text-muted-foreground text-sm">{t.compliance_subtitle}</p>
      </div>
      {loading ? (
        <p className="text-muted-foreground py-10 text-center">
          {t.common_loading}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
            {stats.map((item) => (
              <div key={item.label} className="rounded-xl border bg-white p-5">
                <p className="text-muted-foreground text-xs">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>

          {actionError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}

          <div className="rounded-xl border bg-white p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {t.compliance_patient_register_title}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t.compliance_patient_register_hint}
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {activePatientLabel}
              </div>
            </div>

            <form
              className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={handleLoadPatientRegister}
            >
              <div className="space-y-1">
                <Label htmlFor="compliance-patient-id">
                  {t.compliance_patient_id} (UUID)
                </Label>
                <Input
                  id="compliance-patient-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={patientInput}
                  onChange={(event) => setPatientInput(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full md:w-auto">
                  {t.compliance_load_register}
                </Button>
              </div>
            </form>

            {patientError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {patientError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_220px_auto]">
              <div className="space-y-1">
                <Label htmlFor="consent-type">
                  {t.compliance_consent_type_label}
                </Label>
                <select
                  id="consent-type"
                  value={consentType}
                  onChange={(event) => setConsentType(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  {CONSENT_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {consentTypeLabel(value, t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="consent-note">
                  {t.compliance_operational_note}
                </Label>
                <textarea
                  id="consent-note"
                  value={consentNote}
                  onChange={(event) => setConsentNote(event.target.value)}
                  placeholder={t.compliance_consent_note_placeholder}
                  rows={3}
                  className="min-h-[92px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="consent-expires-at">
                  {t.compliance_expiry_date}
                </Label>
                <Input
                  id="consent-expires-at"
                  type="date"
                  value={consentExpiresAt}
                  onChange={(event) => setConsentExpiresAt(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t.compliance_expiry_hint}
                </p>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  disabled={consentBusy !== null}
                  onClick={() => void handleConsentAction("grant")}
                >
                  {consentBusy === "grant"
                    ? t.compliance_saving
                    : t.compliance_grant_consent}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={consentBusy !== null}
                  onClick={() => void handleConsentAction("revoke")}
                >
                  {consentBusy === "revoke"
                    ? t.compliance_saving
                    : t.compliance_revoke_consent}
                </Button>
              </div>
            </div>

            <div className="mt-6 rounded-xl border">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-950">
                  {t.compliance_consent_history}
                  {activePatientId ? ` — ${activePatientId}` : ""}
                </h3>
              </div>

              {patientLoading ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {t.common_loading}
                </p>
              ) : patientConsents.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {activePatientId
                    ? t.compliance_no_consent_events
                    : t.compliance_load_patient_consent_hint}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.compliance_col_consent}</TableHead>
                      <TableHead>{t.compliance_col_status}</TableHead>
                      <TableHead>{t.compliance_col_managed_by}</TableHead>
                      <TableHead>{t.compliance_col_effective_at}</TableHead>
                      <TableHead>{t.compliance_col_expires}</TableHead>
                      <TableHead>{t.compliance_col_note}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientConsents.map((record) => {
                      const isRevoked = Boolean(record.revoked_at) && !record.granted;
                      const isExpired =
                        !isRevoked && record.granted && isPastDate(record.expires_at);
                      const badgeClass = isRevoked
                        ? "bg-red-500/15 text-red-700"
                        : isExpired
                          ? "bg-amber-500/15 text-amber-700"
                        : record.granted
                          ? "bg-green-500/15 text-green-700"
                          : "bg-slate-500/15 text-slate-700";
                      const effectiveAt = isRevoked
                        ? compactDt(record.revoked_at)
                        : compactDt(record.granted_at ?? record.created_at);

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">
                            {consentTypeLabel(record.consent_type, t)}
                          </TableCell>
                          <TableCell>
                            <Badge className={badgeClass}>
                              {isRevoked
                                ? t.compliance_revoked
                                : isExpired
                                  ? t.compliance_expired
                                : t.compliance_granted}
                            </Badge>
                          </TableCell>
                          <TableCell>{record.managed_by_name}</TableCell>
                          <TableCell className="font-mono text-sm text-slate-500">
                            {effectiveAt}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-slate-500">
                            {compactDt(record.expires_at)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {typeof record.note === "string" &&
                            record.note.trim()
                              ? record.note
                              : "\u2014"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {t.compliance_privacy_requests_title}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t.compliance_privacy_requests_hint}
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {activePatientLabel}
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
              <div className="space-y-1">
                <Label htmlFor="privacy-request-type">
                  {t.compliance_request_type_label}
                </Label>
                <select
                  id="privacy-request-type"
                  value={privacyRequestType}
                  onChange={(event) =>
                    setPrivacyRequestType(event.target.value as PrivacyRequestType)
                  }
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  {PRIVACY_REQUEST_TYPE_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {privacyRequestTypeLabel(value, t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="privacy-request-reason">
                  {t.compliance_request_reason}
                </Label>
                <textarea
                  id="privacy-request-reason"
                  value={privacyReason}
                  onChange={(event) => setPrivacyReason(event.target.value)}
                  placeholder={t.compliance_request_reason_placeholder}
                  rows={3}
                  className="min-h-[92px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  disabled={privacyCreateBusy}
                  onClick={() => void handleCreatePrivacyRequest()}
                >
                  {privacyCreateBusy
                    ? t.compliance_saving
                    : t.compliance_create_request}
                </Button>
                <p className="text-muted-foreground max-w-40 text-xs">
                  {t.compliance_new_request_hint}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-950">
                  {t.compliance_privacy_history}
                  {activePatientId ? ` — ${activePatientId}` : ""}
                </h3>
              </div>

              {patientLoading ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {t.common_loading}
                </p>
              ) : patientPrivacyRequests.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {activePatientId
                    ? t.compliance_no_privacy_requests
                    : t.compliance_load_patient_privacy_hint}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.compliance_col_request}</TableHead>
                      <TableHead>{t.compliance_col_status}</TableHead>
                      <TableHead>{t.compliance_col_requested_by}</TableHead>
                      <TableHead>{t.compliance_col_due}</TableHead>
                      <TableHead>{t.compliance_col_retention_until}</TableHead>
                      <TableHead>{t.compliance_col_linked_records}</TableHead>
                      <TableHead>{t.compliance_col_notes}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientPrivacyRequests.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell className="font-medium">
                          <div>{privacyRequestTypeLabel(record.request_type, t)}</div>
                          <div className="text-xs text-slate-500">
                            {t.compliance_created_label}{" "}
                            {compactDt(record.requested_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <Badge className={privacyStatusBadgeClass(record.status)}>
                              {privacyStatusLabel(record.status, t)}
                            </Badge>
                            {record.manual_override ? (
                              <span className="text-xs text-slate-500">
                                {t.compliance_manual_override}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{record.requested_by_name}</TableCell>
                        <TableCell className="font-mono text-sm text-slate-500">
                          {compactDt(record.due_at)}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-500">
                          {compactDt(record.retention_until)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {recordSummaryLabel(record.record_summary)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {privacyNotesLabel(record)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 text-lg font-semibold">
              {t.compliance_export}
            </h2>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label>{t.compliance_patient_id} (UUID)</Label>
                <Input
                  placeholder={t.compliance_uses_loaded_uuid}
                  value={patientInput}
                  onChange={(event) => setPatientInput(event.target.value)}
                />
              </div>
              <Button type="button" onClick={() => void doExport()}>
                <Download className="mr-1 size-4" />
                {t.compliance_export}
              </Button>
            </div>
            {exportResult ? (
              <pre className="bg-muted mt-4 max-h-72 overflow-auto rounded p-3 text-xs">
                {exportResult}
              </pre>
            ) : null}
          </div>

          {dashboard && dashboard.by_type.length > 0 ? (
            <div className="rounded-xl border bg-white">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold">
                  {t.compliance_consents}
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.compliance_col_type}</TableHead>
                    <TableHead>{t.compliance_col_total}</TableHead>
                    <TableHead>{t.compliance_granted}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.by_type.map((entry) => (
                    <TableRow key={entry.consent_type}>
                      <TableCell className="font-medium">
                        {consentTypeLabel(entry.consent_type, t)}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.total}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-green-500/15 text-green-700">
                          {entry.active}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="rounded-xl border bg-white">
            <div className="flex flex-col gap-2 border-b px-6 py-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {t.compliance_privacy_review_queue}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {t.compliance_stat_requested} {privacyCounters.requested} ·{" "}
                  {t.compliance_stat_hold} {privacyCounters.retentionHold} ·{" "}
                  {t.compliance_stat_approved} {privacyCounters.approved} ·{" "}
                  {t.compliance_stat_overdue} {privacyCounters.overdue}
                </p>
              </div>
            </div>

            {privacyQueueLoading ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                {t.common_loading}
              </p>
            ) : privacyQueue.length === 0 ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                {t.compliance_no_privacy_scope}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.compliance_col_patient}</TableHead>
                    <TableHead>{t.compliance_col_request}</TableHead>
                    <TableHead>{t.compliance_col_status}</TableHead>
                    <TableHead>{t.compliance_col_due}</TableHead>
                    <TableHead>{t.compliance_col_linked_records}</TableHead>
                    <TableHead>{t.compliance_col_notes}</TableHead>
                    <TableHead>{t.compliance_col_actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {privacyQueue.map((record) => {
                    const executeBusy =
                      privacyActionBusy === `${record.id}:execute`;
                    const approveBusy =
                      privacyActionBusy === `${record.id}:approve`;
                    const holdBusy = privacyActionBusy === `${record.id}:hold`;
                    const rejectBusy =
                      privacyActionBusy === `${record.id}:reject`;

                    return (
                      <TableRow key={record.id}>
                        <TableCell className="font-medium">
                          {patientLabel(
                            record.patient_pid,
                            record.patient_name,
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>
                            {privacyRequestTypeLabel(record.request_type, t)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {record.source.replaceAll("_", " ")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <Badge
                              className={privacyStatusBadgeClass(record.status)}
                            >
                              {privacyStatusLabel(record.status, t)}
                            </Badge>
                            {record.is_overdue &&
                            (record.status === "requested" ||
                              record.status === "retention_hold" ||
                              record.status === "approved") ? (
                              <span className="text-xs font-medium text-red-600">
                                {t.compliance_stat_overdue}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-500">
                          {compactDt(record.due_at)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {recordSummaryLabel(record.record_summary)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {privacyNotesLabel(record)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {record.status === "requested" ||
                            record.status === "retention_hold" ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={privacyActionBusy !== null}
                                  onClick={() =>
                                    void handleReviewPrivacyRequest(
                                      record.id,
                                      record.patient_id,
                                      "approve",
                                    )
                                  }
                                >
                                  {approveBusy
                                    ? t.compliance_saving
                                    : t.compliance_approve}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={privacyActionBusy !== null}
                                  onClick={() =>
                                    void handleReviewPrivacyRequest(
                                      record.id,
                                      record.patient_id,
                                      "hold",
                                    )
                                  }
                                >
                                  {holdBusy
                                    ? t.compliance_saving
                                    : t.compliance_hold}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={privacyActionBusy !== null}
                                  onClick={() =>
                                    void handleReviewPrivacyRequest(
                                      record.id,
                                      record.patient_id,
                                      "reject",
                                    )
                                  }
                                >
                                  {rejectBusy
                                    ? t.compliance_saving
                                    : t.compliance_reject}
                                </Button>
                              </>
                            ) : null}

                            {record.status === "approved" &&
                            canExecutePrivacyRequest(
                              user?.role,
                              record.request_type,
                            ) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant={
                                  record.request_type === "erasure"
                                    ? "destructive"
                                    : "outline"
                                }
                                disabled={privacyActionBusy !== null}
                                onClick={() =>
                                  void handleExecutePrivacyRequest(
                                    record.id,
                                    record.patient_id,
                                    record.request_type,
                                  )
                                }
                              >
                                {record.request_type === "erasure" ? (
                                  <ShieldAlert className="mr-1 size-4" />
                                ) : null}
                                {executeBusy
                                  ? t.compliance_executing
                                  : t.compliance_execute}
                              </Button>
                            ) : null}

                            {record.status === "completed" &&
                            record.executed_at ? (
                              <span className="text-xs text-slate-500">
                                {t.compliance_executed_label}{" "}
                                {compactDt(record.executed_at)}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="rounded-xl border bg-white">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                {t.compliance_expired_consents} ({expired.length})
              </h2>
            </div>
            {expired.length === 0 ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                {t.compliance_no_expired}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.compliance_col_patient}</TableHead>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>{t.compliance_col_type}</TableHead>
                    <TableHead>{t.compliance_col_expired_at}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expired.map((item) => (
                    <TableRow
                      key={`${item.patient_id}-${item.consent_type}-${item.expires_at ?? item.granted_at}`}
                    >
                      <TableCell className="font-medium">
                        {patientLabel(item.patient_pid, item.patient_name)}
                      </TableCell>
                      <TableCell>{item.user_name}</TableCell>
                      <TableCell>
                        {consentTypeLabel(item.consent_type, t)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-500">
                        {compactDt(item.expires_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {dashboard && dashboard.recent_changes.length > 0 ? (
            <div className="rounded-xl border bg-white">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold">{t.compliance_recent}</h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.compliance_col_patient}</TableHead>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>{t.compliance_col_type}</TableHead>
                    <TableHead>{t.users_status}</TableHead>
                    <TableHead>{t.activity_time}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recent_changes.map((item) => {
                    const isRevoked = Boolean(item.revoked_at) && !item.granted;
                    const badgeCls = isRevoked
                      ? "bg-red-500/15 text-red-700"
                      : item.granted
                        ? "bg-green-500/15 text-green-700"
                        : "bg-slate-500/15 text-slate-700";
                    const label = isRevoked
                      ? t.compliance_revoked
                      : t.compliance_granted;
                    const timestamp = isRevoked
                      ? compactDt(item.revoked_at)
                      : compactDt(item.granted_at);

                    return (
                      <TableRow
                        key={`${item.patient_id}-${item.consent_type}-${item.granted_at ?? item.revoked_at}`}
                      >
                        <TableCell className="font-medium">
                          {patientLabel(item.patient_pid, item.patient_name)}
                        </TableCell>
                        <TableCell>{item.user_name}</TableCell>
                        <TableCell>
                          {consentTypeLabel(item.consent_type, t)}
                        </TableCell>
                        <TableCell>
                          <Badge className={badgeCls}>{label}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-500">
                          {timestamp}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
