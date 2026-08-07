import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { clearApiCache } from "@/lib/api";
import {
  createDocumentPreviewObjectUrl,
  revokeDocumentPreviewObjectUrl,
  uploadDocument,
} from "@/pages/documents/data/document-api";
import {
  completeClinicalDocumentImport,
  createClinicalDocumentImport,
  deleteClinicalDocumentImport,
  fetchClinicalDocumentImport,
  fetchClinicalDocumentImports,
  retryClinicalDocumentImport,
  type ClinicalDocumentImport,
  type ClinicalDocumentImportCandidate,
  type ClinicalDocumentImportDraft,
  type ClinicalDocumentImportStatus,
  type ClinicalDocumentImportSummary,
  type ClinicalDocumentImportTarget,
} from "@/pages/patients/data/clinical-document-import";
import { cn } from "@/lib/utils";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type ApplyResult = Record<string, number>;
type BuilderTab = "all" | "source" | ClinicalDocumentImportTarget;

const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const IMPORT_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const IMPORT_POLL_BASE_DELAY_MS = 1_800;
const IMPORT_POLL_MAX_DELAY_MS = 15_000;
const IMPORT_HISTORY_POLL_DELAY_MS = 4_000;
const builderTabClassName =
  "h-10 gap-2 rounded-none border-0 bg-transparent px-1 text-muted-foreground hover:bg-transparent hover:text-orange-700 data-active:bg-transparent data-active:text-orange-700 data-active:shadow-none after:bottom-0 after:h-0.5 after:bg-orange-500";

export type ExistingClinicalImportItem = {
  id: string;
  primary: string;
  secondary?: string | null;
};

export type ExistingClinicalImportItems = Record<
  ClinicalDocumentImportTarget,
  ExistingClinicalImportItem[]
>;

const targetOrder: ClinicalDocumentImportTarget[] = [
  "diagnosis",
  "anamnesis",
  "medication",
  "examination",
  "recommendation",
];

const targetLabels: Record<ClinicalDocumentImportTarget, { ru: string; de: string }> = {
  diagnosis: { ru: "Диагнозы", de: "Diagnosen" },
  anamnesis: { ru: "Анамнез", de: "Anamnese" },
  medication: { ru: "Медикаменты", de: "Medikation" },
  examination: { ru: "Обследования", de: "Befunde" },
  recommendation: { ru: "Рекомендации", de: "Empfehlungen" },
};

const targetTone: Record<ClinicalDocumentImportTarget, string> = {
  diagnosis: "border-rose-200 bg-rose-50 text-rose-700",
  anamnesis: "border-violet-200 bg-violet-50 text-violet-700",
  medication: "border-sky-200 bg-sky-50 text-sky-700",
  examination: "border-amber-200 bg-amber-50 text-amber-800",
  recommendation: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const targetCardTone: Record<ClinicalDocumentImportTarget, string> = {
  diagnosis: "border-rose-200 bg-rose-50/35",
  anamnesis: "border-violet-200 bg-violet-50/35",
  medication: "border-sky-200 bg-sky-50/35",
  examination: "border-amber-200 bg-amber-50/35",
  recommendation: "border-emerald-200 bg-emerald-50/35",
};

const reviewReasonLabels: Record<string, { ru: string; de: string }> = {
  suspected_diagnosis_requires_confirmation: {
    ru: "Подозрение — требуется подтверждение",
    de: "Verdacht – Bestätigung erforderlich",
  },
  rule_out_is_not_an_active_diagnosis: {
    ru: "Цель исключения — не активный диагноз",
    de: "Ausschlussziel – keine aktive Diagnose",
  },
  negative_statement_is_not_an_active_diagnosis: {
    ru: "Отрицательный результат — не диагноз",
    de: "Negativer Befund – keine Diagnose",
  },
  low_ocr_confidence: {
    ru: "OCR распознал фрагмент неуверенно",
    de: "OCR-Fragment mit niedriger Konfidenz",
  },
  low_extraction_quality: {
    ru: "Качество исходного текста требует проверки",
    de: "Qualität des Quelltexts erfordert Prüfung",
  },
  extraction_quality_unavailable: {
    ru: "Качество фрагмента не удалось оценить",
    de: "Fragmentqualität konnte nicht bewertet werden",
  },
};

const semanticLabels: Record<string, { ru: string; de: string }> = {
  suspected: { ru: "Подозрение", de: "Verdacht" },
  negated: { ru: "Отрицательный результат", de: "Negativer Befund" },
  rule_out: { ru: "Исключение", de: "Ausschluss" },
  diagnostic_intent: { ru: "Цель обследования", de: "Untersuchungsziel" },
  negative_finding: { ru: "Отрицательный результат", de: "Negativer Befund" },
  personal_history: { ru: "Перенесённое состояние", de: "Eigenanamnese" },
  family_history: { ru: "Семейный анамнез", de: "Familienanamnese" },
};

const draftWarningLabels: Record<string, { ru: string; de: string }> = {
  "Low-confidence OCR evidence requires manual review.": {
    ru: "Часть OCR-текста распознана неуверенно и требует ручной сверки с документом.",
    de: "Ein Teil des OCR-Texts hat niedrige Konfidenz und muss mit dem Dokument geprüft werden.",
  },
};

const importStatusLabels: Record<
  ClinicalDocumentImportStatus,
  { ru: string; de: string }
> = {
  queued: { ru: "В очереди", de: "In Warteschlange" },
  processing: { ru: "Обрабатывается", de: "Wird verarbeitet" },
  review_required: { ru: "Готово к проверке", de: "Bereit zur Prüfung" },
  applied: { ru: "Добавлено в карту", de: "Übernommen" },
  failed: { ru: "Ошибка", de: "Fehlgeschlagen" },
};

const importStatusTone: Record<ClinicalDocumentImportStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  processing: "border-sky-200 bg-sky-50 text-sky-700",
  review_required: "border-amber-200 bg-amber-50 text-amber-800",
  applied: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
};

