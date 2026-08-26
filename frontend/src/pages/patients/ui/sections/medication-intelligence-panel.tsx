import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api";
import {
  confirmMedicationIdentity,
  fetchMedicationIntelligence,
  generateMedicationIdentityCandidates,
  type MedicationIdentityCandidateSet,
  type MedicationIdentityConfirmationInput,
  type MedicationIntelligenceFinding,
  type MedicationIntelligenceResponse,
  type MedicationIntelligenceSeverity,
  type MedicationIntelligenceSource,
} from "@/lib/api/medication-intelligence";
import { useLang, type Lang } from "@/lib/i18n";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { cn } from "@/lib/utils";

import {
  MedicationIdentityAction,
  MedicationIdentityWorkflow,
  type MedicationIdentityWorkflowStatus,
} from "./medication-identity-workflow";

type Bilingual = (ru: string, de: string) => string;

type MedicationIntelligencePanelProps = {
  patientId: string;
  refreshKey?: string | number;
  fetcher?: typeof fetchMedicationIntelligence;
};

type MedicationIntelligencePanelContentProps = {
  data?: MedicationIntelligenceResponse | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onIdentifyMedication?: (medicationId: string) => void;
  language?: Lang;
};

const DISCLAIMER_RU =
  "Проверка использует только открытые источники. Отсутствие предупреждения не доказывает отсутствие взаимодействия. Любые изменения терапии требуют медицинской проверки.";
const DISCLAIMER_DE =
  "Die Prüfung verwendet ausschließlich offene Quellen. Das Fehlen eines Warnhinweises beweist nicht, dass keine Wechselwirkung besteht. Jede Therapieänderung erfordert eine medizinische Prüfung.";

const SEVERITY_ORDER: MedicationIntelligenceSeverity[] = ["high", "warning", "info"];

