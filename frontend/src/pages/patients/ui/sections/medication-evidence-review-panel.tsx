import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api";
import {
  createMedicationEvidenceReview,
  fetchMedicationEvidenceReview,
  fetchMedicationEvidenceReviewPreview,
  type MedicationEvidenceCitation,
  type MedicationEvidenceDraftItem,
  type MedicationEvidenceReview,
  type MedicationEvidenceReviewPreview,
  type MedicationEvidenceReviewStatus,
  type MedicationEvidenceSummary,
} from "@/lib/api/medication-evidence-reviews";
import { useLang, type Lang } from "@/lib/i18n";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { cn } from "@/lib/utils";

type Bilingual = (ru: string, de: string) => string;

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

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function reviewStatusLabel(status: MedicationEvidenceReviewStatus, tx: Bilingual) {
  if (status === "draft_ready") return tx("Пакет готов", "Paket bereit");
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
    [tx("Медикаменты", "Medikamente"), summary.active_medications],
    [tx("Идентифицированы", "Identifiziert"), summary.identified_medications],
    [tx("Не определены", "Nicht zugeordnet"), summary.unresolved_medications],
    [tx("Сигналы", "Hinweise"), summary.findings_total],
    [tx("Высокий приоритет", "Hohe Priorität"), summary.high_priority_findings],
    [tx("Не хватает данных", "Fehlende Daten"), summary.missing_data_total],
  ] as const;
  return (
    <div className="grid overflow-hidden rounded-lg border border-border/60 bg-white grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value], index) => (
        <div
          key={label}
          className={cn(
            "min-w-0 border-border/50 px-3 py-2",
            index > 0 && "border-l",
            index > 1 && "border-t sm:border-t-0",
            index > 2 && "sm:border-t xl:border-t-0",
          )}
        >
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
        </div>
      ))}
    </div>
  );
}