function ImportStatusGlyph({ status }: { status: ClinicalDocumentImportStatus }) {
  if (status === "processing") return <LoaderCircle className="size-4 animate-spin" />;
  if (status === "queued") return <Clock3 className="size-4" />;
  if (status === "failed") return <AlertTriangle className="size-4" />;
  return <CheckCircle2 className="size-4" />;
}

function normalizedString(candidate: ClinicalDocumentImportCandidate, key: string) {
  const value = candidate.normalized[key];
  return typeof value === "string" ? value : null;
}

function normalizedStringArray(candidate: ClinicalDocumentImportCandidate, key: string) {
  const value = candidate.normalized[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRiskyCandidate(candidate: ClinicalDocumentImportCandidate) {
  const assertion = normalizedString(candidate, "assertion");
  const role = normalizedString(candidate, "semantic_role");
  const autoSelect = candidate.normalized.auto_select;
  return (
    autoSelect === false ||
    ["suspected", "negated", "rule_out"].includes(assertion ?? "") ||
    ["diagnostic_intent", "negative_finding"].includes(role ?? "") ||
    normalizedStringArray(candidate, "review_reasons").includes("low_ocr_confidence")
  );
}

function mergeReviewCandidates(
  incoming: ClinicalDocumentImportCandidate[],
  current: ClinicalDocumentImportCandidate[],
) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const existing = currentById.get(item.id);
    const lowConfidenceDiagnosis = item.target === "diagnosis" && item.confidence < 0.75;
    return {
      ...item,
      value: existing?.value ?? item.value,
      selected:
        existing?.selected ??
        (item.selected !== false && !lowConfidenceDiagnosis && !isRiskyCandidate(item)),
    };
  });
}