const SEVERITY_DOT: Record<MedicationIntelligenceSeverity, string> = {
  high: "bg-rose-600",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

function formatGeneratedAt(value: string, lang: Lang): string | null {
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

function severityLabel(severity: MedicationIntelligenceSeverity, tx: Bilingual) {
  if (severity === "high") return tx("Высокий приоритет", "Hohe Priorität");
  if (severity === "warning") return tx("Предупреждения", "Warnhinweise");
  return tx("Информация", "Informationen");
}

function sourceProvenanceLabel(source: MedicationIntelligenceSource, tx: Bilingual) {
  if (source.ingestion_status === "planned") {
    return tx("Коннектор запланирован", "Connector geplant");
  }
  if (source.ingestion_status === "manual_reference") {
    return tx("Только официальная ссылка", "Nur offizieller Verweis");
  }
  if (source.ingestion_status === "error") {
    return tx("Источник недоступен", "Quelle nicht verfügbar");
  }
  if (!source.last_successful_snapshot) {
    return tx("Успешного снимка ещё нет", "Noch kein erfolgreicher Snapshot");
  }
  if (source.health === "fresh") return tx("Актуальный снимок", "Aktueller Snapshot");
  if (source.health === "stale") return tx("Снимок устарел", "Snapshot veraltet");
  if (source.health === "error") {
    return tx("Ошибка обновления · используется последний снимок", "Aktualisierungsfehler · letzter Snapshot wird verwendet");
  }
  return tx("Успешного снимка ещё нет", "Noch kein erfolgreicher Snapshot");
}

function sourceProvenanceDot(source: MedicationIntelligenceSource) {
  if (source.ingestion_status === "planned" || source.ingestion_status === "manual_reference") {
    return "bg-slate-400";
  }
  if (source.ingestion_status === "error" || source.health === "error") return "bg-rose-500";
  if (!source.last_successful_snapshot) return "bg-slate-400";
  if (source.health === "fresh") return "bg-emerald-500";
  if (source.health === "stale") return "bg-amber-500";
  return "bg-slate-400";
}

function sourceErrorLabel(code: string, tx: Bilingual) {
  const labels: Record<string, [string, string]> = {
    upstream_timeout: [
      "Источник не ответил вовремя.",
      "Die Quelle hat nicht rechtzeitig geantwortet.",
    ],
    upstream_request_failed: [
      "Не удалось выполнить запрос к источнику.",
      "Die Anfrage an die Quelle ist fehlgeschlagen.",
    ],
    upstream_http_status: [
      "Источник вернул ошибочный HTTP-статус.",
      "Die Quelle hat einen fehlerhaften HTTP-Status zurückgegeben.",
    ],
    unexpected_content_type: [
      "Источник вернул неподдерживаемый формат данных.",
      "Die Quelle hat ein nicht unterstütztes Datenformat zurückgegeben.",
    ],
    payload_too_large: [
      "Полученные данные превышают допустимый размер.",
      "Die empfangenen Daten überschreiten die zulässige Größe.",
    ],
    invalid_feed: [
      "Лента источника не прошла проверку.",
      "Der Quellen-Feed konnte nicht validiert werden.",
    ],
    snapshot_persistence_failed: [
      "Не удалось сохранить снимок источника.",
      "Der Quellen-Snapshot konnte nicht gespeichert werden.",
    ],
    client_configuration_failed: [
      "Ошибка конфигурации клиента источника.",
      "Die Konfiguration des Quellen-Clients ist fehlerhaft.",
    ],
    worker_lease_expired: [
      "Время выполнения задания обновления истекло.",
      "Das Zeitfenster des Aktualisierungsauftrags ist abgelaufen.",
    ],
    ingestion_failed: [
      "Не удалось обработать данные источника.",
      "Die Daten der Quelle konnten nicht verarbeitet werden.",
    ],
  };
  const label = labels[code];
  return label
    ? tx(label[0], label[1])
    : tx("Техническая причина не классифицирована.", "Die technische Ursache ist nicht klassifiziert.");
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function SummaryGrid({ data, tx }: { data: MedicationIntelligenceResponse; tx: Bilingual }) {
  const metrics = [
    [tx("Активные препараты", "Aktive Medikamente"), data.summary.active_medications],
    [tx("Идентифицированы", "Identifiziert"), data.summary.identified_medications],
    [tx("Не определены", "Nicht zugeordnet"), data.summary.unresolved_medications],
    [tx("Найдено сигналов", "Hinweise"), data.summary.findings_total],
    [tx("Высокий приоритет", "Hohe Priorität"), data.summary.high_priority_findings],
    [tx("Не хватает данных", "Fehlende Daten"), data.summary.missing_data_total],
  ] as const;

  return (
    <div className="grid overflow-hidden rounded-lg border border-border/70 bg-white sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {metrics.map(([label, value], index) => (
        <div
          key={label}
          className={cn(
            "min-w-0 border-border/60 px-3 py-2.5",
            index > 0 && "border-t sm:border-t-0 sm:border-l",
            index === 2 && "sm:border-t lg:border-t-0",
            index === 3 && "sm:border-t xl:border-t-0",
            index === 4 && "sm:border-t",
            index === 5 && "sm:border-t",
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground">
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function OfficialSafetyAlertFinding({
  finding,
  source,
  lang,
  tx,
}: {
  finding: MedicationIntelligenceFinding;
  source?: MedicationIntelligenceSource;
  lang: Lang;
  tx: Bilingual;
}) {
  const publishedAt = finding.published_at
    ? formatGeneratedAt(finding.published_at, lang)
    : null;
  const officialDocumentUrl = source && finding.source_url
    ? safeExternalUrl(finding.source_url)
    : null;
  const isBfarm = Boolean(
    source && `${source.authority} ${source.label}`.toLocaleLowerCase().includes("bfarm"),
  );

  return (
    <article className="px-3.5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            {isBfarm
              ? "BfArM Rote-Hand-Brief"
              : tx("Официальное предупреждение безопасности", "Offizieller Sicherheitshinweis")}
          </p>
          <p className="mt-1 break-words text-[13px] font-semibold text-foreground">
            {lang === "de" ? finding.title_de : finding.title_ru}
          </p>
        </div>
        {officialDocumentUrl ? (
          <a
            href={officialDocumentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-border bg-white px-3 text-[11px] font-medium text-foreground hover:bg-muted/40"
          >
            {tx("Открыть официальный документ", "Offizielles Dokument öffnen")}
          </a>
        ) : null}
      </div>

      <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
        {lang === "de" ? finding.detail_de : finding.detail_ru}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {publishedAt ? (
          <span>
            {tx("Опубликовано", "Veröffentlicht")}: <span className="text-foreground">{publishedAt}</span>
          </span>
        ) : null}
        {finding.substances.length > 0 ? (
          <span>
            {tx("Действующее вещество", "Wirkstoff")}: <span className="font-medium text-foreground">{finding.substances.join(", ")}</span>
          </span>
        ) : null}
        {source ? (
          <span>
            {tx("Источник", "Quelle")}: <span className="font-medium text-foreground">{source.label || source.authority}</span>
          </span>
        ) : (
          <span className="text-amber-700">
            {tx("Источник не подтверждён", "Quelle nicht bestätigt")}
          </span>
        )}
      </div>

      <p className="mt-2 border-l-2 border-amber-300 pl-2.5 text-[10px] leading-relaxed text-amber-800">
        {tx(
          "Информация требует медицинской оценки и сама по себе не является указанием изменить лечение.",
          "Die Information erfordert eine medizinische Bewertung und ist für sich allein keine Anweisung zur Therapieänderung.",
        )}
      </p>
    </article>
  );
}

function FindingsSection({
  data,
  lang,
  tx,
}: {
  data: MedicationIntelligenceResponse;
  lang: Lang;
  tx: Bilingual;
}) {
  const medicationNames = useMemo(
    () => new Map(data.medications.map((item) => [item.id, item.name])),
    [data.medications],
  );
  const sourcesById = useMemo(
    () => new Map(data.sources.map((source) => [source.id, source])),
    [data.sources],
  );

  if (data.findings.length === 0) {
    return (
      <EmptyRow>
        {tx(
          "Локальная предварительная проверка не выявила сигналов. Это не подтверждает отсутствие взаимодействий.",
          "Die lokale Vorprüfung hat keine Hinweise ergeben. Dies bestätigt nicht das Fehlen von Wechselwirkungen.",
        )}
      </EmptyRow>
    );
  }

  return (
    <div className="divide-y divide-border/60">
      {SEVERITY_ORDER.map((severity) => {
        const findings = data.findings.filter((finding) => finding.severity === severity);
        if (findings.length === 0) return null;
        return (
          <div key={severity}>
            <div className="flex items-center justify-between gap-3 bg-muted/20 px-3.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn("size-2 shrink-0 rounded-full", SEVERITY_DOT[severity])} />
                <h4 className="text-xs font-semibold text-foreground">
                  {severityLabel(severity, tx)}
                </h4>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{findings.length}</span>
            </div>
            <div className="divide-y divide-border/60">
              {findings.map((finding) => {
                const source = finding.source_id
                  ? sourcesById.get(finding.source_id)
                  : undefined;
                if (finding.category === "official_safety_alert") {
                  return (
                    <OfficialSafetyAlertFinding
                      key={finding.id}
                      finding={finding}
                      source={source}
                      lang={lang}
                      tx={tx}
                    />
                  );
                }
                const medications = finding.medication_ids
                  .map((id) => medicationNames.get(id))
                  .filter((name): name is string => Boolean(name));
                const evidence = source ? [source.label || source.authority] : [];
                return (
                  <article key={finding.id} className="grid gap-2 px-3.5 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(11rem,0.35fr)]">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-semibold text-foreground">
                        {lang === "de" ? finding.title_de : finding.title_ru}
                      </p>
                      <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                        {lang === "de" ? finding.detail_de : finding.detail_ru}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1.5 lg:border-l lg:border-border/60 lg:pl-3">
                      {medications.length > 0 ? (
                        <p className="break-words text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {tx("Препараты", "Medikamente")}:
                          </span>{" "}
                          {medications.join(", ")}
                        </p>
                      ) : null}
                      {evidence.length > 0 ? (
                        <p className="break-words text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {tx("Основание", "Nachweis")}:
                          </span>{" "}
                          {evidence.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MedicationsTable({
  data,
  tx,
  lang,
  onIdentifyMedication,
}: {
  data: MedicationIntelligenceResponse;
  tx: Bilingual;
  lang: Lang;
  onIdentifyMedication?: (medicationId: string) => void;
}) {
  if (data.medications.length === 0) {
    return <EmptyRow>{tx("Активная медикация не указана.", "Keine aktive Medikation angegeben.")}</EmptyRow>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead className="bg-muted/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3.5 py-2 font-semibold">{tx("Препарат", "Medikament")}</th>
            <th className="px-3.5 py-2 font-semibold">{tx("Действующее вещество", "Wirkstoff")}</th>
            <th className="px-3.5 py-2 font-semibold">ATC</th>
            <th className="px-3.5 py-2 font-semibold">PZN</th>
            <th className="px-3.5 py-2 font-semibold">{tx("Страна", "Land")}</th>
            <th className="px-3.5 py-2 font-semibold">{tx("Идентификация", "Identität")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {data.medications.map((medication) => (
            <tr key={medication.id} className="hover:bg-muted/15">
              <td className="px-3.5 py-2.5">
                <p className="text-[13px] font-medium text-foreground">{medication.name || "—"}</p>
                {medication.status ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{medication.status}</p>
                ) : null}
              </td>
              <td className="px-3.5 py-2.5 text-xs text-foreground">{medication.substance ?? "—"}</td>
              <td className="px-3.5 py-2.5 font-mono text-xs text-muted-foreground">{medication.atc_code ?? "—"}</td>
              <td className="px-3.5 py-2.5 font-mono text-xs text-muted-foreground">{medication.pzn ?? "—"}</td>
              <td className="px-3.5 py-2.5 text-xs text-muted-foreground">{medication.country_code ?? "—"}</td>
              <td className="px-3.5 py-2.5">
                <MedicationIdentityAction
                  compact
                  medication={medication}
                  permissions={data.identity_permissions}
                  language={lang}
                  onIdentify={onIdentifyMedication
                    ? () => onIdentifyMedication(medication.id)
                    : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MissingDataSection({
  data,
  lang,
  tx,
}: {
  data: MedicationIntelligenceResponse;
  lang: Lang;
  tx: Bilingual;
}) {
  if (data.missing_data.length === 0) {
    return <EmptyRow>{tx("Дополнительные данные не запрошены.", "Keine zusätzlichen Daten angefordert.")}</EmptyRow>;
  }
  return (
    <div className="divide-y divide-border/60">
      {data.missing_data.map((item) => (
        <div key={item.code} className="grid gap-1 px-3.5 py-2.5 sm:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)] sm:gap-4">
          <p className="text-xs font-semibold text-foreground">
            {lang === "de" ? item.label_de : item.label_ru}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {lang === "de" ? item.reason_de : item.reason_ru}
          </p>
        </div>
      ))}
    </div>
  );
}

function snapshotChecksum(value: string) {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

function sourceWithoutSnapshotLabel(source: MedicationIntelligenceSource, tx: Bilingual) {
  if (source.ingestion_status === "planned") {
    return tx(
      "Коннектор ещё не активирован; локальный снимок отсутствует.",
      "Der Connector ist noch nicht aktiviert; es liegt kein lokaler Snapshot vor.",
    );
  }
  if (source.ingestion_status === "manual_reference") {
    return tx(
      "Доступна только официальная ссылка; локальный снимок не создаётся.",
      "Es ist nur der offizielle Verweis verfügbar; es wird kein lokaler Snapshot erstellt.",
    );
  }
  if (source.ingestion_status === "error") {
    return tx(
      "После неудачной загрузки нет пригодного успешного снимка.",
      "Nach dem fehlgeschlagenen Import liegt kein nutzbarer erfolgreicher Snapshot vor.",
    );
  }
  return tx(
    "Успешный локальный снимок ещё не создан.",
    "Es wurde noch kein erfolgreicher lokaler Snapshot erstellt.",
  );
}

function SourcesSection({
  data,
  lang,
  tx,
}: {
  data: MedicationIntelligenceResponse;
  lang: Lang;
  tx: Bilingual;
}) {
  const freshCount = data.sources.filter(
    (source) => source.ingestion_status === "available"
      && source.health === "fresh"
      && source.last_successful_snapshot,
  ).length;
  const attentionCount = data.sources.filter(
    (source) => source.ingestion_status === "error"
      || source.health === "stale"
      || source.health === "error",
  ).length;

  return (
    <details className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-3.5 py-2.5 marker:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-foreground/70" />
          <span className="text-[13px] font-semibold text-foreground">
            {tx("Официальные открытые источники", "Offizielle offene Quellen")}
          </span>
        </div>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">{data.sources.length}</span>
          {freshCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {tx("Актуально", "Aktuell")}: <span className="font-mono">{freshCount}</span>
            </span>
          ) : null}
          {attentionCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {tx("Требуют внимания", "Zu prüfen")}: <span className="font-mono">{attentionCount}</span>
            </span>
          ) : null}
        </span>
      </summary>
      {data.sources.length === 0 ? (
        <EmptyRow>{tx("Источники пока не подключены.", "Noch keine Quellen angebunden.")}</EmptyRow>
      ) : (
        <div className="divide-y divide-border/60">
          {data.sources.map((source) => {
            const href = safeExternalUrl(source.url);
            const snapshot = source.last_successful_snapshot;
            const snapshotHref = snapshot ? safeExternalUrl(snapshot.source_url) : null;
            const fetchedAt = snapshot ? formatGeneratedAt(snapshot.fetched_at, lang) : null;
            const publishedAt = snapshot?.published_at
              ? formatGeneratedAt(snapshot.published_at, lang)
              : null;
            const lastAttemptAt = source.last_attempt_at
              ? formatGeneratedAt(source.last_attempt_at, lang)
              : null;
            return (
              <div key={source.id} className="px-3.5 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="break-words text-xs font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                      >
                        {source.label || source.authority}
                      </a>
                    ) : (
                      <p className="break-words text-xs font-semibold text-foreground">
                        {source.label || source.authority}
                      </p>
                    )}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {[source.authority, source.kind].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {source.machine_readable ? (
                      <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                        {tx("Машиночитаемый", "Maschinenlesbar")}
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                      <span className={cn("size-1.5 rounded-full", sourceProvenanceDot(source))} />
                      {sourceProvenanceLabel(source, tx)}
                    </Badge>
                  </div>
                </div>

                {snapshot ? (
                  <div className="mt-2.5 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] font-medium text-foreground">
                        {tx("Последний успешный снимок", "Letzter erfolgreicher Snapshot")}
                        {fetchedAt ? ` · ${fetchedAt}` : ""}
                      </p>
                      {snapshotHref ? (
                        <a
                          href={snapshotHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                        >
                          {tx("Источник снимка", "Snapshot-Quelle")}
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      {snapshot.version ? (
                        <span>{tx("Версия", "Version")}: <span className="font-mono text-foreground">{snapshot.version}</span></span>
                      ) : null}
                      {publishedAt ? (
                        <span>{tx("Опубликовано", "Veröffentlicht")}: <span className="text-foreground">{publishedAt}</span></span>
                      ) : null}
                      {snapshot.item_count != null ? (
                        <span>{tx("Записей", "Einträge")}: <span className="font-mono text-foreground">{snapshot.item_count}</span></span>
                      ) : null}
                      {snapshot.checksum_sha256 ? (
                        <span>SHA-256: <span className="font-mono text-foreground" title={snapshot.checksum_sha256}>{snapshotChecksum(snapshot.checksum_sha256)}</span></span>
                      ) : null}
                      {source.freshness_ttl_hours != null ? (
                        <span>TTL: <span className="font-mono text-foreground">{source.freshness_ttl_hours} h</span></span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                    {sourceWithoutSnapshotLabel(source, tx)}
                  </p>
                )}

                {(source.health === "error" || source.ingestion_status === "error") ? (
                  <div className="mt-2 border-l-2 border-rose-400 pl-2.5 text-[10px] leading-relaxed text-rose-700">
                    <p className="font-medium">
                      {tx("Последнее обновление завершилось ошибкой.", "Die letzte Aktualisierung ist fehlgeschlagen.")}
                    </p>
                    {source.last_error ? (
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-rose-700/80">
                        <span>{sourceErrorLabel(source.last_error, tx)}</span>
                        <code className="font-mono text-[9px] text-rose-700/70">{source.last_error}</code>
                      </div>
                    ) : null}
                    {lastAttemptAt ? (
                      <p className="mt-0.5 text-rose-700/80">
                        {tx("Последняя попытка", "Letzter Versuch")}: {lastAttemptAt}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}

function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-foreground/70" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold text-foreground">{title}</h3>
        </div>
        {typeof count === "number" ? (
          <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-7 text-center text-xs leading-relaxed text-muted-foreground">
      {children}
    </div>
  );
}

function Disclaimer({
  data,
  lang,
}: {
  data?: MedicationIntelligenceResponse | null;
  lang: Lang;
}) {
  const text = lang === "de"
    ? data?.disclaimer.de || DISCLAIMER_DE
    : data?.disclaimer.ru || DISCLAIMER_RU;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-[11px] leading-relaxed text-amber-950">
      {text}
    </div>
  );
}

export function MedicationIntelligencePanelContent({
  data = null,
  loading = false,
  error = null,
  onRetry,
  onIdentifyMedication,
  language,
}: MedicationIntelligencePanelContentProps) {
  const { lang: activeLanguage } = useLang();
  const lang = language ?? activeLanguage;
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const generatedAt = data ? formatGeneratedAt(data.generated_at, lang) : null;
  const isEmpty = Boolean(
    data
      && data.medications.length === 0
      && data.findings.length === 0
      && data.missing_data.length === 0,
  );

  return (
    <section className="space-y-3" aria-label={tx("Проверка медикации", "Medikationsprüfung")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {tx("Интеллектуальная проверка медикации", "Intelligente Medikationsprüfung")}
            </h2>
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
              {tx("Только открытые источники", "Nur offene Quellen")}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {tx(
              "Сопоставление лекарств и проверяемые сигналы для медицинского специалиста.",
              "Arzneimittelabgleich und prüfbare Hinweise für medizinisches Fachpersonal.",
            )}
          </p>
        </div>
        {generatedAt ? (
          <p className="shrink-0 text-[10px] text-muted-foreground">
            {tx("Сформировано", "Erstellt")}: {generatedAt}
          </p>
        ) : null}
      </div>

      <Disclaimer data={data} lang={lang} />

      {loading ? (
        <div role="status" aria-live="polite" className="rounded-lg border border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
          {tx("Загружаем проверку медикации…", "Medikationsprüfung wird geladen…")}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="h-8 shrink-0 rounded-md border border-rose-300 bg-white px-3 text-xs font-medium text-rose-800 hover:bg-rose-100"
            >
              {tx("Повторить", "Erneut versuchen")}
            </button>
          ) : null}
        </div>
      ) : !data ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
          {tx("Проверка медикации пока недоступна.", "Die Medikationsprüfung ist noch nicht verfügbar.")}
        </div>
      ) : (
        <>
          <SummaryGrid data={data} tx={tx} />
          {isEmpty ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-white px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
              {tx(
                "Нет данных для проверки. Сначала добавьте актуальную медикацию пациента.",
                "Keine Daten für die Prüfung. Erfassen Sie zuerst die aktuelle Medikation des Patienten.",
              )}
            </div>
          ) : (
            <>
              <SectionCard title={tx("Проверяемые сигналы", "Prüfhinweise")} count={data.findings.length}>
                <FindingsSection data={data} lang={lang} tx={tx} />
              </SectionCard>
              <SectionCard title={tx("Идентификация медикации", "Identität der Medikation")} count={data.medications.length}>
                <MedicationsTable
                  data={data}
                  tx={tx}
                  lang={lang}
                  onIdentifyMedication={onIdentifyMedication}
                />
              </SectionCard>
              <SectionCard title={tx("Недостающие данные", "Fehlende Daten")} count={data.missing_data.length}>
                <MissingDataSection data={data} lang={lang} tx={tx} />
              </SectionCard>
            </>
          )}
          <SourcesSection data={data} lang={lang} tx={tx} />
        </>
      )}
    </section>
  );
}

export function medicationIdentityWorkflowStatusForError(
  error: unknown,
): Extract<MedicationIdentityWorkflowStatus, "stale" | "error"> {
  return error instanceof ApiRequestError && error.status === 409 ? "stale" : "error";
}

export function resolveMedicationIdentityIdempotencyKey(
  current: string | null,
  create: () => string = () => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `medication-identity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },
) {
  return current || create();
}

export function MedicationIntelligencePanel({
  patientId,
  refreshKey,
  fetcher = fetchMedicationIntelligence,
}: MedicationIntelligencePanelProps) {
  const { lang } = useLang();
  const [reloadToken, setReloadToken] = useState(0);
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);
  const [identityMedicationId, setIdentityMedicationId] = useState<string | null>(null);
  const [identityCandidateSet, setIdentityCandidateSet] = useState<MedicationIdentityCandidateSet | null>(null);
  const [identityStatus, setIdentityStatus] = useState<MedicationIdentityWorkflowStatus>("loading");
  const [identitySelectedCandidateId, setIdentitySelectedCandidateId] = useState<string | null>(null);
  const [identityAcknowledged, setIdentityAcknowledged] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const identityRequestRef = useRef(0);
  const identityIdempotencyKeyRef = useRef<string | null>(null);
  const pendingIdentityConfirmationRef = useRef<MedicationIdentityConfirmationInput | null>(null);
  const [state, setState] = useState<{
    patientId: string;
    data: MedicationIntelligenceResponse | null;
    loading: boolean;
    error: boolean;
  }>({ patientId, data: null, loading: true, error: false });

  useEffect(() => {
    let active = true;
    setState({ patientId, data: null, loading: true, error: false });
    void fetcher(patientId)
      .then((data) => {
        if (active) setState({ patientId, data, loading: false, error: false });
      })
      .catch(() => {
        if (!active) return;
        setState({
          patientId,
          data: null,
          loading: false,
          error: true,
        });
      });
    return () => {
      active = false;
    };
  }, [fetcher, patientId, refreshKey, reloadToken]);

  useEffect(() => {
    identityRequestRef.current += 1;
    setIdentityDialogOpen(false);
    setIdentityMedicationId(null);
    setIdentityCandidateSet(null);
    setIdentitySelectedCandidateId(null);
    setIdentityAcknowledged(false);
    setIdentityError(null);
    identityIdempotencyKeyRef.current = null;
    pendingIdentityConfirmationRef.current = null;
  }, [patientId]);

  const currentState = state.patientId === patientId
    ? state
    : { patientId, data: null, loading: true, error: false };

  const loadIdentityCandidates = async (medicationId: string) => {
    const requestId = ++identityRequestRef.current;
    setIdentityStatus("loading");
    setIdentityCandidateSet(null);
    setIdentitySelectedCandidateId(null);
    setIdentityAcknowledged(false);
    setIdentityError(null);
    identityIdempotencyKeyRef.current = null;
    pendingIdentityConfirmationRef.current = null;
    try {
      const candidateSet = await generateMedicationIdentityCandidates(patientId, medicationId);
      if (requestId !== identityRequestRef.current) return;
      setIdentityCandidateSet(candidateSet);
      setIdentityStatus("ready");
    } catch {
      if (requestId !== identityRequestRef.current) return;
      setIdentityStatus("error");
      setIdentityError(
        lang === "de"
          ? "Die Identitätskandidaten konnten nicht geladen werden."
          : "Не удалось загрузить кандидатов для идентификации.",
      );
    }
  };

  const openIdentityWorkflow = (medicationId: string) => {
    setIdentityMedicationId(medicationId);
    setIdentityDialogOpen(true);
    void loadIdentityCandidates(medicationId);
  };

  const closeIdentityWorkflow = () => {
    if (identityStatus === "confirming") return;
    identityRequestRef.current += 1;
    setIdentityDialogOpen(false);
    setIdentityMedicationId(null);
    setIdentityCandidateSet(null);
    setIdentitySelectedCandidateId(null);
    setIdentityAcknowledged(false);
    setIdentityError(null);
    identityIdempotencyKeyRef.current = null;
    pendingIdentityConfirmationRef.current = null;
  };

  const confirmIdentity = async (input: MedicationIdentityConfirmationInput) => {
    if (!identityMedicationId) return;
    const requestId = ++identityRequestRef.current;
    const idempotencyKey = resolveMedicationIdentityIdempotencyKey(
      identityIdempotencyKeyRef.current,
    );
    identityIdempotencyKeyRef.current = idempotencyKey;
    const request = { ...input, idempotency_key: idempotencyKey };
    pendingIdentityConfirmationRef.current = request;
    setIdentityStatus("confirming");
    setIdentityError(null);
    try {
      await confirmMedicationIdentity(patientId, identityMedicationId, request);
      if (requestId !== identityRequestRef.current) return;
      pendingIdentityConfirmationRef.current = null;
      identityIdempotencyKeyRef.current = null;
      setIdentityStatus("success");
      setReloadToken((token) => token + 1);
    } catch (error) {
      if (requestId !== identityRequestRef.current) return;
      const nextStatus = medicationIdentityWorkflowStatusForError(error);
      setIdentityStatus(nextStatus);
      if (nextStatus === "stale") {
        pendingIdentityConfirmationRef.current = null;
        identityIdempotencyKeyRef.current = null;
      } else {
        setIdentityError(
          lang === "de"
            ? "Die Identität konnte nicht bestätigt werden. Bitte versuchen Sie es erneut."
            : "Не удалось подтвердить идентификацию. Повторите попытку.",
        );
      }
    }
  };

  const retryIdentityAction = () => {
    const pending = pendingIdentityConfirmationRef.current;
    if (pending) {
      void confirmIdentity(pending);
      return;
    }
    if (identityMedicationId) void loadIdentityCandidates(identityMedicationId);
  };

  const resetPendingIdentityConfirmation = () => {
    pendingIdentityConfirmationRef.current = null;
    identityIdempotencyKeyRef.current = null;
    if (identityStatus === "error") setIdentityStatus("ready");
    setIdentityError(null);
  };

  const identityMedicationName = identityCandidateSet?.medication.name
    || currentState.data?.medications.find((medication) => medication.id === identityMedicationId)?.name
    || "—";

  return (
    <>
      <MedicationIntelligencePanelContent
        data={currentState.data}
        loading={currentState.loading}
        error={currentState.error
          ? lang === "de"
            ? "Die Medikationsprüfung konnte nicht geladen werden."
            : "Не удалось загрузить проверку медикации."
          : null}
        onRetry={() => setReloadToken((token) => token + 1)}
        onIdentifyMedication={openIdentityWorkflow}
        language={lang}
      />

      <Dialog
        open={identityDialogOpen}
        dirty={identityStatus !== "success"
          && (identitySelectedCandidateId !== null || identityAcknowledged)}
        onOpenChange={(open) => {
          if (!open) closeIdentityWorkflow();
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader className="border-b border-border/60 pb-3">
            <DialogTitle>
              {lang === "de" ? "Medikament identifizieren" : "Идентифицировать медикамент"}
            </DialogTitle>
            <DialogDescription>
              {identityMedicationName} · {lang === "de"
                ? "Deterministische Kandidaten werden niemals automatisch bestätigt."
                : "Детерминированные кандидаты никогда не подтверждаются автоматически."}
            </DialogDescription>
          </DialogHeader>
          <MedicationIdentityWorkflow
            candidateSet={identityCandidateSet}
            status={identityStatus}
            selectedCandidateId={identitySelectedCandidateId}
            acknowledged={identityAcknowledged}
            errorMessage={identityError}
            language={lang}
            onSelectCandidate={(candidateId) => {
              resetPendingIdentityConfirmation();
              setIdentitySelectedCandidateId(candidateId);
              setIdentityAcknowledged(false);
            }}
            onAcknowledgedChange={(acknowledged) => {
              resetPendingIdentityConfirmation();
              setIdentityAcknowledged(acknowledged);
            }}
            onConfirm={(input) => void confirmIdentity(input)}
            onReload={() => {
              if (identityMedicationId) void loadIdentityCandidates(identityMedicationId);
            }}
            onRetry={retryIdentityAction}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
