import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiMark } from "@/components/ui/ai-mark";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiRequestError } from "@/lib/api";
import {
  createMedicationEvidenceReview,
  createMedicationAiAnalysis,
  fetchMedicationAiAnalysis,
  fetchMedicationEvidenceReview,
  fetchMedicationEvidenceReviewPreview,
  retryMedicationAiAnalysis,
  type MedicationAiAnalysis,
  type MedicationAiProvider,
  type MedicationEvidenceCitation,
  type MedicationEvidenceDraftItem,
  type MedicationEvidenceReview,
  type MedicationEvidenceReviewPreview,
  type MedicationEvidenceReviewStatus,
  type MedicationEvidenceSummary,
} from "@/lib/api/medication-evidence-reviews";
import { useLang, type Lang } from "@/lib/i18n";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { useRealtimeSubscription, type RealtimeEvent } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

import { officialSourceLabel } from "../../data/official-medication-source-label";

export { officialSourceLabel } from "../../data/official-medication-source-label";

type Bilingual = (ru: string, de: string) => string;

const MEDICATION_AI_RESULT_REALTIME_EVENTS = [
  "patient.medication_ai_analysis_ready",
  "patient.medication_ai_analysis_failed",
] as const;

type MedicationEvidenceReviewPanelProps = {
  patientId: string;
  refreshKey?: string | number;
  fetchPreviewer?: typeof fetchMedicationEvidenceReviewPreview;
};

type MedicationEvidenceReviewPanelContentProps = {
  preview?: MedicationEvidenceReviewPreview | null;
  loading?: boolean;
  error?: string | null;
  operation?: "idle" | "creating" | "stale" | "error";
  operationError?: string | null;
  language?: Lang;
  onRetryPreview?: () => void;
  onCreate?: () => void;
  onRetryCreate?: () => void;
  onRefreshStale?: () => void;
  onViewLatest?: (reviewId: string) => void;
};

type MedicationEvidenceReviewContentProps = {
  review?: MedicationEvidenceReview | null;
  loading?: boolean;
  error?: string | null;
  language?: Lang;
  showOverview?: boolean;
  onRetry?: () => void;
};

