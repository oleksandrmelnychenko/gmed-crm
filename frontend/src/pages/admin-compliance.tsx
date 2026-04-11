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
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

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

const CONSENT_TYPE_OPTIONS = [
  { value: "dsgvo_data_transfer", label: "DSGVO data transfer" },
  { value: "schweigepflicht_release", label: "Schweigepflicht release" },
  { value: "patient_portal_release", label: "Patient portal release" },
  { value: "treatment_contract", label: "Treatment contract" },
  { value: "third_party_sharing", label: "Third-party sharing" },
] as const;

const PRIVACY_REQUEST_TYPE_OPTIONS = [
  { value: "erasure", label: "Erasure request" },
  { value: "restriction", label: "Processing restriction" },
  { value: "third_party_revoke", label: "Third-party sharing revoke" },
] as const;

function compactDt(dt: string | null | undefined): string {
  if (!dt) return "\u2014";
  return dt.split("T")[0] ?? dt;
}

function consentTypeLabel(consentType: string) {
  return (
    CONSENT_TYPE_OPTIONS.find((option) => option.value === consentType)
      ?.label ?? consentType.replaceAll("_", " ")
  );
}

function privacyRequestTypeLabel(requestType: string) {
  return (
    PRIVACY_REQUEST_TYPE_OPTIONS.find((option) => option.value === requestType)
      ?.label ?? requestType.replaceAll("_", " ")
  );
}

