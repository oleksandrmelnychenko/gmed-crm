import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  CheckCircle2,
  Clock3,
  Download,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  AdminSheetScaffold,
  AdminInlineMetric,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useLang, type Translations } from "@/lib/i18n";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  Section,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import {
  createPatientPrivacyRequest,
  downloadPatientComplianceExport,
  executeCompliancePrivacyRequest,
  fetchComplianceDashboard,
  fetchCompliancePrivacyQueue,
  fetchPatientComplianceWorkspace,
  reviewCompliancePrivacyRequest,
  savePatientConsent,
} from "@/pages/admin/data/admin-api";

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
    return `${normalizedPid} - ${normalizedName}`;
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
  ].join(" - ");
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
  const [consentSheetOpen, setConsentSheetOpen] = useState(false);
  const [privacySheetOpen, setPrivacySheetOpen] = useState(false);
  const [reviewSheetRecord, setReviewSheetRecord] =
    useState<PrivacyRequestRecord | null>(null);

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
      const { dashboard: dash, expired: exp } =
        await fetchComplianceDashboard<ConsentDashboard, ExpiredConsent>();
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
      const items = await fetchCompliancePrivacyQueue<PrivacyRequestRecord>();
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
      const { consents, privacyRequests } =
        await fetchPatientComplianceWorkspace<
          PatientConsentRecord,
          PrivacyRequestRecord
        >(patientId);
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

  const refreshWorkspace = useCallback(async () => {
    await Promise.all([
      loadConsentDashboard(),
      loadPrivacyQueue(),
      activePatientId ? loadPatientWorkspace(activePatientId) : Promise.resolve(),
    ]);
  }, [activePatientId, loadConsentDashboard, loadPatientWorkspace, loadPrivacyQueue]);

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
      await savePatientConsent(targetPatientId, {
        consent_type: consentType,
        action,
        note: consentNote.trim() || undefined,
        expires_at:
          action === "grant" ? consentExpiresAt.trim() || undefined : undefined,
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
      await createPatientPrivacyRequest(targetPatientId, {
        request_type: privacyRequestType,
        source: "patient_request",
        reason: privacyReason.trim() || undefined,
      });

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
      await reviewCompliancePrivacyRequest(requestId, { action });

      await Promise.all([
        loadPrivacyQueue(),
        activePatientId === patientId
          ? loadPatientWorkspace(patientId)
          : Promise.resolve(),
      ]);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      return false;
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
      return false;
    }

    const busyToken = `${requestId}:execute`;
    setPrivacyActionBusy(busyToken);
    setActionError("");

    try {
      const payload = await executeCompliancePrivacyRequest<unknown>(requestId);
      setExportResult(JSON.stringify(payload, null, 2));

      await Promise.all([
        loadPrivacyQueue(),
        loadConsentDashboard(),
        activePatientId === patientId
          ? loadPatientWorkspace(patientId)
          : Promise.resolve(),
      ]);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setPrivacyActionBusy(null);
    }
  };

  const reviewSheetImpactSummary = useMemo(() => {
    if (!reviewSheetRecord) {
      return [];
    }
    return [
      `${t.compliance_col_due}: ${compactDt(reviewSheetRecord.due_at)}`,
      `${t.compliance_col_retention_until}: ${compactDt(
        reviewSheetRecord.retention_until,
      )}`,
      `${t.compliance_col_linked_records}: ${recordSummaryLabel(
        reviewSheetRecord.record_summary,
      )}`,
      `${t.compliance_col_notes}: ${privacyNotesLabel(reviewSheetRecord)}`,
    ];
  }, [
    reviewSheetRecord,
    t.compliance_col_due,
    t.compliance_col_linked_records,
    t.compliance_col_notes,
    t.compliance_col_retention_until,
  ]);

  const doExport = async () => {
    const targetPatientId = (activePatientId || patientInput).trim();
    if (!targetPatientId) {
      setActionError(t.compliance_uuid_required);
      return;
    }

    setActionError("");
    setExportResult(null);

    try {
      const filename = await downloadPatientComplianceExport(targetPatientId);
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
  const exportResultIsError = exportResult?.startsWith("Error:") ?? false;
  const exportResultIsJson = Boolean(
    exportResult &&
      (exportResult.trim().startsWith("{") || exportResult.trim().startsWith("[")),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.compliance_title}
        description={t.compliance_subtitle}
        actions={(
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
            disabled={loading}
            onClick={() => void refreshWorkspace()}
          >
            <RefreshCcw className="size-3.5" />
            {t.common_refresh}
          </Button>
        )}
      />

      {loading ? <TabLoader /> : null}
      {!loading && actionError ? <Banner tone="error">{actionError}</Banner> : null}

      {!loading ? (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <AdminInlineMetric
              icon={ShieldCheck}
              tone="sky"
              label={stats[0].label}
              value={stats[0].value}
              description={t.common_registry}
            />
            <AdminInlineMetric
              icon={CheckCircle2}
              tone="emerald"
              label={stats[1].label}
              value={stats[1].value}
              description={t.compliance_consents}
            />
            <AdminInlineMetric
              icon={Clock3}
              tone="amber"
              label={stats[3].label}
              value={stats[3].value}
              description={t.compliance_expired_consents}
            />
            <AdminInlineMetric
              icon={ShieldAlert}
              tone="slate"
              label={stats[4].label}
              value={stats[4].value}
              description={t.compliance_privacy_review_queue}
            />
            <AdminInlineMetric
              icon={Download}
              tone="rose"
              label={stats[5].label}
              value={stats[5].value}
              description={stats[6].label}
            />
          </div>

          <Section
            title={t.compliance_patient_register_title}
            accessory={(
              <div className="rounded-full border border-border/60 bg-muted/25 px-3 py-1 text-xs font-medium text-foreground">
                {activePatientLabel}
              </div>
            )}
          >
            <form
              className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={handleLoadPatientRegister}
            >
              <Field label={`${t.compliance_patient_id} (UUID)`} htmlFor="compliance-patient-id">
                <Input
                  id="compliance-patient-id"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={patientInput}
                  onChange={(event) => setPatientInput(event.target.value)}
                  className="h-9 rounded-lg bg-card"
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" className="h-9 rounded-lg px-3.5">
                  {t.compliance_load_register}
                </Button>
              </div>
            </form>

            {patientError ? <Banner tone="error">{patientError}</Banner> : null}

            <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5", tokens.surface.card)}>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{t.compliance_consent_type_label}</div>
                <Badge className="bg-sky-500/15 text-sky-700">
                  {consentTypeLabel(consentType, t)}
                </Badge>
                <p className="text-xs text-muted-foreground">{t.compliance_expiry_hint}</p>
              </div>
              <Button
                type="button"
                className="h-9 rounded-lg px-3.5"
                disabled={consentBusy !== null || (!activePatientId && !patientInput.trim())}
                onClick={() => setConsentSheetOpen(true)}
              >
                {t.activity_details}
              </Button>
            </div>

            <AdminTableCard
              title={`${t.compliance_consent_history}${activePatientId ? ` - ${activePatientId}` : ""}`}
              description={t.compliance_patient_register_hint}
              count={patientConsents.length}
            >
              {patientLoading ? (
                <TabLoader />
              ) : patientConsents.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>
                    {activePatientId
                      ? t.compliance_no_consent_events
                      : t.compliance_load_patient_consent_hint}
                  </EmptyCell>
                </div>
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
                            {typeof record.note === "string" && record.note.trim()
                              ? record.note
                              : "\u2014"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </AdminTableCard>
          </Section>

          <Section
            title={t.compliance_privacy_requests_title}
            accessory={(
              <div className="rounded-full border border-border/60 bg-muted/25 px-3 py-1 text-xs font-medium text-foreground">
                {activePatientLabel}
              </div>
            )}
          >
            <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl p-3.5", tokens.surface.card)}>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">{t.compliance_request_type_label}</div>
                <Badge className="bg-amber-500/15 text-amber-700">
                  {privacyRequestTypeLabel(privacyRequestType, t)}
                </Badge>
                <p className="text-xs text-muted-foreground">{t.compliance_new_request_hint}</p>
              </div>
              <Button
                type="button"
                className="h-9 rounded-lg px-3.5"
                disabled={privacyCreateBusy || (!activePatientId && !patientInput.trim())}
                onClick={() => setPrivacySheetOpen(true)}
              >
                {t.compliance_create_request}
              </Button>
            </div>

            <AdminTableCard
              title={`${t.compliance_privacy_history}${activePatientId ? ` - ${activePatientId}` : ""}`}
              description={t.compliance_privacy_requests_hint}
              count={patientPrivacyRequests.length}
            >
              {patientLoading ? (
                <TabLoader />
              ) : patientPrivacyRequests.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>
                    {activePatientId
                      ? t.compliance_no_privacy_requests
                      : t.compliance_load_patient_privacy_hint}
                  </EmptyCell>
                </div>
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
                            {t.compliance_created_label} {compactDt(record.requested_at)}
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
            </AdminTableCard>
          </Section>

          <Section title={t.compliance_export}>
            <div className={cn("grid gap-4 rounded-xl p-3.5 md:grid-cols-[minmax(0,1fr)_auto]", tokens.surface.card)}>
              <Field label={`${t.compliance_patient_id} (UUID)`}>
                <Input
                  placeholder={t.compliance_uses_loaded_uuid}
                  value={patientInput}
                  onChange={(event) => setPatientInput(event.target.value)}
                  className="h-9 rounded-lg bg-card"
                />
              </Field>
              <div className="flex items-end">
                <Button type="button" className="h-9 rounded-lg px-3.5" onClick={() => void doExport()}>
                  <Download className="mr-1 size-4" />
                  {t.compliance_export}
                </Button>
              </div>
            </div>
            {exportResult ? (
              exportResultIsError ? (
                <Banner tone="error">{exportResult}</Banner>
              ) : exportResultIsJson ? (
                <pre className="max-h-72 overflow-auto rounded-lg border border-border/50 bg-card/60 p-3 text-xs text-muted-foreground">
                  {exportResult}
                </pre>
              ) : (
                <SuccessBanner>{exportResult}</SuccessBanner>
              )
            ) : null}
          </Section>

          <Section title={t.compliance_consents}>
            {dashboard && dashboard.by_type.length > 0 ? (
              <AdminTableCard
                title={t.compliance_consents}
                description={t.common_registry}
                count={dashboard.by_type.length}
              >
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
                        <TableCell className="font-mono text-sm">{entry.total}</TableCell>
                        <TableCell>
                          <Badge className="bg-green-500/15 text-green-700">
                            {entry.active}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AdminTableCard>
            ) : null}

            <AdminTableCard
              title={`${t.compliance_expired_consents} (${expired.length})`}
              description={t.compliance_expired}
              count={expired.length}
            >
              {expired.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>{t.compliance_no_expired}</EmptyCell>
                </div>
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
                        <TableCell>{consentTypeLabel(item.consent_type, t)}</TableCell>
                        <TableCell className="font-mono text-sm text-slate-500">
                          {compactDt(item.expires_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AdminTableCard>

            {dashboard && dashboard.recent_changes.length > 0 ? (
              <AdminTableCard
                title={t.compliance_recent}
                description={t.common_monitoring}
                count={dashboard.recent_changes.length}
              >
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
                      const label = isRevoked ? t.compliance_revoked : t.compliance_granted;
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
                          <TableCell>{consentTypeLabel(item.consent_type, t)}</TableCell>
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
              </AdminTableCard>
            ) : null}
          </Section>

          <Section title={t.compliance_privacy_review_queue}>
            <AdminTableCard
              title={t.compliance_privacy_review_queue}
              description={`${t.compliance_stat_requested} ${privacyCounters.requested} - ${t.compliance_stat_hold} ${privacyCounters.retentionHold} - ${t.compliance_stat_approved} ${privacyCounters.approved} - ${t.compliance_stat_overdue} ${privacyCounters.overdue}`}
              count={privacyQueue.length}
            >
              {privacyQueueLoading ? (
                <TabLoader />
              ) : privacyQueue.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>{t.compliance_no_privacy_scope}</EmptyCell>
                </div>
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
                      const isActionable =
                        record.status === "requested" ||
                        record.status === "retention_hold" ||
                        (record.status === "approved" &&
                          canExecutePrivacyRequest(user?.role, record.request_type));

                      return (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">
                            {patientLabel(record.patient_pid, record.patient_name)}
                          </TableCell>
                          <TableCell className="font-medium">
                            <div>{privacyRequestTypeLabel(record.request_type, t)}</div>
                            <div className="text-xs text-slate-500">
                              {record.source.replaceAll("_", " ")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2">
                              <Badge className={privacyStatusBadgeClass(record.status)}>
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
                            {isActionable ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg"
                                disabled={privacyActionBusy !== null}
                                onClick={() => setReviewSheetRecord(record)}
                              >
                                {t.activity_details}
                              </Button>
                            ) : record.status === "completed" && record.executed_at ? (
                              <span className="text-xs text-slate-500">
                                {t.compliance_executed_label} {compactDt(record.executed_at)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </AdminTableCard>
          </Section>

          <Sheet open={consentSheetOpen} onOpenChange={setConsentSheetOpen}>
            <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
              <AdminSheetScaffold
                title={t.compliance_consent_type_label}
                description={activePatientLabel}
              >
                <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <Field label={t.compliance_consent_type_label}>
                    <Select
                      value={consentType}
                      onValueChange={(value) => setConsentType(value ?? CONSENT_TYPE_VALUES[0])}
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONSENT_TYPE_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {consentTypeLabel(value, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t.compliance_operational_note} htmlFor="consent-note">
                    <textarea
                      id="consent-note"
                      value={consentNote}
                      onChange={(event) => setConsentNote(event.target.value)}
                      placeholder={t.compliance_consent_note_placeholder}
                      rows={3}
                      className={textareaClass}
                    />
                  </Field>
                  <Field label={t.compliance_expiry_date} htmlFor="consent-expires-at">
                    <Input
                      id="consent-expires-at"
                      type="date"
                      value={consentExpiresAt}
                      onChange={(event) => setConsentExpiresAt(event.target.value)}
                      className="h-9 rounded-lg bg-card"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.compliance_expiry_hint}
                    </p>
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="h-9 rounded-lg"
                      disabled={consentBusy !== null}
                      onClick={() => void handleConsentAction("grant")}
                    >
                      {consentBusy === "grant" ? t.compliance_saving : t.compliance_grant_consent}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      disabled={consentBusy !== null}
                      onClick={() => void handleConsentAction("revoke")}
                    >
                      {consentBusy === "revoke" ? t.compliance_saving : t.compliance_revoke_consent}
                    </Button>
                  </div>
                </section>
              </AdminSheetScaffold>
            </SheetContent>
          </Sheet>

          <Sheet open={privacySheetOpen} onOpenChange={setPrivacySheetOpen}>
            <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
              <AdminSheetScaffold
                title={t.compliance_privacy_requests_title}
                description={activePatientLabel}
              >
                <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <Field label={t.compliance_request_type_label}>
                    <Select
                      value={privacyRequestType}
                      onValueChange={(value) =>
                        setPrivacyRequestType(
                          (value ?? PRIVACY_REQUEST_TYPE_VALUES[0]) as PrivacyRequestType,
                        )
                      }
                    >
                      <SelectTrigger className="h-9 w-full rounded-lg bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIVACY_REQUEST_TYPE_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {privacyRequestTypeLabel(value, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t.compliance_request_reason} htmlFor="privacy-request-reason">
                    <textarea
                      id="privacy-request-reason"
                      value={privacyReason}
                      onChange={(event) => setPrivacyReason(event.target.value)}
                      placeholder={t.compliance_request_reason_placeholder}
                      rows={3}
                      className={textareaClass}
                    />
                  </Field>
                  <Button
                    type="button"
                    className="h-9 rounded-lg"
                    disabled={privacyCreateBusy}
                    onClick={() => void handleCreatePrivacyRequest()}
                  >
                    {privacyCreateBusy ? t.compliance_saving : t.compliance_create_request}
                  </Button>
                </section>
              </AdminSheetScaffold>
            </SheetContent>
          </Sheet>

          <Sheet
            open={Boolean(reviewSheetRecord)}
            onOpenChange={(open) => !open && setReviewSheetRecord(null)}
          >
            <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
              {reviewSheetRecord ? (
                <AdminSheetScaffold
                  title={t.compliance_privacy_review_queue}
                  description={patientLabel(
                    reviewSheetRecord.patient_pid,
                    reviewSheetRecord.patient_name,
                  )}
                >
                  <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={privacyStatusBadgeClass(reviewSheetRecord.status)}>
                        {privacyStatusLabel(reviewSheetRecord.status, t)}
                      </Badge>
                      <Badge className="bg-slate-500/15 text-slate-700">
                        {privacyRequestTypeLabel(reviewSheetRecord.request_type, t)}
                      </Badge>
                      {reviewSheetRecord.is_overdue ? (
                        <Badge className="bg-red-500/15 text-red-700">
                          {t.compliance_stat_overdue}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                      <p className="text-xs font-medium text-foreground">Impact summary</p>
                      {reviewSheetImpactSummary.map((line) => (
                        <p key={line} className="text-xs text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>

                    {reviewSheetRecord.request_type === "erasure" ? (
                      <Banner tone="warning" withIcon>
                        {t.compliance_anonymize_confirm}
                      </Banner>
                    ) : null}

                    {reviewSheetRecord.status === "requested" ||
                    reviewSheetRecord.status === "retention_hold" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="h-9 rounded-lg"
                          disabled={privacyActionBusy !== null}
                          onClick={async () => {
                            const ok = await handleReviewPrivacyRequest(
                              reviewSheetRecord.id,
                              reviewSheetRecord.patient_id,
                              "approve",
                            );
                            if (ok) {
                              setReviewSheetRecord(null);
                            }
                          }}
                        >
                          {privacyActionBusy === `${reviewSheetRecord.id}:approve`
                            ? t.compliance_saving
                            : t.compliance_approve}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={privacyActionBusy !== null}
                          onClick={async () => {
                            const ok = await handleReviewPrivacyRequest(
                              reviewSheetRecord.id,
                              reviewSheetRecord.patient_id,
                              "hold",
                            );
                            if (ok) {
                              setReviewSheetRecord(null);
                            }
                          }}
                        >
                          {privacyActionBusy === `${reviewSheetRecord.id}:hold`
                            ? t.compliance_saving
                            : t.compliance_hold}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={privacyActionBusy !== null}
                          onClick={async () => {
                            const ok = await handleReviewPrivacyRequest(
                              reviewSheetRecord.id,
                              reviewSheetRecord.patient_id,
                              "reject",
                            );
                            if (ok) {
                              setReviewSheetRecord(null);
                            }
                          }}
                        >
                          {privacyActionBusy === `${reviewSheetRecord.id}:reject`
                            ? t.compliance_saving
                            : t.compliance_reject}
                        </Button>
                      </div>
                    ) : null}

                    {reviewSheetRecord.status === "approved" &&
                    canExecutePrivacyRequest(
                      user?.role,
                      reviewSheetRecord.request_type,
                    ) ? (
                      <Button
                        type="button"
                        variant={
                          reviewSheetRecord.request_type === "erasure"
                            ? "destructive"
                            : "outline"
                        }
                        className="h-9 rounded-lg"
                        disabled={privacyActionBusy !== null}
                        onClick={async () => {
                          const ok = await handleExecutePrivacyRequest(
                            reviewSheetRecord.id,
                            reviewSheetRecord.patient_id,
                            reviewSheetRecord.request_type,
                          );
                          if (ok) {
                            setReviewSheetRecord(null);
                          }
                        }}
                      >
                        {reviewSheetRecord.request_type === "erasure" ? (
                          <ShieldAlert className="mr-1 size-4" />
                        ) : null}
                        {privacyActionBusy === `${reviewSheetRecord.id}:execute`
                          ? t.compliance_executing
                          : t.compliance_execute}
                      </Button>
                    ) : null}
                  </section>
                </AdminSheetScaffold>
              ) : null}
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