export function ClinicalDocumentImportSheet({
  open,
  onOpenChange,
  patientId,
  lang,
  existingItems,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  lang: string;
  existingItems: ExistingClinicalImportItems;
  onApply: (
    documentImport: ClinicalDocumentImport,
    candidates: ClinicalDocumentImportCandidate[],
    sourceCountry: string,
  ) => Promise<ApplyResult>;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentImport, setDocumentImport] = useState<ClinicalDocumentImport | null>(null);
  const [candidates, setCandidates] = useState<ClinicalDocumentImportCandidate[]>([]);
  const [sourceCountry, setSourceCountry] = useState("DE");
  const [activeTab, setActiveTab] = useState<BuilderTab>("all");
  const [manualTarget, setManualTarget] = useState<ClinicalDocumentImportTarget>("diagnosis");
  const [manualValue, setManualValue] = useState("");
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imports, setImports] = useState<ClinicalDocumentImportSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClinicalDocumentImportSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const hasActiveHistoryJobs = imports.some((item) =>
    ["queued", "processing"].includes(item.status),
  );

  function clearPreview() {
    if (previewUrlRef.current) revokeDocumentPreviewObjectUrl(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview(null);
    setPreviewError("");
  }

  useEffect(() => () => {
    if (previewUrlRef.current) revokeDocumentPreviewObjectUrl(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchClinicalDocumentImports(patientId)
      .then(({ items }) => {
        if (!cancelled) {
          setImports(items);
          setHistoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : tx("Не удалось загрузить историю", "Verlauf konnte nicht geladen werden"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId, lang]);

  useEffect(() => {
    if (!open || !hasActiveHistoryJobs) return;
    const timer = window.setInterval(() => {
      void fetchClinicalDocumentImports(patientId)
        .then(({ items }) => setImports(items))
        .catch(() => undefined);
    }, IMPORT_HISTORY_POLL_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [open, patientId, hasActiveHistoryJobs]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      clearPreview();
      setFile(null);
      setDocumentImport(null);
      setCandidates([]);
      setSourceCountry("DE");
      setActiveTab("all");
      setManualTarget("diagnosis");
      setManualValue("");
      setActiveCandidateId(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    onOpenChange(nextOpen);
  }

  function handleFileSelected(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      return;
    }
    if (!IMPORT_MIME_TYPES.has(nextFile.type)) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.error(tx("Поддерживаются только PDF, PNG и JPG", "Nur PDF, PNG und JPG werden unterstützt"));
      return;
    }
    if (nextFile.size > MAX_IMPORT_FILE_BYTES) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.error(tx("Файл превышает лимит 25 МБ", "Die Datei überschreitet das Limit von 25 MB"));
      return;
    }
    setFile(nextFile);
  }

  async function refreshHistory(silent = false) {
    if (!silent) setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetchClinicalDocumentImports(patientId);
      setImports(response.items);
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : tx("Не удалось загрузить историю", "Verlauf konnte nicht geladen werden"),
      );
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }

  async function loadPreview(documentId: string) {
    clearPreview();
    try {
      const nextPreview = await createDocumentPreviewObjectUrl(documentId);
      previewUrlRef.current = nextPreview.url;
      setPreview(nextPreview);
    } catch (error) {
      setPreviewError(
        error instanceof Error
          ? error.message
          : tx("Предпросмотр недоступен", "Vorschau nicht verfügbar"),
      );
    }
  }

  async function openImportSnapshot(item: ClinicalDocumentImportSummary) {
    setHistoryBusyId(item.id);
    try {
      const detail = await fetchClinicalDocumentImport(patientId, item.id);
      const snapshotCandidates = detail.reviewed_draft?.candidates ?? detail.draft.candidates;
      setDocumentImport(detail);
      setCandidates(
        detail.reviewed_draft
          ? snapshotCandidates
          : mergeReviewCandidates(snapshotCandidates, []),
      );
      setActiveCandidateId(snapshotCandidates[0]?.id ?? null);
      setActiveTab("all");
      await loadPreview(detail.document_id);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось открыть снимок", "Snapshot konnte nicht geöffnet werden"),
      );
    } finally {
      setHistoryBusyId(null);
    }
  }

  async function deleteHistoryImport() {
    const target = deleteTarget;
    if (!target || deleteBusy) return;

    setDeleteBusy(true);
    setHistoryBusyId(target.id);
    try {
      await deleteClinicalDocumentImport(patientId, target.id);
      setImports((current) => current.filter((item) => item.id !== target.id));
      if (documentImport?.id === target.id) {
        clearPreview();
        setDocumentImport(null);
        setCandidates([]);
        setActiveCandidateId(null);
        setActiveTab("all");
      }
      setDeleteTarget(null);
      toast.success(tx("Обработка удалена из истории", "Verarbeitung wurde aus dem Verlauf entfernt"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось удалить обработку", "Verarbeitung konnte nicht gelöscht werden"),
      );
    } finally {
      setDeleteBusy(false);
      setHistoryBusyId(null);
    }
  }

  function returnToHistory() {
    clearPreview();
    setDocumentImport(null);
    setCandidates([]);
    setActiveCandidateId(null);
    setActiveTab("all");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    void refreshHistory(true);
  }

  const pollingImportId = documentImport?.id ?? null;
  const shouldPoll = Boolean(
    documentImport && ["queued", "processing"].includes(documentImport.status),
  );

  useEffect(() => {
    if (!pollingImportId || !shouldPoll) return;
    const importId = pollingImportId;

    let cancelled = false;
    let timer: number | null = null;
    let consecutiveFailures = 0;
    let errorReported = false;

    function schedule(delay: number) {
      if (cancelled) return;
      timer = window.setTimeout(() => void poll(), delay);
    }

    async function poll() {
      try {
        const next = await fetchClinicalDocumentImport(patientId, importId);
        if (cancelled) return;
        consecutiveFailures = 0;
        errorReported = false;
        setDocumentImport(next);
        if (!["queued", "processing"].includes(next.status)) {
          void refreshHistory(true);
        }
        if (next.status === "review_required") {
          setCandidates((current) => mergeReviewCandidates(next.draft.candidates, current));
          setActiveCandidateId((activeId) =>
            activeId && next.draft.candidates.some((item) => item.id === activeId)
              ? activeId
              : (next.draft.candidates[0]?.id ?? null),
          );
          return;
        }
        if (["queued", "processing"].includes(next.status)) {
          schedule(IMPORT_POLL_BASE_DELAY_MS);
        }
      } catch (error) {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (!errorReported) {
          errorReported = true;
          toast.error(
            error instanceof Error
              ? error.message
              : tx("Ошибка обработки", "Verarbeitungsfehler"),
          );
        }
        const retryDelay = Math.min(
          IMPORT_POLL_BASE_DELAY_MS * 2 ** Math.min(consecutiveFailures - 1, 8),
          IMPORT_POLL_MAX_DELAY_MS,
        );
        schedule(retryDelay);
      }
    }

    schedule(IMPORT_POLL_BASE_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pollingImportId, shouldPoll, patientId, lang]);

  const selected = useMemo(() => candidates.filter((item) => item.selected), [candidates]);
  const visibleCandidates = useMemo(
    () => candidates.filter((item) => activeTab === "all" || item.target === activeTab),
    [activeTab, candidates],
  );
  const activeCandidate = candidates.find((item) => item.id === activeCandidateId) ?? null;
  const activePage = activeCandidate?.source.page ?? 1;
  const hasExternalDiagnosis = selected.some((item) => item.target === "diagnosis");
  const newCount = (target: ClinicalDocumentImportTarget) =>
    candidates.filter((item) => item.target === target).length;
  const selectedCount = (target: ClinicalDocumentImportTarget) =>
    selected.filter((item) => item.target === target).length;

  function formatImportDate(value: string) {
    return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function appliedObjectCount(item: ClinicalDocumentImportSummary | ClinicalDocumentImport) {
    return Object.values(item.applied_counts).reduce((sum, count) => sum + count, 0);
  }

  async function startImport() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patient_id", patientId);
      form.append("auto_name", file.name);
      form.append("art", "medical_report");
      form.append("category", "medical_report");
      form.append("status", "active");
      form.append("visibility", "internal");
      form.append("is_medical", "true");
      form.append("ursprung", "clinical_document_import");
      const uploaded = await uploadDocument(form);
      clearApiCache("/documents");
      clearApiCache(`/patients/${patientId}/documents`);
      const created = await createClinicalDocumentImport(patientId, uploaded.id);
      setDocumentImport(created);
      await loadPreview(uploaded.id);
      void refreshHistory(true);
      toast.success(
        tx(
          "Документ загружен и поставлен в очередь",
          "Dokument wurde zur Verarbeitung eingereiht",
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось загрузить документ", "Dokument konnte nicht hochgeladen werden"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!documentImport) return;
    setBusy(true);
    try {
      setDocumentImport(await retryClinicalDocumentImport(patientId, documentImport.id));
      void refreshHistory(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Повтор не удался", "Erneuter Versuch fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!documentImport || selected.length === 0) return;
    if (hasExternalDiagnosis && !/^[A-Z]{2}$/.test(sourceCountry)) {
      toast.error(
        tx(
          "Укажите страну документа кодом ISO",
          "Bitte Ursprungsland als ISO-Code angeben",
        ),
      );
      return;
    }
    setBusy(true);
    try {
      const latestImport = await fetchClinicalDocumentImport(patientId, documentImport.id);
      if (latestImport.status === "applied") {
        setDocumentImport(latestImport);
        toast.success(tx("Импорт уже был завершён", "Der Import wurde bereits abgeschlossen"));
        return;
      }
      if (latestImport.status !== "review_required") {
        throw new Error(tx("Черновик ещё не готов к подтверждению", "Der Entwurf ist noch nicht zur Prüfung bereit"));
      }
      const appliedCounts = await onApply(documentImport, selected, sourceCountry);
      const reviewedDraft: ClinicalDocumentImportDraft = {
        ...documentImport.draft,
        candidates,
      };
      const completed = await completeClinicalDocumentImport(
        patientId,
        documentImport.id,
        reviewedDraft,
        appliedCounts,
      );
      setDocumentImport(completed);
      setCandidates(completed.reviewed_draft?.candidates ?? candidates);
      void refreshHistory(true);
      toast.success(
        tx(
          "Данные добавлены в карту пациента",
          "Daten wurden in die Patientenakte übernommen",
        ),
      );
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tx("Импорт не удался", "Import fehlgeschlagen"),
      );
    } finally {
      setBusy(false);
    }
  }

  function patchCandidate(id: string, patch: Partial<ClinicalDocumentImportCandidate>) {
    setCandidates((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addManualCandidate() {
    const value = manualValue.trim();
    if (!value || snapshotReadOnly) return;
    const id = `manual:${crypto.randomUUID()}`;
    const normalized: Record<string, unknown> = (() => {
      if (manualTarget === "diagnosis") {
        return {
          kind: "secondary",
          label: value,
          certainty: "bestaetigt",
          source_mode: "extern",
          assertion: "confirmed",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "anamnesis") {
        return {
          anamnese_aktuelle: value,
          section_role: "manual",
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "medication") {
        return {
          wirkstoff: value,
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      if (manualTarget === "examination") {
        return {
          kind: "other",
          title: tx("Выделено из документа", "Aus Dokument ausgewählt"),
          result: value,
          status: "final",
          section_role: "manual",
          assertion: "reported",
          semantic_role: "manual_review",
          auto_select: true,
          review_reasons: [],
          confidence_kind: "manual_user_entry",
        };
      }
      return {
        description: value,
        section_role: "manual",
        assertion: "reported",
        semantic_role: "manual_review",
        auto_select: true,
        review_reasons: [],
        confidence_kind: "manual_user_entry",
      };
    })();
    const candidate: ClinicalDocumentImportCandidate = {
      id,
      target: manualTarget,
      value,
      normalized,
      confidence: 1,
      selected: true,
      source: {
        page: null,
        section: tx("Ручной выбор", "Manuelle Auswahl"),
        text: value,
      },
    };
    setCandidates((current) => [...current, candidate]);
    setActiveCandidateId(id);
    setActiveTab(manualTarget);
    setManualValue("");
    toast.success(
      tx("Объект добавлен в черновик", "Objekt zum Entwurf hinzugefügt"),
    );
  }

  function toggleVisible(selectedState: boolean) {
    const visibleIds = new Set(visibleCandidates.map((item) => item.id));
    setCandidates((current) =>
      current.map((item) =>
        visibleIds.has(item.id) ? { ...item, selected: selectedState } : item,
      ),
    );
  }

  const reviewReady = documentImport?.status === "review_required";
  const snapshotReady = reviewReady || documentImport?.status === "applied";
  const snapshotReadOnly = documentImport?.status === "applied";

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={handleOpenChange}
      maxWidthClassName="sm:!top-2 sm:!bottom-2 sm:!right-2 sm:!w-[calc(100vw-16px)] sm:!max-w-[calc(100vw-16px)] sm:rounded-xl"
      title={tx("Конструктор импорта медицинского документа", "Builder für medizinischen Dokumentimport")}
      description={tx(
        "Проверяйте предложения системы рядом с оригиналом.",
        "Systemvorschläge direkt neben dem Original prüfen.",
      )}
      headerClassName="border-b border-border/70 bg-white px-5 py-3"
      bodyClassName="!space-y-0 !overflow-hidden !bg-white !p-0"
      bodyWrapperClassName="h-full min-h-0"
      footer={
        reviewReady ? (
          <>
            <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{selected.length}</span>
              {tx("объектов выбрано", "Objekte ausgewählt")}
            </div>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button type="button" disabled={busy || selected.length === 0} onClick={apply}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {tx("Подтвердить и добавить", "Prüfen und übernehmen")}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 bg-white lg:grid-cols-[minmax(520px,58fr)_minmax(400px,42fr)]">
        <section className="flex min-h-0 flex-col border-r border-border/70 bg-white">
          {!documentImport ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mx-auto w-full max-w-3xl space-y-4">
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {tx("Добавить данные из документа", "Daten aus Dokument übernehmen")}
                    </h3>
                  </div>

                  <button
                    type="button"
                    className={cn(
                      "flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-white px-5 py-5 text-center transition-colors",
                      "hover:border-[var(--brand)]/60 hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/35 focus-visible:ring-offset-2",
                      file ? "border-[var(--brand)]/60" : "border-border/80",
                    )}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleFileSelected(event.dataTransfer.files?.[0] ?? null);
                    }}
                  >
                    {file ? (
                      <FileText className="size-5 text-emerald-600" />
                    ) : (
                      <FileUp className="size-5 text-[var(--brand)]" />
                    )}
                    <span className="mt-2 max-w-full break-words text-xs font-semibold text-foreground">
                      {file?.name ?? tx("Выберите PDF или изображение", "PDF oder Bild auswählen")}
                    </span>
                    <span className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {file
                        ? tx("Файл готов к обработке", "Datei ist zur Verarbeitung bereit")
                        : tx(
                            "Нажмите или перетащите файл в эту область",
                            "Klicken oder Datei in diesen Bereich ziehen",
                          )}
                    </span>
                    <span className="mt-2 text-[10px] font-medium text-muted-foreground">
                      PDF · PNG · JPG · {tx("до 25 МБ", "bis 25 MB")}
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    hidden
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(event) => handleFileSelected(event.target.files?.[0] ?? null)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 w-full rounded-lg text-xs"
                    disabled={!file || busy}
                    onClick={startImport}
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                    {tx("Загрузить и построить черновик", "Hochladen und Entwurf erstellen")}
                  </Button>
                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                    <Check className="size-3" />
                    {tx(
                      "Данные попадут в карту только после вашего подтверждения",
                      "Daten gelangen erst nach Ihrer Bestätigung in die Akte",
                    )}
                  </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-border/70 bg-white">
                  <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <History className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold">
                          {tx("История обработки", "Verarbeitungsverlauf")}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {tx(
                            "Снимки документов этого пациента",
                            "Dokument-Snapshots dieses Patienten",
                          )}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      disabled={historyLoading}
                      onClick={() => void refreshHistory()}
                      aria-label={tx("Обновить историю", "Verlauf aktualisieren")}
                    >
                      <RefreshCw className={cn("size-4", historyLoading && "animate-spin")} />
                    </Button>
                  </header>

                  {historyError ? (
                    <div className="m-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {historyError}
                    </div>
                  ) : null}

                  {historyLoading && imports.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      {tx("Загружаем историю…", "Verlauf wird geladen…")}
                    </div>
                  ) : imports.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <FileText className="mx-auto size-8 text-muted-foreground/50" />
                      <p className="mt-2 text-sm font-medium">
                        {tx("Обработок пока нет", "Noch keine Verarbeitungen")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx(
                          "После загрузки здесь появится статус worker-а и готовый снимок.",
                          "Nach dem Upload erscheinen hier Worker-Status und fertiger Snapshot.",
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {imports.map((item) => {
                        const appliedCount = appliedObjectCount(item);
                        return (
                          <div key={item.id} className="flex items-center transition-colors hover:bg-muted/25">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left disabled:cursor-wait"
                              disabled={historyBusyId === item.id}
                              onClick={() => void openImportSnapshot(item)}
                            >
                              <div
                                className={cn(
                                  "flex size-9 shrink-0 items-center justify-center rounded-xl border",
                                  importStatusTone[item.status],
                                )}
                              >
                                {historyBusyId === item.id ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  <ImportStatusGlyph status={item.status} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="max-w-full truncate text-sm font-medium">
                                    {item.document_name ?? tx("Медицинский документ", "Medizinisches Dokument")}
                                  </p>
                                  <Badge variant="outline" className={importStatusTone[item.status]}>
                                    {importStatusLabels[item.status][lang === "de" ? "de" : "ru"]}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatImportDate(item.created_at)} · {item.candidate_count}{" "}
                                  {tx("объектов найдено", "Objekte erkannt")}
                                  {item.status === "applied"
                                    ? ` · ${appliedCount} ${tx("добавлено", "übernommen")}`
                                    : ""}
                                </p>
                              </div>
                              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                            </button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              className="mr-3 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              disabled={deleteBusy || historyBusyId === item.id}
                              onClick={() => setDeleteTarget(item)}
                              aria-label={tx("Удалить обработку", "Verarbeitung löschen")}
                              title={tx("Удалить обработку", "Verarbeitung löschen")}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : null}

          {documentImport ? (
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4">
              <Button type="button" size="sm" variant="ghost" onClick={returnToHistory}>
                <ArrowLeft className="size-4" />
                {tx("К истории", "Zum Verlauf")}
              </Button>
              <div className="flex min-w-0 items-center gap-2">
                <span className="hidden truncate text-xs text-muted-foreground sm:block">
                  {documentImport.document_name}
                </span>
                <Badge variant="outline" className={importStatusTone[documentImport.status]}>
                  <ImportStatusGlyph status={documentImport.status} />
                  {importStatusLabels[documentImport.status][lang === "de" ? "de" : "ru"]}
                </Badge>
              </div>
            </div>
          ) : null}

          {documentImport && ["queued", "processing"].includes(documentImport.status) ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="relative flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <FileText className="size-7 text-primary" />
                <LoaderCircle className="absolute -right-1 -bottom-1 size-6 animate-spin rounded-full bg-background text-primary" />
              </div>
              <div>
                <p className="font-semibold">{tx("Строим клинический черновик…", "Klinischen Entwurf erstellen…")}</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {tx(
                    "Распознаём страницы, секции, диагнозы, анамнез, медикаменты, обследования и рекомендации.",
                    "Seiten, Abschnitte, Diagnosen, Anamnese, Medikation, Befunde und Empfehlungen werden erkannt.",
                  )}
                </p>
              </div>
            </div>
          ) : null}

          {documentImport?.status === "failed" ? (
            <div className="m-6 space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 text-destructive" />
                <div>
                  <p className="font-medium">{tx("Распознавание не удалось", "Erkennung fehlgeschlagen")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{documentImport.error_message}</p>
                </div>
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={retry}>
                <RotateCcw className="size-4" />
                {tx("Попробовать снова", "Erneut versuchen")}
              </Button>
            </div>
          ) : null}

          {snapshotReady ? (
            <>
              <div className="shrink-0 border-b border-border/70 bg-white px-4 pt-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                      {documentImport.document_type ?? "medical_report"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {candidates.length} {tx("найденных объектов", "erkannte Objekte")}
                    </span>
                    {documentImport.draft.extraction ? (
                      <span className="text-xs text-muted-foreground">
                        · {documentImport.draft.extraction.page_count} {tx("стр.", "Seiten")}
                        {documentImport.draft.extraction.used_ocr
                          ? ` · OCR ${documentImport.draft.extraction.pages.filter((page) => page.source === "ocr").length}${
                              documentImport.draft.extraction.pages.find((page) => page.source === "ocr")?.ocr_engine
                                ? ` (${documentImport.draft.extraction.pages.find((page) => page.source === "ocr")?.ocr_engine})`
                                : ""
                            }`
                          : ` · ${tx("текстовый слой", "Textebene")}`}
                      </span>
                    ) : null}
                  </div>
                  {reviewReady ? (
                    <div className="flex items-center gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => toggleVisible(true)}>
                        <Check className="size-3.5" />
                        {tx("Выбрать все", "Alle auswählen")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => toggleVisible(false)}>
                        {tx("Снять выбор", "Auswahl aufheben")}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    const nextTab = value as BuilderTab;
                    setActiveTab(nextTab);
                    if (nextTab === "source") setActiveCandidateId(null);
                  }}
                >
                  <TabsList
                    variant="line"
                    className="h-10 w-full max-w-full justify-start gap-5 overflow-x-auto overflow-y-hidden rounded-none border-0 border-b border-border/70 bg-transparent px-1 py-0"
                  >
                    <TabsTrigger value="all" className={builderTabClassName}>
                      {tx("Все", "Alle")}
                      <span className="rounded-full bg-orange-50 px-1.5 text-[10px] text-orange-700">
                        {candidates.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="source" className={builderTabClassName}>
                      <FileText className="size-3.5" />
                      {tx("Весь текст", "Gesamter Text")}
                    </TabsTrigger>
                    {targetOrder.map((target) => (
                      <TabsTrigger key={target} value={target} className={builderTabClassName}>
                        {targetLabels[target][lang === "de" ? "de" : "ru"]}
                        <span className="rounded-full bg-orange-50 px-1.5 text-[10px] text-orange-700">
                          {newCount(target)}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {snapshotReadOnly ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4" />
                      <div>
                        <p className="text-xs font-semibold">
                          {tx("Снимок подтверждён и добавлен", "Snapshot bestätigt und übernommen")}
                        </p>
                        <p className="text-[11px] text-emerald-800/80">
                          {documentImport.applied_at
                            ? formatImportDate(documentImport.applied_at)
                            : formatImportDate(documentImport.updated_at)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-emerald-300 bg-white/60 text-emerald-800">
                      {appliedObjectCount(documentImport)} {tx("объектов", "Objekte")}
                    </Badge>
                  </div>
                ) : null}
                {documentImport.draft.warnings.map((warning) => (
                  <div key={warning} className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      {draftWarningLabels[warning]?.[lang === "de" ? "de" : "ru"] ?? warning}
                    </span>
                  </div>
                ))}

                {activeTab === "source" ? (
                  <section className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold">
                        {tx("Весь текст документа", "Gesamter Dokumenttext")}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tx(
                          "Выделите фрагмент — он автоматически появится в конструкторе объекта ниже.",
                          "Text markieren – der Ausschnitt erscheint automatisch im Objekt-Editor unten.",
                        )}
                      </p>
                    </div>

                    {documentImport.draft.raw_text ? (
                      <textarea
                        readOnly
                        value={documentImport.draft.raw_text}
                        className="min-h-[420px] w-full resize-y rounded-xl border border-border/70 bg-slate-50/70 p-4 font-mono text-[12px] leading-5 text-foreground outline-none selection:bg-orange-200 focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                        onSelect={(event) => {
                          if (!reviewReady) return;
                          const field = event.currentTarget;
                          const fragment = field.value
                            .slice(field.selectionStart, field.selectionEnd)
                            .trim();
                          if (fragment) setManualValue(fragment);
                        }}
                        aria-label={tx("Распознанный текст документа", "Erkannter Dokumenttext")}
                      />
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
                        <FileText className="mx-auto size-8 text-muted-foreground/50" />
                        <p className="mt-2 text-sm font-medium">
                          {tx("Полный текст ещё не сохранён", "Gesamttext ist noch nicht gespeichert")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tx("Перезапустите обработку этого снимка.", "Diesen Snapshot erneut verarbeiten.")}
                        </p>
                      </div>
                    )}

                    {reviewReady ? (
                      <div className="rounded-xl border border-border/70 bg-white p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
                          <div>
                            <h5 className="text-sm font-semibold">
                              {tx("Добавить объект в черновик", "Objekt zum Entwurf hinzufügen")}
                            </h5>
                            <p className="text-[11px] text-muted-foreground">
                              {tx("Фрагмент можно отредактировать перед добавлением.", "Der Ausschnitt kann vor dem Hinzufügen bearbeitet werden.")}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_auto] lg:items-end">
                          <label className="space-y-1">
                            <span className="text-xs font-medium">
                              {tx("Тип объекта", "Objekttyp")}
                            </span>
                            <select
                              value={manualTarget}
                              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                              onChange={(event) =>
                                setManualTarget(event.target.value as ClinicalDocumentImportTarget)
                              }
                            >
                              {targetOrder.map((target) => (
                                <option key={target} value={target}>
                                  {targetLabels[target][lang === "de" ? "de" : "ru"]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium">
                              {tx("Выделенный фрагмент", "Ausgewählter Ausschnitt")}
                            </span>
                            <textarea
                              value={manualValue}
                              className="min-h-24 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                              placeholder={tx("Выделите текст выше или введите его здесь…", "Oben Text markieren oder hier eingeben…")}
                              onChange={(event) => setManualValue(event.target.value)}
                            />
                          </label>
                          <Button
                            type="button"
                            className="h-10 gap-1.5"
                            disabled={!manualValue.trim()}
                            onClick={addManualCandidate}
                          >
                            <Plus className="size-4" />
                            {tx("Добавить", "Hinzufügen")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {activeTab !== "source" && hasExternalDiagnosis && (activeTab === "all" || activeTab === "diagnosis") ? (
                  <div className="mb-4 flex items-end gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium">
                        {tx("Страна источника", "Ursprungsland")}
                      </span>
                      <Input
                        value={sourceCountry}
                        maxLength={2}
                        className="w-24 uppercase"
                        onChange={(event) =>
                          setSourceCountry(
                            event.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                          )
                        }
                        placeholder="DE"
                      />
                    </label>
                    <p className="pb-2 text-xs text-muted-foreground">
                      {tx(
                        "Нужно для внешних диагнозов; позже возьмём автоматически из реквизитов клиники.",
                        "Für externe Diagnosen erforderlich; später automatisch aus den Klinikdaten.",
                      )}
                    </p>
                  </div>
                ) : null}

                {activeTab !== "source" ? (activeTab === "all" ? targetOrder : [activeTab]).map((target) => {
                  const currentItems = existingItems[target];
                  const proposedItems = visibleCandidates.filter((item) => item.target === target);
                  if (activeTab === "all" && proposedItems.length === 0) return null;
                  return (
                    <section key={target} className="mb-5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold">
                            {targetLabels[target][lang === "de" ? "de" : "ru"]}
                          </h4>
                          <p className="text-[11px] text-muted-foreground">
                            {currentItems.length} {tx("уже в системе", "bereits im System")} · {selectedCount(target)}{" "}
                            {snapshotReadOnly
                              ? tx("в подтверждённом снимке", "im bestätigten Snapshot")
                              : tx("выбрано для добавления", "zur Übernahme ausgewählt")}
                          </p>
                        </div>
                        <Badge variant="outline" className={targetTone[target]}>
                          +{proposedItems.length}
                        </Badge>
                      </div>

                      {currentItems.length > 0 ? (
                        <details className="rounded-xl border border-border/60 bg-muted/15">
                          <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-muted-foreground">
                            {tx("Текущие данные пациента", "Aktuelle Patientendaten")} ({currentItems.length})
                          </summary>
                          <div className="space-y-2 border-t border-border/50 p-2">
                            {currentItems.map((item) => (
                              <div
                                key={item.id}
                                className={cn("rounded-lg border px-3 py-2.5", targetCardTone[target])}
                              >
                                <p className="whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-foreground">
                                  {item.primary}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className={cn("rounded-full text-[10px]", targetTone[target])}>
                                    {targetLabels[target][lang === "de" ? "de" : "ru"]}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-border/60 bg-white/80 text-[10px] font-medium text-muted-foreground"
                                  >
                                    {tx("Уже в карте", "Bereits in der Akte")}
                                  </Badge>
                                </div>
                                {item.secondary ? (
                                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                                    {item.secondary}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}

                      <div className="space-y-2">
                        {proposedItems.map((candidate) => {
                          const active = candidate.id === activeCandidateId;
                          const reviewReasons = normalizedStringArray(candidate, "review_reasons");
                          const semanticKey =
                            normalizedString(candidate, "semantic_role") ??
                            normalizedString(candidate, "assertion");
                          const semanticLabel = semanticKey
                            ? semanticLabels[semanticKey]?.[lang === "de" ? "de" : "ru"]
                            : null;
                          return (
                            <article
                              key={candidate.id}
                              className={cn(
                                "rounded-lg border px-3 py-2.5 transition-all",
                                targetCardTone[candidate.target],
                                active
                                  ? "border-orange-400 shadow-sm ring-2 ring-orange-100"
                                  : "hover:border-orange-300 hover:shadow-sm",
                                !candidate.selected && "opacity-60",
                              )}
                              onClick={() => setActiveCandidateId(candidate.id)}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-2 size-4 shrink-0 rounded border-border accent-orange-500"
                                  checked={candidate.selected}
                                  disabled={snapshotReadOnly}
                                  onChange={(event) =>
                                    patchCandidate(candidate.id, { selected: event.target.checked })
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={tx("Импортировать запись", "Eintrag importieren")}
                                />
                                <div className="min-w-0 flex-1">
                                  <textarea
                                    value={candidate.value}
                                    disabled={snapshotReadOnly || !candidate.selected}
                                    className="min-h-14 w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium leading-relaxed text-foreground outline-none transition-colors hover:border-white/90 hover:bg-white/60 focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100 disabled:cursor-default disabled:opacity-55"
                                    onChange={(event) =>
                                      patchCandidate(candidate.id, { value: event.target.value })
                                    }
                                    onFocus={() => setActiveCandidateId(candidate.id)}
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className={cn("rounded-full text-[10px]", targetTone[candidate.target])}
                                    >
                                      {targetLabels[candidate.target][lang === "de" ? "de" : "ru"]}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="rounded-full border-border/60 bg-white/80 text-[10px] font-medium text-muted-foreground"
                                    >
                                      {tx("Уверенность", "Konfidenz")} {Math.round(candidate.confidence * 100)}%
                                    </Badge>
                                    {semanticLabel ? (
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-800"
                                      >
                                        {semanticLabel}
                                      </Badge>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-orange-200 hover:text-orange-800"
                                      onClick={() => setActiveCandidateId(candidate.id)}
                                    >
                                      {candidate.source.section}
                                      {candidate.source.page ? ` · S. ${candidate.source.page}` : ""}
                                      <ChevronRight className="size-3" />
                                    </button>
                                  </div>
                                  {reviewReasons.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                      {reviewReasons.map((reason) => (
                                        <p
                                          key={reason}
                                          className="flex items-center gap-1.5 text-[11px] leading-4 text-amber-800"
                                        >
                                          <AlertTriangle className="size-3 shrink-0" />
                                          {reviewReasonLabels[reason]?.[lang === "de" ? "de" : "ru"] ?? reason}
                                        </p>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                }) : null}
              </div>
            </>
          ) : null}

        </section>

        <aside className="flex min-h-0 flex-col bg-white">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {documentImport?.document_name ?? file?.name ?? tx("Предпросмотр документа", "Dokumentvorschau")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {activeCandidate?.source.page
                  ? `${tx("Страница", "Seite")} ${activeCandidate.source.page}`
                  : tx("Оригинал для сверки", "Original zum Abgleich")}
              </p>
            </div>
            {activeCandidate ? (
              <Badge variant="outline" className={targetTone[activeCandidate.target]}>
                {targetLabels[activeCandidate.target][lang === "de" ? "de" : "ru"]}
              </Badge>
            ) : null}
          </div>

          {activeCandidate ? (
            <div className="shrink-0 border-b border-border/70 bg-white px-4 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tx("Фрагмент-основание", "Quellenausschnitt")}
              </p>
              <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                {activeCandidate.source.text}
              </p>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 p-3">
            {preview ? (
              preview.contentType.startsWith("image/") ? (
                <div className="flex h-full items-start justify-center overflow-auto rounded-lg border border-border bg-white p-3">
                  <img src={preview.url} alt={tx("Медицинский документ", "Medizinisches Dokument")} className="max-w-full" />
                </div>
              ) : (
                <iframe
                  key={`${preview.url}-${activePage}`}
                  title={documentImport?.document_name ?? tx("Предпросмотр документа", "Dokumentvorschau")}
                  src={`${preview.url}#page=${activePage}&zoom=page-width`}
                  className="h-full w-full rounded-lg border border-border bg-white shadow-sm"
                />
              )
            ) : previewError ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground">
                {previewError}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-white p-6 text-center">
                <FileText className="size-10 text-muted-foreground/60" />
                <p className="text-sm font-medium">{tx("Документ появится здесь", "Dokument erscheint hier")}</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {tx(
                    "Preview останется открытым, пока вы переходите между медицинскими объектами.",
                    "Die Vorschau bleibt beim Wechsel zwischen medizinischen Objekten geöffnet.",
                  )}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
      <DirtyDismissConfirmDialog
        open={Boolean(deleteTarget)}
        title={tx("Удалить обработку?", "Verarbeitung löschen?")}
        message={tx(
          "Из истории этого пациента будет удалена только запись обработки. Исходный документ и уже добавленные медицинские данные сохранятся.",
          "Nur der Verarbeitungseintrag wird aus dem Verlauf dieses Patienten entfernt. Das Quelldokument und bereits übernommene medizinische Daten bleiben erhalten.",
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={deleteBusy ? tx("Удаление…", "Löschen…") : tx("Удалить", "Löschen")}
        confirmDisabled={deleteBusy}
        destructive
        onCancel={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteHistoryImport()}
      />
    </PatientSheetScaffold>
  );
}