function privacyStatusLabel(status: string) {
  switch (status) {
    case "requested":
      return "Requested";
    case "retention_hold":
      return "Retention hold";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
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

export function AdminCompliancePage() {
  const { t } = useLang();
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
    CONSENT_TYPE_OPTIONS[0].value,
  );
  const [consentNote, setConsentNote] = useState("");
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
      setActionError("Patient UUID is required.");
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
        }),
      });

      setActivePatientId(targetPatientId);
      setConsentNote("");
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
      setActionError("Patient UUID is required.");
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
      setActionError("Patient UUID is required.");
      return;
    }

    setActionError("");
    setExportResult(null);

    try {
      const data = await apiFetch<unknown>(
        `/admin/compliance/patient/${targetPatientId}/export`,
      );
      setExportResult(JSON.stringify(data, null, 2));
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
    { label: "Privacy queue", value: privacyCounters.open },
    { label: "Ready for execution", value: privacyCounters.approved },
    { label: "Overdue privacy", value: privacyCounters.overdue },
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
                  Patient consent register
                </h2>
                <p className="text-muted-foreground text-sm">
                  Load a patient workspace, then grant or revoke agency-wide
                  consents.
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
                  Load register
                </Button>
              </div>
            </form>

            {patientError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {patientError}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
              <div className="space-y-1">
                <Label htmlFor="consent-type">Consent type</Label>
                <select
                  id="consent-type"
                  value={consentType}
                  onChange={(event) => setConsentType(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  {CONSENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="consent-note">Operational note</Label>
                <textarea
                  id="consent-note"
                  value={consentNote}
                  onChange={(event) => setConsentNote(event.target.value)}
                  placeholder="Patient requested revocation, signed in clinic, portal release confirmed"
                  rows={3}
                  className="min-h-[92px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  disabled={consentBusy !== null}
                  onClick={() => void handleConsentAction("grant")}
                >
                  {consentBusy === "grant" ? "Saving..." : "Grant consent"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={consentBusy !== null}
                  onClick={() => void handleConsentAction("revoke")}
                >
                  {consentBusy === "revoke" ? "Saving..." : "Revoke consent"}
                </Button>
              </div>
            </div>

            <div className="mt-6 rounded-xl border">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-950">
                  Consent history{" "}
                  {activePatientId ? `for ${activePatientId}` : ""}
                </h3>
              </div>

              {patientLoading ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {t.common_loading}
                </p>
              ) : patientConsents.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {activePatientId
                    ? "No consent events recorded for this patient yet."
                    : "Load a patient to view consent history."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consent</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Managed by</TableHead>
                      <TableHead>Effective at</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientConsents.map((record) => {
                      const isRevoked =
                        Boolean(record.revoked_at) && !record.granted;
                      const badgeClass = isRevoked
                        ? "bg-red-500/15 text-red-700"
                        : record.granted
                          ? "bg-green-500/15 text-green-700"
                          : "bg-slate-500/15 text-slate-700";
                      const effectiveAt = isRevoked
                        ? compactDt(record.revoked_at)
                        : compactDt(record.granted_at ?? record.created_at);

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">
                            {consentTypeLabel(record.consent_type)}
                          </TableCell>
                          <TableCell>
                            <Badge className={badgeClass}>
                              {isRevoked
                                ? t.compliance_revoked
                                : t.compliance_granted}
                            </Badge>
                          </TableCell>
                          <TableCell>{record.managed_by_name}</TableCell>
                          <TableCell className="font-mono text-sm text-slate-500">
                            {effectiveAt}
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
                <h2 className="text-lg font-semibold">Patient privacy requests</h2>
                <p className="text-muted-foreground text-sm">
                  Register erasure or processing-restriction requests and inspect retention context
                  before execution.
                </p>
              </div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {activePatientLabel}
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]">
              <div className="space-y-1">
                <Label htmlFor="privacy-request-type">Request type</Label>
                <select
                  id="privacy-request-type"
                  value={privacyRequestType}
                  onChange={(event) =>
                    setPrivacyRequestType(event.target.value as PrivacyRequestType)
                  }
                  className="h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                >
                  {PRIVACY_REQUEST_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="privacy-request-reason">Reason / intake note</Label>
                <textarea
                  id="privacy-request-reason"
                  value={privacyReason}
                  onChange={(event) => setPrivacyReason(event.target.value)}
                  placeholder="Patient requested deletion, legal restriction request, courier confirmed signed withdrawal"
                  rows={3}
                  className="min-h-[92px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Button
                  type="button"
                  disabled={privacyCreateBusy}
                  onClick={() => void handleCreatePrivacyRequest()}
                >
                  {privacyCreateBusy ? "Saving..." : "Create request"}
                </Button>
                <p className="text-muted-foreground max-w-40 text-xs">
                  New requests inherit the patient retention snapshot and appear in the global
                  review queue.
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-950">
                  Privacy request history {activePatientId ? `for ${activePatientId}` : ""}
                </h3>
              </div>

              {patientLoading ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {t.common_loading}
                </p>
              ) : patientPrivacyRequests.length === 0 ? (
                <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                  {activePatientId
                    ? "No privacy requests recorded for this patient yet."
                    : "Load a patient to view privacy requests."}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requested by</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Retention until</TableHead>
                      <TableHead>Linked records</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {patientPrivacyRequests.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell className="font-medium">
                          <div>{privacyRequestTypeLabel(record.request_type)}</div>
                          <div className="text-xs text-slate-500">
                            Created {compactDt(record.requested_at)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            <Badge className={privacyStatusBadgeClass(record.status)}>
                              {privacyStatusLabel(record.status)}
                            </Badge>
                            {record.manual_override ? (
                              <span className="text-xs text-slate-500">Manual override</span>
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
                  placeholder="Uses the loaded patient UUID"
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
                    <TableHead>Type</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>{t.compliance_granted}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.by_type.map((entry) => (
                    <TableRow key={entry.consent_type}>
                      <TableCell className="font-medium">
                        {consentTypeLabel(entry.consent_type)}
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
                <h2 className="text-lg font-semibold">Privacy review queue</h2>
                <p className="text-muted-foreground text-sm">
                  Requested {privacyCounters.requested} · Hold{" "}
                  {privacyCounters.retentionHold} · Approved{" "}
                  {privacyCounters.approved} · Overdue {privacyCounters.overdue}
                </p>
              </div>
            </div>

            {privacyQueueLoading ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                {t.common_loading}
              </p>
            ) : privacyQueue.length === 0 ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                No privacy requests in scope.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Request</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Linked records</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Actions</TableHead>
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
                            {privacyRequestTypeLabel(record.request_type)}
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
                              {privacyStatusLabel(record.status)}
                            </Badge>
                            {record.is_overdue &&
                            (record.status === "requested" ||
                              record.status === "retention_hold" ||
                              record.status === "approved") ? (
                              <span className="text-xs font-medium text-red-600">
                                Overdue
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
                                  {approveBusy ? "Saving..." : "Approve"}
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
                                  {holdBusy ? "Saving..." : "Hold"}
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
                                  {rejectBusy ? "Saving..." : "Reject"}
                                </Button>
                              </>
                            ) : null}

                            {record.status === "approved" ? (
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
                                {executeBusy ? "Executing..." : "Execute"}
                              </Button>
                            ) : null}

                            {record.status === "completed" &&
                            record.executed_at ? (
                              <span className="text-xs text-slate-500">
                                Executed {compactDt(record.executed_at)}
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
                    <TableHead>Patient</TableHead>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>{t.activity_time}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expired.map((item) => (
                    <TableRow
                      key={`${item.patient_id}-${item.consent_type}-${item.granted_at}`}
                    >
                      <TableCell className="font-medium">
                        {patientLabel(item.patient_pid, item.patient_name)}
                      </TableCell>
                      <TableCell>{item.user_name}</TableCell>
                      <TableCell>
                        {consentTypeLabel(item.consent_type)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-500">
                        {compactDt(item.granted_at)}
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
                    <TableHead>Patient</TableHead>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>Type</TableHead>
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
                          {consentTypeLabel(item.consent_type)}
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