function LocalEvidenceNotice({ tx }: { tx: Bilingual }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">
        {tx("Локальный пакет доказательств", "Lokales Evidenzpaket")}
      </p>
      <p className="mt-0.5">
        {tx(
          "Внешний AI-провайдер не настроен и внешние вызовы не выполняются. Пакет формируется детерминированно из зафиксированных данных Medication Intelligence.",
          "Es ist kein externer AI-Anbieter konfiguriert und es erfolgen keine externen Aufrufe. Das Paket wird deterministisch aus den gespeicherten Medication-Intelligence-Daten erstellt.",
        )}
      </p>
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
    <section className="overflow-hidden rounded-lg border border-border/70 bg-white" aria-label="Evidence Copilot">
      <header className="flex flex-col gap-2 border-b border-border/60 bg-muted/15 px-3.5 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="size-2 rounded-full bg-foreground/70" />
            <h2 className="text-[13px] font-semibold text-foreground">Evidence Copilot</h2>
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
              {tx("Только локальные доказательства", "Nur lokale Evidenz")}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {tx(
              "Неизменяемый пакет проверяемых фактов, вопросов и ограничений — без рекомендаций по лечению.",
              "Unveränderliches Paket prüfbarer Fakten, Fragen und Einschränkungen – ohne Therapieempfehlungen.",
            )}
          </p>
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
            {tx("Загружаем доступность пакета…", "Paketverfügbarkeit wird geladen…")}
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
            {tx("Предпросмотр пакета недоступен.", "Die Paketvorschau ist nicht verfügbar.")}
          </div>
        ) : (
          <>
            <LocalEvidenceNotice tx={tx} />
            <SummaryStrip summary={preview.summary} tx={tx} />

            {operation === "stale" ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {tx(
                    "Medication Intelligence изменился. Обновите предпросмотр и сформируйте пакет из актуальных данных.",
                    "Medication Intelligence hat sich geändert. Aktualisieren Sie die Vorschau und erstellen Sie das Paket aus den aktuellen Daten.",
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
                <span>{operationError || tx("Не удалось сформировать пакет.", "Das Paket konnte nicht erstellt werden.")}</span>
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
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {latestCreatedAt || preview.latest_review.id}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {tx("Пакеты доказательств ещё не создавались.", "Es wurden noch keine Evidenzpakete erstellt.")}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {tx(
                    "Клиническое согласование не настроено; кнопки подтверждения здесь нет.",
                    "Eine klinische Freigabe ist nicht konfiguriert; es gibt hier keine Freigabeaktion.",
                  )}
                </p>
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
                    {tx("Открыть пакет", "Paket öffnen")}
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
                    {operation === "creating"
                      ? tx("Формируем…", "Wird erstellt…")
                      : tx("Создать пакет доказательств", "Evidenzpaket erstellen")}
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
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {refs.map((ref) => {
        const citation = citations.get(ref);
        const href = safeExternalUrl(citation?.source_url ?? null);
        return href ? (
          <a
            key={ref}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-border/70 bg-white px-2 py-0.5 font-mono text-[9px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
          >
            {tx("Источник", "Quelle")} · {ref}
          </a>
        ) : (
          <span key={ref} className="rounded-full border border-border/70 bg-white px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
            {ref}
          </span>
        );
      })}
    </div>
  );
}

function DraftGroup({
  title,
  items,
  citations,
  lang,
  emptyText,
}: {
  title: string;
  items: MedicationEvidenceDraftItem[];
  citations: Map<string, MedicationEvidenceCitation>;
  lang: Lang;
  emptyText: string;
}) {
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <header className="flex items-center gap-2 border-b border-border/60 bg-muted/15 px-3 py-2.5">
        <span className="size-1.5 rounded-full bg-foreground/70" />
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="px-3 py-5 text-center text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="divide-y divide-border/50">
          {items.map((item, index) => (
            <li key={`${index}:${item.citation_refs.join(":")}`} className="px-3 py-2.5">
              <p className="break-words text-xs leading-relaxed text-foreground">
                {lang === "de" ? item.text_de : item.text_ru}
              </p>
              <CitationRefs refs={item.citation_refs} citations={citations} tx={tx} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
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
        <span className="size-1.5 rounded-full bg-foreground/70" />
        <span className="text-xs font-semibold text-foreground">{tx("Снимок доказательств", "Evidenz-Snapshot")}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {review.bundle.findings.length + review.bundle.missing_data.length}
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
          <div key={missing.code} className="border-b border-border/50 px-3 py-2.5 last:border-b-0">
            <p className="text-xs text-muted-foreground">
              {lang === "de" ? missing.reason_de : missing.reason_ru}
            </p>
            <CitationRefs refs={[missing.citation_ref].filter(Boolean)} citations={citations} tx={tx} />
          </div>
        ))}
        {review.bundle.findings.length === 0 && review.bundle.missing_data.length === 0 ? (
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
        <span className="size-1.5 rounded-full bg-foreground/70" />
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
                <p className="break-all font-mono text-[10px] text-foreground">{citation.id}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {[citation.kind, source?.label, source?.authority].filter(Boolean).join(" · ")}
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
            {tx("Цитаты в пакет не включены.", "Das Paket enthält keine Zitate.")}
          </p>
        ) : null}
      </div>
      {review.bundle.sources.length > 0 ? (
        <div className="border-t border-border/60 bg-muted/10 px-3 py-2 text-[10px] text-muted-foreground">
          {tx("Зафиксированные источники", "Gespeicherte Quellen")}: {review.bundle.sources.map((source) => {
            const fetched = source.last_successful_snapshot?.fetched_at
              ? formatTimestamp(source.last_successful_snapshot.fetched_at, lang)
              : null;
            return [source.label || source.authority, source.health, fetched].filter(Boolean).join(" · ");
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
    return <div role="status" className="py-10 text-center text-xs text-muted-foreground">{tx("Загружаем пакет…", "Paket wird geladen…")}</div>;
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
    return <div className="py-10 text-center text-xs text-muted-foreground">{tx("Пакет недоступен.", "Das Paket ist nicht verfügbar.")}</div>;
  }
  if (!review.permissions.can_read_review) {
    return (
      <div className="rounded-lg border border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
        {tx("У вас нет доступа к просмотру этого пакета.", "Sie haben keinen Zugriff auf dieses Paket.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <span className={cn("size-1.5 rounded-full", reviewStatusDot(review.review.status))} />
          {reviewStatusLabel(review.review.status, tx)}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {review.bundle.version} · {formatTimestamp(review.review.created_at, lang) || review.review.id}
        </span>
      </div>
      <LocalEvidenceNotice tx={tx} />
      <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
        {tx(
          "Клиническое согласование не настроено. Этот пакет предназначен только для чтения и медицинской проверки уполномоченным специалистом.",
          "Eine klinische Freigabe ist nicht konfiguriert. Dieses Paket dient ausschließlich der Lektüre und medizinischen Prüfung durch autorisierte Fachpersonen.",
        )}
      </div>
      <SummaryStrip summary={review.bundle.summary} tx={tx} />

      <DraftGroup
        title={tx("Сводка доказательств", "Evidenzzusammenfassung")}
        items={review.draft.evidence_summary}
        citations={citations}
        lang={lang}
        emptyText={tx("Сводка не сформирована.", "Keine Zusammenfassung vorhanden.")}
      />
      <DraftGroup
        title={tx("Вопросы для проверки", "Prüffragen")}
        items={review.draft.verification_questions}
        citations={citations}
        lang={lang}
        emptyText={tx("Вопросы для проверки отсутствуют.", "Keine Prüffragen vorhanden.")}
      />
      <DraftGroup
        title={tx("Ограничения", "Einschränkungen")}
        items={review.draft.limitations}
        citations={citations}
        lang={lang}
        emptyText={tx("Ограничения не перечислены.", "Keine Einschränkungen aufgeführt.")}
      />
      <EvidenceSnapshot review={review} lang={lang} tx={tx} />
      <ProvenanceDetails review={review} lang={lang} tx={tx} />
    </div>
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
  const [review, setReview] = useState<MedicationEvidenceReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const requestEpochRef = useRef(0);
  const idempotencyKeyRef = useRef<string | null>(null);
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
    setDialogOpen(false);
    setReview(null);
    setReviewId(null);
    setReviewError(null);
    setOperation("idle");
    setOperationError(null);
    idempotencyKeyRef.current = null;
    pendingFingerprintRef.current = null;
  }, [patientId]);

  const currentPreview = previewState.patientId === patientId
    ? previewState
    : { patientId, data: null, loading: true, error: false };

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
        setReview(created);
        setReviewId(created.review.id);
        setReviewError(null);
        setDialogOpen(true);
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
            ? "Das Evidenzpaket konnte nicht erstellt werden."
            : "Не удалось создать пакет доказательств.",
        );
      }
    }
  };

  const openReview = async (nextReviewId: string) => {
    const epoch = ++requestEpochRef.current;
    setReviewId(nextReviewId);
    setReview(null);
    setReviewError(null);
    setReviewLoading(true);
    setDialogOpen(true);
    try {
      const loaded = await fetchMedicationEvidenceReview(patientId, nextReviewId);
      if (epoch !== requestEpochRef.current) return;
      setReview(loaded);
      setReviewLoading(false);
    } catch {
      if (epoch !== requestEpochRef.current) return;
      setReviewLoading(false);
      setReviewError(
        lang === "de"
          ? "Das Evidenzpaket konnte nicht geladen werden."
          : "Не удалось загрузить пакет доказательств.",
      );
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
            ? "Die Paketvorschau konnte nicht geladen werden."
            : "Не удалось загрузить предпросмотр пакета."
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
          requestEpochRef.current += 1;
          setDialogOpen(false);
          setReviewLoading(false);
          setReviewError(null);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader className="border-b border-border/60 pb-3">
            <DialogTitle>Evidence Copilot</DialogTitle>
            <DialogDescription>
              {lang === "de"
                ? "Unveränderliches lokales Evidenzpaket – ohne externe Provider, Therapieempfehlung oder klinische Freigabe."
                : "Неизменяемый локальный пакет доказательств — без внешнего провайдера, рекомендаций по лечению или клинического согласования."}
            </DialogDescription>
          </DialogHeader>
          <MedicationEvidenceReviewContent
            review={review}
            loading={reviewLoading}
            error={reviewError}
            language={lang}
            onRetry={reviewId ? () => void openReview(reviewId) : undefined}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