function formatTimestamp(value: string, lang: Lang) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return cachedDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatEvidenceDate(value: string, lang: Lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return value;
  return cachedDateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function citationKindLabel(kind: string, tx: Bilingual) {
  if (kind === "finding") return tx("Сигнал", "Hinweis");
  if (kind === "missing_data") return tx("Недостающие данные", "Fehlende Daten");
  if (kind === "source") return tx("Источник", "Quelle");
  if (kind === "benefit_assessment") return tx("Оценка G-BA", "G-BA-Bewertung");
  return tx("Доказательство", "Evidenz");
}

function sourceHealthLabel(health: string, tx: Bilingual) {
  if (health === "fresh") return tx("Актуален", "Aktuell");
  if (health === "stale") return tx("Требует обновления", "Aktualisierung erforderlich");
  if (health === "error") return tx("Ошибка источника", "Quellenfehler");
  if (health === "never") return tx("Снимок отсутствует", "Kein Snapshot");
  return tx("Состояние неизвестно", "Status unbekannt");
}

function evidenceText(value: string, lang: Lang) {
  const medicationMatchLabel = lang === "de"
    ? "bestätigte Arzneimittelzuordnung"
    : "подтверждённое соответствие препарата";
  return value
    .replace(
      "Нужен подтверждённый medication_drug_match либо проверенный ATC/PZN.",
      "Нужно подтвердить соответствие препарата либо проверить код ATC/PZN.",
    )
    .replace(
      "Bestätigter medication_drug_match erforderlich.",
      "Erforderlich ist eine bestätigte Arzneimittelzuordnung oder ein geprüfter ATC-/PZN-Code.",
    )
    .replaceAll("medication_drug_match", medicationMatchLabel);
}

function missingDataReason(
  missing: MedicationEvidenceReview["bundle"]["missing_data"][number],
  lang: Lang,
) {
  if (missing.code === "medication_identity") {
    return lang === "de"
      ? "Erforderlich ist eine bestätigte Arzneimittelzuordnung oder ein geprüfter ATC-/PZN-Code."
      : "Нужно подтвердить соответствие препарата либо проверить код ATC/PZN.";
  }
  return evidenceText(lang === "de" ? missing.reason_de : missing.reason_ru, lang);
}

function reviewStatusLabel(status: MedicationEvidenceReviewStatus, tx: Bilingual) {
  if (status === "draft_ready") return tx("Доказательства готовы", "Evidenz bereit");
  if (status === "failed") return tx("Не удалось сформировать", "Erstellung fehlgeschlagen");
  if (status === "superseded") return tx("Есть более новая версия", "Neuere Version vorhanden");
  return tx("Формируется", "Wird erstellt");
}

function reviewStatusDot(status: MedicationEvidenceReviewStatus) {
  if (status === "draft_ready") return "bg-emerald-500";
  if (status === "failed") return "bg-rose-500";
  if (status === "requested") return "bg-amber-500";
  return "bg-slate-400";
}

function SummaryStrip({ summary, tx }: { summary: MedicationEvidenceSummary; tx: Bilingual }) {
  const items = [
    {
      label: tx("Медикаменты", "Medikamente"),
      value: summary.active_medications,
      chipClass: "border-sky-200 bg-sky-50",
      labelClass: "text-sky-700",
      valueClass: "text-sky-950",
    },
    {
      label: tx("Идентифицированы", "Identifiziert"),
      value: summary.identified_medications,
      chipClass: summary.identified_medications > 0
        ? "border-emerald-200 bg-emerald-50"
        : "border-emerald-100 bg-emerald-50/50",
      labelClass: "text-emerald-700",
      valueClass: "text-emerald-950",
    },
    {
      label: tx("Требуют проверки", "Zu prüfen"),
      value: summary.unresolved_medications,
      chipClass: summary.unresolved_medications > 0
        ? "border-amber-200 bg-amber-50"
        : "border-amber-100 bg-amber-50/50",
      labelClass: "text-amber-700",
      valueClass: "text-amber-950",
    },
    {
      label: tx("Высокий приоритет", "Hohe Priorität"),
      value: summary.high_priority_findings,
      chipClass: summary.high_priority_findings > 0
        ? "border-rose-200 bg-rose-50"
        : "border-rose-100 bg-rose-50/50",
      labelClass: "text-rose-700",
      valueClass: "text-rose-950",
    },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ label, value, chipClass, labelClass, valueClass }) => (
        <div
          key={label}
          className={cn(
            "inline-flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1.5",
            chipClass,
          )}
        >
          <span className={cn("text-[10px] font-medium", labelClass)}>{label}</span>
          <span className={cn("font-mono text-[11px] font-semibold tabular-nums", valueClass)}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function MedicationEvidenceReviewPanelContent({
  preview = null,
  loading = false,
  error = null,
  operation = "idle",
  operationError = null,
  language,
  onRetryPreview,
  onCreate,
  onRetryCreate,
  onRefreshStale,
  onViewLatest,
}: MedicationEvidenceReviewPanelContentProps) {
  const { lang: activeLanguage } = useLang();
  const lang = language ?? activeLanguage;
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const latestCreatedAt = preview?.latest_review
    ? formatTimestamp(preview.latest_review.created_at, lang)
    : null;

  return (
    <section
      className="overflow-hidden rounded-lg border border-border/70 bg-white"
      aria-label={tx("AI-анализ доказательств", "KI-Evidenzprüfung")}
    >
      <header className="flex flex-col gap-2 border-b border-border/60 bg-muted/15 px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AiMark className="size-4 text-foreground" />
            <h2 className="text-[13px] font-semibold text-foreground">
              {tx("AI-анализ доказательств", "KI-Evidenzprüfung")}
            </h2>
          </div>
        </div>
        {preview ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {tx("Состояние данных", "Datenstand")}: {formatTimestamp(preview.generated_at, lang) || "—"}
          </span>
        ) : null}
      </header>

      <div className="space-y-3 p-3.5">
        {loading ? (
          <div role="status" className="py-7 text-center text-xs text-muted-foreground">
            {tx("Загружаем данные анализа…", "Analysedaten werden geladen…")}
          </div>
        ) : error ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            {onRetryPreview ? (
              <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRetryPreview}>
                {tx("Повторить", "Erneut versuchen")}
              </Button>
            ) : null}
          </div>
        ) : !preview ? (
          <div className="py-7 text-center text-xs text-muted-foreground">
            {tx("Предварительные данные анализа недоступны.", "Die Analysevorschau ist nicht verfügbar.")}
          </div>
        ) : (
          <>
            {operation === "stale" ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {tx(
                    "Данные о медикаментах изменились. Обновите их перед повторным анализом.",
                    "Die Medikationsdaten haben sich geändert. Aktualisieren Sie sie vor der erneuten Analyse.",
                  )}
                </span>
                {onRefreshStale ? (
                  <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRefreshStale}>
                    {tx("Обновить данные", "Daten aktualisieren")}
                  </Button>
                ) : null}
              </div>
            ) : operation === "error" ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
                <span>{operationError || tx("Не удалось подготовить AI-анализ.", "Die KI-Analyse konnte nicht vorbereitet werden.")}</span>
                {onRetryCreate ? (
                  <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRetryCreate}>
                    {tx("Повторить", "Erneut versuchen")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 rounded-lg border border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {preview.latest_review ? (
                  <>
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <span className={cn("size-1.5 rounded-full", reviewStatusDot(preview.latest_review.status))} />
                      {reviewStatusLabel(preview.latest_review.status, tx)}
                    </p>
                    <p className="mt-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                      {latestCreatedAt || preview.latest_review.id}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {tx("AI-анализ ещё не запускался.", "Die KI-Analyse wurde noch nicht gestartet.")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                {preview.latest_review && preview.permissions.can_read_review && onViewLatest ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 rounded-lg sm:min-h-8"
                    onClick={() => onViewLatest(preview.latest_review!.id)}
                  >
                    <AiMark className="size-3.5" />
                    {tx("Открыть результат", "Ergebnis öffnen")}
                  </Button>
                ) : null}
                {preview.permissions.can_create_review && onCreate ? (
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-11 rounded-lg sm:min-h-8"
                    disabled={operation === "creating" || !preview.intelligence_fingerprint}
                    onClick={onCreate}
                  >
                    <AiMark className="size-3.5" />
                    {operation === "creating"
                      ? tx("Подготавливаем анализ…", "Analyse wird vorbereitet…")
                      : tx("Сформировать AI-анализ", "KI-Analyse erstellen")}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function CitationRefs({
  refs,
  citations,
  tx,
}: {
  refs: string[];
  citations: Map<string, MedicationEvidenceCitation>;
  tx: Bilingual;
}) {
  const resolvedCitations = refs.flatMap((ref, index) => {
    const citation = citations.get(ref);
    if (!citation) return [];
    const href = safeExternalUrl(citation?.source_url ?? null);
    return [{ ref, href, kind: citation.kind, ordinal: index + 1 }];
  });
  const linkLabel = (href: string) => {
    try {
      const hostname = new URL(href).hostname.replace(/^www\./, "");
      return `${tx("Источник", "Quelle")} · ${hostname}`;
    } catch {
      return tx("Источник", "Quelle");
    }
  };
  const localLabel = (kind: string, ordinal: number) => [
    citationKindLabel(kind, tx),
    `${tx("Локальная ссылка", "Lokaler Nachweis")} ${ordinal}`,
  ].join(" · ");
  const citationBadge = ({
    ref,
    href,
    kind,
    ordinal,
  }: (typeof resolvedCitations)[number]) => {
    const label = href ? linkLabel(href) : localLabel(kind, ordinal);
    const className = href
      ? "max-w-full rounded-full bg-sky-50 px-2 py-1 text-[9px] font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 hover:text-sky-900"
      : "max-w-full rounded-full bg-slate-50 px-2 py-1 text-[9px] font-medium text-slate-700 ring-1 ring-slate-200";
    return href ? (
      <a
        key={`${ref}:${ordinal}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        <span className="block truncate">{label}</span>
      </a>
    ) : (
      <span key={`${ref}:${ordinal}`} className={className}>
        <span className="block truncate">{label}</span>
      </span>
    );
  };
  if (resolvedCitations.length === 0) return null;
  if (resolvedCitations.length === 1) {
    return <div className="mt-2 flex max-w-full">{citationBadge(resolvedCitations[0])}</div>;
  }
  return (
    <details className="group/sources mt-2 w-fit max-w-full">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-border/60 bg-muted/10 px-2 py-0.5 text-[9px] font-medium text-muted-foreground marker:hidden hover:border-border hover:bg-muted/25 hover:text-foreground">
        {tx("Доказательства", "Nachweise")} · {resolvedCitations.length}
        <ChevronDown className="size-3 transition-transform group-open/sources:rotate-180" />
      </summary>
      <div className="mt-1.5 flex max-w-xl flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/10 p-2">
        {resolvedCitations.map(citationBadge)}
      </div>
    </details>
  );
}

function DraftGroup({
  title,
  items,
  citations,
  lang,
  emptyText,
  ai = false,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  items: MedicationEvidenceDraftItem[];
  citations: Map<string, MedicationEvidenceCitation>;
  lang: Lang;
  emptyText: string;
  ai?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const header = (
    <div className="flex items-center gap-2 bg-muted/15 px-3 py-2.5">
        {ai ? <AiMark className="size-3.5 text-orange-500" /> : <span className="size-1.5 rounded-full bg-orange-500" />}
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{items.length}</span>
        {collapsible ? <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open/draft:rotate-180" /> : null}
    </div>
  );
  const content = (
    <div className="border-t border-border/50">
      {items.length === 0 ? (
        <p className="px-3 py-5 text-center text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="divide-y divide-border/50">
          {items.map((item, index) => (
            <li key={`${index}:${item.citation_refs.join(":")}`} className="px-3 py-2.5">
              <p className="break-words text-xs leading-relaxed text-foreground">
                {evidenceText(lang === "de" ? item.text_de : item.text_ru, lang)}
              </p>
              <CitationRefs refs={item.citation_refs} citations={citations} tx={tx} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  if (collapsible) {
    return (
      <details open={defaultOpen || undefined} className="group/draft overflow-hidden rounded-lg border border-border/70 bg-white">
        <summary className="cursor-pointer list-none marker:hidden">{header}</summary>
        {content}
      </details>
    );
  }
  return <section className="overflow-hidden rounded-lg border border-border/70 bg-white">{header}{content}</section>;
}

function EvidenceSnapshot({ review, lang, tx }: { review: MedicationEvidenceReview; lang: Lang; tx: Bilingual }) {
  const citations = useMemo(
    () => new Map(review.bundle.citations.map((citation) => [citation.id, citation])),
    [review.bundle.citations],
  );
  const severityDot = (severity: string) => severity === "high"
    ? "bg-rose-600"
    : severity === "warning"
      ? "bg-amber-500"
      : "bg-sky-500";
  return (
    <details className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/15 px-3 py-2.5 marker:hidden">
        <span className="size-1.5 rounded-full bg-orange-500" />
        <span className="text-xs font-semibold text-foreground">{tx("Снимок доказательств", "Evidenz-Snapshot")}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {review.bundle.findings.length + review.bundle.missing_data.length + review.bundle.benefit_assessments.length}
        </span>
      </summary>
      <div className="border-t border-border/60">
        {review.bundle.findings.map((finding) => (
          <div key={finding.id} className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
            <p className="flex items-start gap-2 text-xs font-medium text-foreground">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", severityDot(finding.severity))} />
              <span>{lang === "de" ? finding.title_de : finding.title_ru}</span>
            </p>
            <CitationRefs refs={[finding.citation_ref].filter(Boolean)} citations={citations} tx={tx} />
          </div>
        ))}
        {review.bundle.missing_data.map((missing) => (
          <div key={missing.citation_ref} className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
            <p className="text-xs text-muted-foreground">
              {missingDataReason(missing, lang)}
            </p>
            <CitationRefs refs={[missing.citation_ref].filter(Boolean)} citations={citations} tx={tx} />
          </div>
        ))}
        {review.bundle.benefit_assessments.map((assessment) => (
          <div key={assessment.evidence_ref} className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">
                  G-BA · {assessment.indication_short || assessment.dossier_reference}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {assessment.patient_group || "—"} · {tx("Дополнительная польза", "Zusatznutzen")}: {assessment.benefit_extent || "—"}
                  {assessment.benefit_probability
                    ? ` · ${tx("Вероятность", "Wahrscheinlichkeit")}: ${assessment.benefit_probability}`
                    : ""}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                {assessment.decision_date ? formatEvidenceDate(assessment.decision_date, lang) : "—"}
              </span>
            </div>
            <CitationRefs refs={[assessment.citation_ref].filter(Boolean)} citations={citations} tx={tx} />
          </div>
        ))}
        {review.bundle.benefit_assessments.length > 0 ? (
          <p className="border-t border-border/50 bg-muted/10 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
            {tx(
              "Точное совпадение PZN/ATC не подтверждает показание и не определяет принадлежность конкретного пациента к группе G-BA.",
              "Eine exakte PZN-/ATC-Zuordnung bestätigt weder die Indikation noch die Zugehörigkeit der konkreten Person zur G-BA-Gruppe.",
            )}
          </p>
        ) : null}
        {review.bundle.findings.length === 0
        && review.bundle.missing_data.length === 0
        && review.bundle.benefit_assessments.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-muted-foreground">
            {tx("В снимке нет сигналов или запросов данных.", "Der Snapshot enthält keine Hinweise oder Datenanforderungen.")}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ProvenanceDetails({ review, lang, tx }: { review: MedicationEvidenceReview; lang: Lang; tx: Bilingual }) {
  const sourceById = useMemo(
    () => new Map(review.bundle.sources.map((source) => [source.id, source])),
    [review.bundle.sources],
  );
  return (
    <details className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 bg-muted/15 px-3 py-2.5 marker:hidden">
        <span className="size-1.5 rounded-full bg-orange-500" />
        <span className="text-xs font-semibold text-foreground">{tx("Цитаты и источники", "Zitate und Quellen")}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{review.bundle.citations.length}</span>
      </summary>
      <div className="divide-y divide-border/50 border-t border-border/60">
        {review.bundle.citations.map((citation) => {
          const source = citation.source_id ? sourceById.get(citation.source_id) : null;
          const href = safeExternalUrl(citation.source_url)
            || safeExternalUrl(source?.url ?? null);
          return (
            <div key={citation.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-xs font-medium text-foreground">
                  {source ? officialSourceLabel(source, lang) : citationKindLabel(citation.kind, tx)}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {[citationKindLabel(citation.kind, tx), source?.authority]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-[10px] font-medium text-foreground underline decoration-border underline-offset-2">
                  {tx("Открыть источник", "Quelle öffnen")}
                </a>
              ) : null}
            </div>
          );
        })}
        {review.bundle.citations.length === 0 ? (
          <p className="px-3 py-5 text-center text-xs text-muted-foreground">
            {tx("Источники в результат не включены.", "Das Ergebnis enthält keine Quellen.")}
          </p>
        ) : null}
      </div>
      {review.bundle.sources.length > 0 ? (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2 text-[10px] text-muted-foreground">
          {tx("Зафиксированные источники", "Gespeicherte Quellen")}: {review.bundle.sources.map((source) => {
            const fetched = source.last_successful_snapshot?.fetched_at
              ? formatTimestamp(source.last_successful_snapshot.fetched_at, lang)
              : null;
            return [
              officialSourceLabel(source, lang),
              sourceHealthLabel(source.health, tx),
              fetched,
            ].filter(Boolean).join(" · ");
          }).join("; ")}
        </div>
      ) : null}
    </details>
  );
}

export function MedicationEvidenceReviewContent({
  review = null,
  loading = false,
  error = null,
  language,
  showOverview = true,
  onRetry,
}: MedicationEvidenceReviewContentProps) {
  const { lang: activeLanguage } = useLang();
  const lang = language ?? activeLanguage;
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const citations = useMemo(
    () => new Map((review?.bundle.citations ?? []).map((citation) => [citation.id, citation])),
    [review?.bundle.citations],
  );

  if (loading) {
    return <div role="status" className="py-10 text-center text-xs text-muted-foreground">{tx("Загружаем результат анализа…", "Analyseergebnis wird geladen…")}</div>;
  }
  if (error) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-4 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
        <span>{error}</span>
        {onRetry ? <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRetry}>{tx("Повторить", "Erneut versuchen")}</Button> : null}
      </div>
    );
  }
  if (!review) {
    return <div className="py-10 text-center text-xs text-muted-foreground">{tx("Результат анализа недоступен.", "Das Analyseergebnis ist nicht verfügbar.")}</div>;
  }
  if (!review.permissions.can_read_review) {
    return (
      <div className="rounded-lg border border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
        {tx("У вас нет доступа к результату анализа.", "Sie haben keinen Zugriff auf dieses Analyseergebnis.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showOverview ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className={cn("size-1.5 rounded-full", reviewStatusDot(review.review.status))} />
              {reviewStatusLabel(review.review.status, tx)}
            </span>
            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
              {formatTimestamp(review.review.created_at, lang) || review.review.id}
            </span>
          </div>
          <SummaryStrip summary={review.bundle.summary} tx={tx} />
        </>
      ) : null}

      <DraftGroup
        title={tx("Сводка доказательств", "Evidenzzusammenfassung")}
        items={review.draft.evidence_summary}
        citations={citations}
        lang={lang}
        emptyText={tx("Сводка не сформирована.", "Keine Zusammenfassung vorhanden.")}
        collapsible
      />
      <DraftGroup
        title={tx("Вопросы для проверки", "Prüffragen")}
        items={review.draft.verification_questions}
        citations={citations}
        lang={lang}
        emptyText={tx("Вопросы для проверки отсутствуют.", "Keine Prüffragen vorhanden.")}
        collapsible
        defaultOpen={false}
      />
      <DraftGroup
        title={tx("Ограничения", "Einschränkungen")}
        items={review.draft.limitations}
        citations={citations}
        lang={lang}
        emptyText={tx("Ограничения не перечислены.", "Keine Einschränkungen aufgeführt.")}
        collapsible
        defaultOpen={false}
      />
      <EvidenceSnapshot review={review} lang={lang} tx={tx} />
      <ProvenanceDetails review={review} lang={lang} tx={tx} />
    </div>
  );
}

function aiProviderMessage(provider: MedicationAiProvider, tx: Bilingual) {
  if (provider.reason_code === "data_transfer_not_approved") {
    return tx(
      "AI выключен до документированного разрешения на передачу обезличенных медицинских данных.",
      "KI bleibt deaktiviert, bis die Übertragung de-identifizierter Gesundheitsdaten dokumentiert freigegeben ist.",
    );
  }
  if (provider.reason_code === "api_key_missing" || provider.reason_code === "model_missing") {
    return tx(
      "AI-провайдер включён, но серверная конфигурация ещё не завершена.",
      "Der KI-Anbieter ist aktiviert, die Serverkonfiguration ist jedoch noch unvollständig.",
    );
  }
  if (provider.status === "blocked") {
    return tx(
      "AI-провайдер заблокирован безопасной серверной конфигурацией.",
      "Der KI-Anbieter ist durch die sichere Serverkonfiguration blockiert.",
    );
  }
  if (provider.status === "disabled") {
    return tx("AI-провайдер отключён администратором.", "Der KI-Anbieter wurde administrativ deaktiviert.");
  }
  return tx("AI-провайдер пока не настроен.", "Der KI-Anbieter ist noch nicht konfiguriert.");
}

export function MedicationAiAnalysisSection({
  review,
  provider,
  analysis,
  loading,
  error,
  lang,
  onCreate,
  onRetry,
}: {
  review: MedicationEvidenceReview;
  provider: MedicationAiProvider;
  analysis: MedicationAiAnalysis | null;
  loading: boolean;
  error: string | null;
  lang: Lang;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const citations = useMemo(
    () => new Map(review.bundle.citations.map((citation) => [citation.id, citation])),
    [review.bundle.citations],
  );
  const displayProvider = analysis?.provider ?? provider;
  const ready = displayProvider.status === "ready" && displayProvider.external_calls_enabled;
  return (
    <section aria-label={tx("AI-результат", "KI-Ergebnis")}>
      <div className="space-y-2.5">
        {error && analysis?.status === "ready" ? (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            {error}
          </div>
        ) : null}
        {!ready && analysis?.status !== "ready" ? (
          <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
            <AiMark className="mt-0.5 size-3.5 text-foreground" />
            <span>{aiProviderMessage(displayProvider, tx)}</span>
          </p>
        ) : error && analysis?.status !== "ready" ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={analysis?.status === "failed" ? onRetry : onCreate}>
              <AiMark className="size-3.5" />
              {tx("Повторить", "Erneut versuchen")}
            </Button>
          </div>
        ) : !analysis ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {tx(
                "AI получит только обезличенный снимок доказательств и разрешённые ссылки на цитаты.",
                "Die KI erhält ausschließlich einen de-identifizierten Evidenz-Snapshot und erlaubte Zitatreferenzen.",
              )}
            </p>
            <Button type="button" size="sm" className="min-h-11 shrink-0 rounded-lg sm:min-h-8" disabled={loading} onClick={onCreate}>
              <AiMark className="size-3.5" />
              {loading ? tx("Ставим в очередь…", "Wird eingereiht…") : tx("Сформировать AI-результат", "KI-Ergebnis erstellen")}
            </Button>
          </div>
        ) : analysis.status === "requested" || analysis.status === "processing" ? (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-3 text-xs text-muted-foreground">
            <AiMark className="size-4 animate-pulse text-foreground" />
            {analysis.status === "processing"
              ? tx("AI обрабатывает обезличенные доказательства…", "Die KI verarbeitet die de-identifizierte Evidenz…")
              : tx("AI-анализ ожидает обработки…", "Die KI-Analyse wartet auf Verarbeitung…")}
          </div>
        ) : analysis.status === "failed" ? (
          <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2"><AiMark className="mt-0.5 size-3.5" />{tx("AI-анализ не прошёл безопасную обработку. Доказательства сохранены без изменений.", "Die KI-Analyse konnte nicht sicher verarbeitet werden. Die Evidenz blieb unverändert.")}</span>
            <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" disabled={loading} onClick={onRetry}>
              <AiMark className="size-3.5" />
              {tx("Повторить", "Erneut versuchen")}
            </Button>
          </div>
        ) : analysis.draft ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-[10px] leading-relaxed text-amber-950">
              <AiMark className="mt-0.5 size-3.5" />
              <span>
                {tx(
                  "AI-текст не является медицинским решением. Проверяйте каждое утверждение по прикреплённым источникам.",
                  "KI-Text ist keine medizinische Entscheidung. Prüfen Sie jede Aussage anhand der verknüpften Quellen.",
                )}
              </span>
            </div>
            <div className="grid items-start gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
              <DraftGroup
                ai
                collapsible
                title={tx("Краткий вывод", "Kurzfazit")}
                items={analysis.draft.evidence_summary}
                citations={citations}
                lang={lang}
                emptyText={tx("AI-сводка пуста.", "Die KI-Zusammenfassung ist leer.")}
              />
              <div className="space-y-2.5">
                <DraftGroup
                  ai
                  collapsible
                  defaultOpen={false}
                  title={tx("Что проверить", "Was ist zu prüfen")}
                  items={analysis.draft.verification_questions}
                  citations={citations}
                  lang={lang}
                  emptyText={tx("AI-вопросов нет.", "Keine KI-Prüffragen vorhanden.")}
                />
                <DraftGroup
                  ai
                  collapsible
                  defaultOpen={false}
                  title={tx("Ограничения", "Einschränkungen")}
                  items={analysis.draft.limitations}
                  citations={citations}
                  lang={lang}
                  emptyText={tx("AI-ограничения не перечислены.", "Keine KI-Einschränkungen aufgeführt.")}
                />
              </div>
            </div>
          </>
        ) : (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800">
            {tx(
              "AI-результат имеет неполный формат и не может быть показан. Используйте локальный пакет доказательств.",
              "Das KI-Ergebnis ist unvollständig und kann nicht angezeigt werden. Verwenden Sie das lokale Evidenzpaket.",
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function medicationEvidenceOperationForError(error: unknown): "stale" | "error" {
  return error instanceof ApiRequestError && error.status === 409 ? "stale" : "error";
}

export function resolveMedicationEvidenceIdempotencyKey(
  current: string | null,
  create: () => string = () => {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `medication-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
) {
  return current || create();
}

export type MedicationAiIdempotencyAttempt = {
  patientId: string;
  reviewId: string;
  key: string;
};

export function resolveMedicationAiIdempotencyAttempt(
  current: MedicationAiIdempotencyAttempt | null,
  patientId: string,
  reviewId: string,
  create: () => string = () => {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `medication-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
): MedicationAiIdempotencyAttempt {
  if (current?.patientId === patientId && current.reviewId === reviewId) return current;
  return { patientId, reviewId, key: create() };
}

export function clearMedicationAiIdempotencyAttempt(
  current: MedicationAiIdempotencyAttempt | null,
  patientId: string,
  reviewId: string,
  expectedKey?: string,
): MedicationAiIdempotencyAttempt | null {
  if (
    current?.patientId === patientId
    && current.reviewId === reviewId
    && (expectedKey === undefined || current.key === expectedKey)
  ) return null;
  return current;
}

type SequentialPollingOptions = {
  poll: () => Promise<void>;
  delayMs: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (timer: number) => void;
};

export function startSequentialPolling({
  poll,
  delayMs,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
}: SequentialPollingOptions): () => void {
  let active = true;
  let timer: number | null = null;

  const schedule = () => {
    if (!active) return;
    timer = setTimer(() => {
      timer = null;
      void Promise.resolve()
        .then(poll)
        .catch(() => undefined)
        .finally(schedule);
    }, delayMs);
  };

  schedule();
  return () => {
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
}

type SingleFlightRequest = {
  key: string;
  promise: Promise<void>;
  controller: AbortController;
};

export function createSingleFlightRunner() {
  let inFlight: SingleFlightRequest | null = null;

  return {
    run(key: string, request: (signal: AbortSignal) => Promise<void>): Promise<void> {
      if (inFlight?.key === key) return inFlight.promise;
      if (inFlight) {
        const previous = inFlight;
        inFlight = null;
        previous.controller.abort();
      }

      const controller = new AbortController();
      let promise: Promise<void>;
      try {
        promise = request(controller.signal);
      } catch (error) {
        promise = Promise.reject(error);
      }
      let trackedPromise!: Promise<void>;
      trackedPromise = promise.finally(() => {
        if (inFlight?.promise === trackedPromise) inFlight = null;
      });
      inFlight = { key, promise: trackedPromise, controller };
      return trackedPromise;
    },
    clear(): void {
      const current = inFlight;
      inFlight = null;
      current?.controller.abort();
    },
  };
}

export function isMedicationAiRequestAbort(error: unknown): boolean {
  return (error instanceof ApiRequestError && error.code === "aborted")
    || (error instanceof Error && error.name === "AbortError");
}

export function medicationAiAnalysisBelongsToReview(
  analysis: MedicationAiAnalysis,
  reviewId: string,
): boolean {
  return analysis.id.length > 0 && analysis.review_id === reviewId;
}

export function medicationAiRealtimeEventMatches(
  event: RealtimeEvent,
  patientId: string,
  reviewId: string,
): boolean {
  if (!MEDICATION_AI_RESULT_REALTIME_EVENTS.includes(
    event.type as (typeof MEDICATION_AI_RESULT_REALTIME_EVENTS)[number],
  )) return false;

  if (event.patient_id != null) {
    if (event.patient_id !== patientId) return false;
  } else if (event.entity_type !== "patient" || event.entity_id !== patientId) {
    return false;
  }

  return typeof event.payload?.review_id === "string"
    && event.payload.review_id === reviewId;
}

export function MedicationEvidenceReviewPanel({
  patientId,
  refreshKey,
  fetchPreviewer = fetchMedicationEvidenceReviewPreview,
}: MedicationEvidenceReviewPanelProps) {
  const { lang } = useLang();
  const [reloadToken, setReloadToken] = useState(0);
  const [previewState, setPreviewState] = useState<{
    patientId: string;
    data: MedicationEvidenceReviewPreview | null;
    loading: boolean;
    error: boolean;
  }>({ patientId, data: null, loading: true, error: false });
  const [operation, setOperation] = useState<"idle" | "creating" | "stale" | "error">("idle");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"ai" | "evidence">("ai");
  const [review, setReview] = useState<MedicationEvidenceReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<MedicationAiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const requestEpochRef = useRef(0);
  const aiRequestEpochRef = useRef(0);
  const dialogOpenRef = useRef(false);
  const activeReviewIdRef = useRef<string | null>(null);
  const [aiLoadRunner] = useState(createSingleFlightRunner);
  const idempotencyKeyRef = useRef<string | null>(null);
  const aiIdempotencyAttemptRef = useRef<MedicationAiIdempotencyAttempt | null>(null);
  const pendingFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreviewState({ patientId, data: null, loading: true, error: false });
    void fetchPreviewer(patientId)
      .then((data) => {
        if (active) setPreviewState({ patientId, data, loading: false, error: false });
      })
      .catch(() => {
        if (active) setPreviewState({ patientId, data: null, loading: false, error: true });
      });
    return () => {
      active = false;
    };
  }, [fetchPreviewer, patientId, refreshKey, reloadToken]);

  useEffect(() => {
    requestEpochRef.current += 1;
    dialogOpenRef.current = false;
    activeReviewIdRef.current = null;
    setDialogOpen(false);
    setDialogTab("ai");
    setReview(null);
    setReviewId(null);
    setReviewError(null);
    setAiAnalysis(null);
    setAiLoading(false);
    setAiError(null);
    setOperation("idle");
    setOperationError(null);
    idempotencyKeyRef.current = null;
    aiIdempotencyAttemptRef.current = null;
    pendingFingerprintRef.current = null;
    aiRequestEpochRef.current += 1;
    aiLoadRunner.clear();
  }, [aiLoadRunner, patientId]);

  useEffect(() => () => {
    aiRequestEpochRef.current += 1;
    dialogOpenRef.current = false;
    activeReviewIdRef.current = null;
    aiLoadRunner.clear();
  }, [aiLoadRunner]);

  const currentPreview = previewState.patientId === patientId
    ? previewState
    : { patientId, data: null, loading: true, error: false };

  const loadExistingAiAnalysis = useCallback((nextReviewId: string, showLoading = true) => {
    if (showLoading) setAiLoading(true);
    const requestKey = `${patientId}:${nextReviewId}`;
    return aiLoadRunner.run(requestKey, async (signal) => {
      const epoch = ++aiRequestEpochRef.current;
      setAiError(null);
      try {
        const loaded = await fetchMedicationAiAnalysis(patientId, nextReviewId, signal);
        if (epoch !== aiRequestEpochRef.current) return;
        if (!medicationAiAnalysisBelongsToReview(loaded, nextReviewId)) {
          setAiAnalysis(null);
          setAiError(lang === "de"
            ? "Die KI-Antwort gehört nicht zur geöffneten Evidenzprüfung."
            : "Ответ AI не относится к открытой проверке доказательств.");
          return;
        }
        aiIdempotencyAttemptRef.current = clearMedicationAiIdempotencyAttempt(
          aiIdempotencyAttemptRef.current,
          patientId,
          nextReviewId,
        );
        setAiAnalysis(loaded);
      } catch (loadError) {
        if (epoch !== aiRequestEpochRef.current) return;
        if (isMedicationAiRequestAbort(loadError)) return;
        if (loadError instanceof ApiRequestError && loadError.status === 404) {
          setAiAnalysis(null);
        } else {
          setAiError(lang === "de" ? "Der KI-Status konnte nicht geladen werden." : "Не удалось загрузить статус AI-анализа.");
        }
      } finally {
        if (epoch === aiRequestEpochRef.current) setAiLoading(false);
      }
    });
  }, [aiLoadRunner, lang, patientId]);

  useRealtimeSubscription(MEDICATION_AI_RESULT_REALTIME_EVENTS, (event) => {
    const activeReviewId = activeReviewIdRef.current;
    if (!dialogOpenRef.current || !activeReviewId) return;
    if (!medicationAiRealtimeEventMatches(event, patientId, activeReviewId)) return;
    void loadExistingAiAnalysis(activeReviewId, false);
  });

  useEffect(() => {
    if (
      !dialogOpen
      || !reviewId
      || aiAnalysis?.provider.status !== "ready"
      || (aiAnalysis?.status !== "requested" && aiAnalysis?.status !== "processing")
    ) return;
    return startSequentialPolling({
      poll: () => dialogOpenRef.current && activeReviewIdRef.current === reviewId
        ? loadExistingAiAnalysis(reviewId, false)
        : Promise.resolve(),
      delayMs: 2_000,
    });
  }, [aiAnalysis?.provider.status, aiAnalysis?.status, dialogOpen, loadExistingAiAnalysis, reviewId]);

  const createAiDraftForReview = async (nextReviewId: string) => {
    const epoch = ++aiRequestEpochRef.current;
    aiLoadRunner.clear();
    const attempt = resolveMedicationAiIdempotencyAttempt(
      aiIdempotencyAttemptRef.current,
      patientId,
      nextReviewId,
    );
    aiIdempotencyAttemptRef.current = attempt;
    setAiLoading(true);
    setAiError(null);
    try {
      const created = await createMedicationAiAnalysis(patientId, nextReviewId, attempt.key);
      if (epoch !== aiRequestEpochRef.current) return;
      if (!medicationAiAnalysisBelongsToReview(created, nextReviewId)) {
        setAiError(lang === "de"
          ? "Die KI-Antwort gehört nicht zur geöffneten Evidenzprüfung."
          : "Ответ AI не относится к открытой проверке доказательств.");
        return;
      }
      setAiAnalysis(created);
      aiIdempotencyAttemptRef.current = clearMedicationAiIdempotencyAttempt(
        aiIdempotencyAttemptRef.current,
        patientId,
        nextReviewId,
        attempt.key,
      );
    } catch {
      if (epoch !== aiRequestEpochRef.current) return;
      setAiError(lang === "de" ? "Die KI-Analyse konnte nicht angefordert werden." : "Не удалось запустить AI-анализ.");
    } finally {
      if (epoch === aiRequestEpochRef.current) setAiLoading(false);
    }
  };

  const createReview = async (fingerprint: string) => {
    const epoch = ++requestEpochRef.current;
    const idempotencyKey = resolveMedicationEvidenceIdempotencyKey(idempotencyKeyRef.current);
    idempotencyKeyRef.current = idempotencyKey;
    pendingFingerprintRef.current = fingerprint;
    setOperation("creating");
    setOperationError(null);
    try {
      const created = await createMedicationEvidenceReview(patientId, {
        intelligence_fingerprint: fingerprint,
        idempotency_key: idempotencyKey,
      });
      if (epoch !== requestEpochRef.current) return;
      idempotencyKeyRef.current = null;
      pendingFingerprintRef.current = null;
      setOperation("idle");
      if (created.permissions.can_read_review) {
        aiRequestEpochRef.current += 1;
        aiLoadRunner.clear();
        setAiLoading(false);
        setReview(created);
        setReviewId(created.review.id);
        activeReviewIdRef.current = created.review.id;
        setReviewError(null);
        dialogOpenRef.current = true;
        setDialogOpen(true);
        setAiAnalysis(null);
        setAiError(null);
        const aiProvider = currentPreview.data?.ai_provider;
        if (aiProvider?.status === "ready" && aiProvider.external_calls_enabled) {
          void createAiDraftForReview(created.review.id);
        }
      }
      setReloadToken((token) => token + 1);
    } catch (createError) {
      if (epoch !== requestEpochRef.current) return;
      const nextOperation = medicationEvidenceOperationForError(createError);
      setOperation(nextOperation);
      if (nextOperation === "stale") {
        idempotencyKeyRef.current = null;
        pendingFingerprintRef.current = null;
      } else {
        setOperationError(
          lang === "de"
            ? "Die KI-Analyse konnte nicht vorbereitet werden."
            : "Не удалось подготовить AI-анализ.",
        );
      }
    }
  };

  const openReview = async (nextReviewId: string) => {
    const epoch = ++requestEpochRef.current;
    aiRequestEpochRef.current += 1;
    aiLoadRunner.clear();
    activeReviewIdRef.current = nextReviewId;
    setReviewId(nextReviewId);
    setReview(null);
    setReviewError(null);
    setReviewLoading(true);
    setAiAnalysis(null);
    setAiLoading(false);
    setAiError(null);
    setDialogTab("ai");
    dialogOpenRef.current = true;
    setDialogOpen(true);
    try {
      const loaded = await fetchMedicationEvidenceReview(patientId, nextReviewId);
      if (epoch !== requestEpochRef.current) return;
      setReview(loaded);
      setReviewLoading(false);
      void loadExistingAiAnalysis(nextReviewId);
    } catch {
      if (epoch !== requestEpochRef.current) return;
      setReviewLoading(false);
      setReviewError(
        lang === "de"
          ? "Das Analyseergebnis konnte nicht geladen werden."
          : "Не удалось загрузить результат анализа.",
      );
    }
  };

  const createAiDraft = async () => {
    if (!reviewId) return;
    await createAiDraftForReview(reviewId);
  };

  const retryAiDraft = async () => {
    if (!reviewId) return;
    const epoch = ++aiRequestEpochRef.current;
    aiLoadRunner.clear();
    setAiLoading(true);
    setAiError(null);
    try {
      const retried = await retryMedicationAiAnalysis(patientId, reviewId);
      if (epoch !== aiRequestEpochRef.current) return;
      if (!medicationAiAnalysisBelongsToReview(retried, reviewId)) {
        setAiAnalysis(null);
        setAiError(lang === "de"
          ? "Die KI-Antwort gehört nicht zur geöffneten Evidenzprüfung."
          : "Ответ AI не относится к открытой проверке доказательств.");
        return;
      }
      setAiAnalysis(retried);
      aiIdempotencyAttemptRef.current = clearMedicationAiIdempotencyAttempt(
        aiIdempotencyAttemptRef.current,
        patientId,
        reviewId,
      );
    } catch (retryError) {
      if (epoch !== aiRequestEpochRef.current) return;
      if (retryError instanceof ApiRequestError && retryError.status === 409) {
        setAiAnalysis(null);
        aiIdempotencyAttemptRef.current = clearMedicationAiIdempotencyAttempt(
          aiIdempotencyAttemptRef.current,
          patientId,
          reviewId,
        );
        setAiError(lang === "de"
          ? "Die KI-Konfiguration wurde geändert. Starten Sie die KI-Analyse erneut."
          : "Конфигурация AI изменилась. Запустите AI-анализ повторно.");
      } else {
        setAiError(lang === "de" ? "Die KI-Analyse konnte nicht erneut gestartet werden." : "Не удалось повторно запустить AI-анализ.");
      }
    } finally {
      if (epoch === aiRequestEpochRef.current) setAiLoading(false);
    }
  };

  const refreshStalePreview = () => {
    idempotencyKeyRef.current = null;
    pendingFingerprintRef.current = null;
    setOperation("idle");
    setOperationError(null);
    setReloadToken((token) => token + 1);
  };

  return (
    <>
      <MedicationEvidenceReviewPanelContent
        preview={currentPreview.data}
        loading={currentPreview.loading}
        error={currentPreview.error
          ? lang === "de"
            ? "Die Analysevorschau konnte nicht geladen werden."
            : "Не удалось загрузить предварительные данные анализа."
          : null}
        operation={operation}
        operationError={operationError}
        language={lang}
        onRetryPreview={() => setReloadToken((token) => token + 1)}
        onCreate={currentPreview.data
          ? () => void createReview(currentPreview.data!.intelligence_fingerprint)
          : undefined}
        onRetryCreate={() => {
          const fingerprint = pendingFingerprintRef.current;
          if (fingerprint) void createReview(fingerprint);
        }}
        onRefreshStale={refreshStalePreview}
        onViewLatest={(nextReviewId) => void openReview(nextReviewId)}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (open) return;
          dialogOpenRef.current = false;
          activeReviewIdRef.current = null;
          requestEpochRef.current += 1;
          aiRequestEpochRef.current += 1;
          aiLoadRunner.clear();
          setDialogOpen(false);
          setReviewLoading(false);
          setReviewError(null);
          setAiLoading(false);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-h-[min(88dvh,760px)] sm:max-w-5xl">
          <DialogHeader className="border-b border-border/60 px-4 py-3.5 pr-12">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <DialogTitle className="flex items-center gap-2">
                <AiMark className="size-4" />
                {lang === "de" ? "KI-Medikationsanalyse" : "AI-анализ медикаментов"}
              </DialogTitle>
              {review ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-foreground">
                    <span className={cn("size-1.5 rounded-full", reviewStatusDot(review.review.status))} />
                    {reviewStatusLabel(review.review.status, (ru, de) => (lang === "de" ? de : ru))}
                  </span>
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[9px] font-medium text-sky-700">
                    {formatTimestamp(review.review.created_at, lang) || review.review.id}
                  </span>
                </div>
              ) : null}
            </div>
            <DialogDescription className="sr-only">
              {lang === "de"
                ? "Quellen, Evidenz und KI-Ergebnis."
                : "Источники, доказательства и AI-результат."}
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={dialogTab}
            onValueChange={(value) => setDialogTab(value as "ai" | "evidence")}
            className="min-h-0 max-h-[calc(100dvh-5rem)] gap-0 overflow-hidden sm:max-h-[calc(88dvh-4rem)]"
          >
            <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="h-8" aria-label={lang === "de" ? "Analysebereiche" : "Разделы анализа"}>
                <TabsTrigger
                  value="ai"
                  className="px-3 text-xs data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none"
                >
                  <AiMark className="size-3.5" />
                  {lang === "de" ? "KI-Ergebnis" : "AI-результат"}
                </TabsTrigger>
                <TabsTrigger
                  value="evidence"
                  className="px-3 text-xs data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none"
                >
                  {lang === "de" ? "Evidenzpaket" : "Доказательства"}
                </TabsTrigger>
              </TabsList>
              {review ? (
                <SummaryStrip
                  summary={review.bundle.summary}
                  tx={(ru, de) => (lang === "de" ? de : ru)}
                />
              ) : null}
            </div>
            <TabsContent value="ai" className="min-h-0 overflow-y-auto p-4">
              {review ? (
                <MedicationAiAnalysisSection
                  review={review}
                  provider={currentPreview.data?.ai_provider ?? {
                    kind: "none",
                    status: "not_configured",
                    external_calls_enabled: false,
                    reason_code: "external_provider_not_configured",
                    model: null,
                  }}
                  analysis={aiAnalysis}
                  loading={aiLoading}
                  error={aiError}
                  lang={lang}
                  onCreate={() => void createAiDraft()}
                  onRetry={() => void retryAiDraft()}
                />
              ) : (
                <MedicationEvidenceReviewContent
                  review={review}
                  loading={reviewLoading}
                  error={reviewError}
                  language={lang}
                  showOverview={false}
                  onRetry={reviewId ? () => void openReview(reviewId) : undefined}
                />
              )}
            </TabsContent>
            <TabsContent value="evidence" className="min-h-0 overflow-y-auto p-4">
              <MedicationEvidenceReviewContent
                review={review}
                loading={reviewLoading}
                error={reviewError}
                language={lang}
                showOverview={false}
                onRetry={reviewId ? () => void openReview(reviewId) : undefined}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
