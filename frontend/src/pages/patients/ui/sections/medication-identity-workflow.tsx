import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  MedicationIdentityCandidate,
  MedicationIdentityCandidateSet,
  MedicationIdentityConfirmationInput,
  MedicationIdentityMatchBasis,
  MedicationIdentityPermissions,
  MedicationIdentitySubject,
  MedicationIntelligenceIdentityStatus,
} from "@/lib/api/medication-intelligence";
import { useLang, type Lang } from "@/lib/i18n";
import { cachedDateTimeFormat } from "@/lib/intl-cache";
import { cn } from "@/lib/utils";

type Bilingual = (ru: string, de: string) => string;

export type MedicationIdentityWorkflowStatus =
  | "loading"
  | "ready"
  | "confirming"
  | "success"
  | "stale"
  | "error";

type MedicationIdentityActionProps = {
  medication: Pick<MedicationIdentitySubject, "name" | "identity_status">;
  permissions: MedicationIdentityPermissions;
  busy?: boolean;
  compact?: boolean;
  onIdentify?: () => void;
  language?: Lang;
};

type MedicationIdentityWorkflowProps = {
  candidateSet: MedicationIdentityCandidateSet | null;
  status: MedicationIdentityWorkflowStatus;
  selectedCandidateId: string | null;
  acknowledged: boolean;
  errorMessage?: string | null;
  language?: Lang;
  onSelectCandidate?: (candidateId: string) => void;
  onAcknowledgedChange?: (acknowledged: boolean) => void;
  onConfirm?: (input: MedicationIdentityConfirmationInput) => void;
  onReload?: () => void;
  onRetry?: () => void;
};

function formatTimestamp(value: string | null, lang: Lang) {
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

function identityStatusLabel(status: MedicationIntelligenceIdentityStatus, tx: Bilingual) {
  if (status === "verified") return tx("Идентифицирован", "Identifiziert");
  if (status === "candidate") return tx("Требует проверки", "Prüfung erforderlich");
  return tx("Не идентифицирован", "Nicht identifiziert");
}

function identityStatusDot(status: MedicationIntelligenceIdentityStatus) {
  if (status === "verified") return "bg-emerald-500";
  if (status === "candidate") return "bg-amber-500";
  return "bg-rose-500";
}

function matchBasisLabel(value: MedicationIdentityMatchBasis, tx: Bilingual) {
  if (value === "exact_pzn") return tx("Точное совпадение PZN", "Exakte PZN-Übereinstimmung");
  if (value === "exact_substance") return tx("Совпадает Wirkstoff", "Wirkstoff stimmt überein");
  if (value === "exact_strength") return tx("Совпадает дозировка", "Stärke stimmt überein");
  return tx("Совпадает форма", "Darreichungsform stimmt überein");
}

function blockingReasonLabel(value: string, tx: Bilingual) {
  const labels: Record<string, [string, string]> = {
    candidate_expired: ["Набор кандидатов устарел", "Kandidatensatz ist abgelaufen"],
    missing_required_identity: ["Не хватает идентификационных данных", "Erforderliche Identitätsdaten fehlen"],
    exact_brand_required: ["Торговое название не совпадает точно", "Der Handelsname stimmt nicht exakt überein"],
    substance_mismatch: ["Действующее вещество не совпадает", "Der Wirkstoff stimmt nicht überein"],
    strength_contradiction: ["Дозировка противоречит записи пациента", "Die Stärke widerspricht dem Patienteneintrag"],
    form_contradiction: ["Лекарственная форма противоречит записи пациента", "Die Darreichungsform widerspricht dem Patienteneintrag"],
    substance_only_not_identity: ["Совпадения только по действующему веществу недостаточно", "Eine Übereinstimmung nur beim Wirkstoff reicht nicht aus"],
    atc_only_not_identity: ["Совпадения только по ATC недостаточно", "Eine Übereinstimmung nur beim ATC-Code reicht nicht aus"],
    insufficient_identity_evidence: ["Недостаточно точных признаков для идентификации", "Für die Identifikation fehlen ausreichende exakte Merkmale"],
    source_not_internal_curated: ["Источник не допущен к подтверждению", "Die Quelle ist nicht zur Bestätigung freigegeben"],
    medication_version_stale: ["Запись медикамента изменилась", "Der Medikamenteneintrag wurde geändert"],
    not_permitted: ["Недостаточно прав для подтверждения", "Keine Berechtigung zur Bestätigung"],
    source_snapshot_stale: ["Снимок источника устарел", "Quellen-Snapshot ist veraltet"],
    source_unavailable: ["Источник недоступен", "Quelle ist nicht verfügbar"],
  };
  const label = labels[value];
  return label ? tx(label[0], label[1]) : tx("Кандидат нельзя подтвердить", "Kandidat kann nicht bestätigt werden");
}

function permissionReasonLabel(value: string | null, tx: Bilingual) {
  if (value === "role_not_allowed") {
    return tx("Для этой роли действие недоступно.", "Diese Aktion ist für diese Rolle nicht verfügbar.");
  }
  if (value === "clinical_access_required") {
    return tx("Требуется доступ к медицинским данным.", "Zugriff auf medizinische Daten ist erforderlich.");
  }
  return tx("Идентификация доступна только уполномоченным сотрудникам.", "Die Identifikation ist nur für autorisierte Mitarbeitende verfügbar.");
}

export function buildMedicationIdentityConfirmationInput(
  candidateSet: MedicationIdentityCandidateSet,
  candidate: MedicationIdentityCandidate,
  acknowledged: boolean,
): MedicationIdentityConfirmationInput | null {
  if (
    !acknowledged
    || !candidateSet.permissions.can_confirm_identity
    || !candidate.confirmable
  ) {
    return null;
  }
  return {
    candidate_set_id: candidateSet.candidate_set.id,
    candidate_id: candidate.id,
    medication_version: candidateSet.medication.version,
    source_snapshot_id: candidate.provenance.snapshot_id,
    staff_acknowledged: true,
  };
}

export function MedicationIdentityAction({
  medication,
  permissions,
  busy = false,
  compact = false,
  onIdentify,
  language,
}: MedicationIdentityActionProps) {
  const { lang: activeLanguage } = useLang();
  const lang = language ?? activeLanguage;
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const canOpen = medication.identity_status !== "verified"
    && permissions.can_search_candidates
    && Boolean(onIdentify);

  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <span className={cn("size-1.5 shrink-0 rounded-full", identityStatusDot(medication.identity_status))} />
          {identityStatusLabel(medication.identity_status, tx)}
        </span>
        {canOpen ? (
          <Button
            type="button"
            size="sm"
            className="min-h-9 rounded-lg px-2.5 text-[11px] sm:min-h-8"
            disabled={busy}
            onClick={onIdentify}
          >
            {busy ? tx("Загрузка…", "Laden…") : tx("Идентифицировать", "Identifizieren")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-foreground">{medication.name || "—"}</p>
        <p className="mt-0.5 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", identityStatusDot(medication.identity_status))} />
          {identityStatusLabel(medication.identity_status, tx)}
        </p>
      </div>
      {canOpen ? (
        <Button
          type="button"
          size="sm"
          className="min-h-11 rounded-lg px-3 text-xs sm:min-h-8"
          disabled={busy}
          onClick={onIdentify}
        >
          {busy ? tx("Загрузка…", "Laden…") : tx("Идентифицировать", "Identifizieren")}
        </Button>
      ) : medication.identity_status !== "verified" && !permissions.can_search_candidates ? (
        <span className="max-w-64 text-right text-[10px] leading-relaxed text-muted-foreground">
          {permissionReasonLabel(permissions.reason_code, tx)}
        </span>
      ) : null}
    </div>
  );
}

function CandidateFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 border-b border-border/50 py-1.5 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-3">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-xs font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}

function CandidateProvenance({
  candidate,
  lang,
  tx,
}: {
  candidate: MedicationIdentityCandidate;
  lang: Lang;
  tx: Bilingual;
}) {
  const provenance = candidate.provenance;
  const officialUrl = provenance.source_state === "official_snapshot"
    ? safeExternalUrl(provenance.official_url)
    : null;
  const fetchedAt = formatTimestamp(provenance.snapshot_fetched_at, lang);
  return (
    <div className="mt-2 rounded-md border border-border/60 bg-muted/15 px-2.5 py-2 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span className={cn(
            "size-1.5 rounded-full",
            provenance.source_state === "official_snapshot" ? "bg-emerald-500" : "bg-slate-500",
          )} />
          {provenance.source_state === "official_snapshot"
            ? tx("Официальный снимок", "Amtlicher Snapshot")
            : tx("Внутренний курируемый каталог", "Interner kuratierter Katalog")}
        </span>
        {officialUrl ? (
          <a
            href={officialUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline decoration-border underline-offset-2"
          >
            {tx("Открыть официальный источник", "Amtliche Quelle öffnen")}
          </a>
        ) : null}
      </div>
      <p className="mt-1 break-words">
        {[provenance.source_label, provenance.authority].filter(Boolean).join(" · ")}
      </p>
      {provenance.source_state === "official_snapshot" ? (
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {provenance.snapshot_version ? <span>{tx("Версия", "Version")}: {provenance.snapshot_version}</span> : null}
          {fetchedAt ? <span>{tx("Снимок", "Snapshot")}: {fetchedAt}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function CandidateRow({
  candidate,
  selected,
  canSelect,
  lang,
  tx,
  onSelect,
}: {
  candidate: MedicationIdentityCandidate;
  selected: boolean;
  canSelect: boolean;
  lang: Lang;
  tx: Bilingual;
  onSelect?: (candidateId: string) => void;
}) {
  const product = candidate.product;
  return (
    <label className={cn(
      "block rounded-lg border bg-white px-3 py-2.5",
      selected ? "border-foreground/50 ring-1 ring-foreground/10" : "border-border/70",
      canSelect && "cursor-pointer hover:bg-muted/15",
    )}>
      <div className="flex items-start gap-2.5">
        <input
          type="radio"
          name="medication-identity-candidate"
          value={candidate.id}
          checked={selected}
          disabled={!canSelect}
          onChange={() => onSelect?.(candidate.id)}
          className="mt-1 size-4 shrink-0 accent-foreground"
          aria-label={tx(`Выбрать ${product.brand_name}`, `${product.brand_name} auswählen`)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-[13px] font-semibold text-foreground">{product.brand_name || "—"}</p>
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                {[
                  product.substances.join(", "),
                  product.strength,
                  product.form,
                  product.country_code,
                ].filter(Boolean).join(" · ") || "—"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {candidate.match_basis.map((basis) => (
                <Badge key={basis} variant="outline" className="h-5 rounded-full px-2 text-[9px]">
                  {matchBasisLabel(basis, tx)}
                </Badge>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            {product.pzn ? <span>PZN {product.pzn}</span> : null}
            {product.atc_code ? <span>ATC {product.atc_code}</span> : null}
            {product.manufacturer ? <span className="font-sans">{product.manufacturer}</span> : null}
          </div>
          <CandidateProvenance candidate={candidate} lang={lang} tx={tx} />
          {!candidate.confirmable || candidate.blocking_reasons.length > 0 ? (
            <div className="mt-2 border-l-2 border-amber-300 pl-2 text-[10px] leading-relaxed text-amber-800">
              {(candidate.blocking_reasons.length > 0 ? candidate.blocking_reasons : ["candidate_unavailable"])
                .map((reason) => blockingReasonLabel(reason, tx))
                .join(" · ")}
            </div>
          ) : null}
        </div>
      </div>
    </label>
  );
}

function ReviewColumn({ title, dotClass, children }: { title: string; dotClass: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <header className="flex items-center gap-2 border-b border-border/60 bg-muted/15 px-3 py-2">
        <span className={cn("size-1.5 rounded-full", dotClass)} />
        <h4 className="text-[11px] font-semibold text-foreground">{title}</h4>
      </header>
      <div className="px-3 py-1.5">{children}</div>
    </section>
  );
}

function CandidateReview({
  candidateSet,
  candidate,
  acknowledged,
  status,
  lang,
  tx,
  onAcknowledgedChange,
  onConfirm,
}: {
  candidateSet: MedicationIdentityCandidateSet;
  candidate: MedicationIdentityCandidate;
  acknowledged: boolean;
  status: MedicationIdentityWorkflowStatus;
  lang: Lang;
  tx: Bilingual;
  onAcknowledgedChange?: (acknowledged: boolean) => void;
  onConfirm?: (input: MedicationIdentityConfirmationInput) => void;
}) {
  const medication = candidateSet.medication;
  const product = candidate.product;
  const input = buildMedicationIdentityConfirmationInput(candidateSet, candidate, acknowledged);
  const blockedByState = status === "confirming" || status === "stale" || status === "success";
  const canAcknowledge = candidateSet.permissions.can_confirm_identity
    && candidate.confirmable
    && !blockedByState;
  const handleConfirm = () => {
    if (input && !blockedByState) onConfirm?.(input);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <header className="border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-foreground/70" />
          <h3 className="text-[13px] font-semibold text-foreground">
            {tx("Проверить выбранную идентификацию", "Ausgewählte Identität prüfen")}
          </h3>
        </div>
      </header>
      <div className="space-y-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <ReviewColumn title={tx("Запись пациента", "Patienteneintrag")} dotClass="bg-slate-500">
            <CandidateFact label={tx("Название", "Name")} value={medication.name} />
            <CandidateFact label={tx("Wirkstoff", "Wirkstoff")} value={medication.substance} />
            <CandidateFact label={tx("Дозировка", "Stärke")} value={medication.strength} />
            <CandidateFact label={tx("Форма", "Form")} value={medication.form} />
            <CandidateFact label="PZN / ATC" value={[medication.pzn, medication.atc_code].filter(Boolean).join(" / ")} />
          </ReviewColumn>
          <ReviewColumn title={tx("Выбранный кандидат", "Ausgewählter Kandidat")} dotClass="bg-emerald-500">
            <CandidateFact label={tx("Название", "Name")} value={product.brand_name} />
            <CandidateFact label={tx("Wirkstoff", "Wirkstoff")} value={product.substances.join(", ")} />
            <CandidateFact label={tx("Дозировка", "Stärke")} value={product.strength} />
            <CandidateFact label={tx("Форма", "Form")} value={product.form} />
            <CandidateFact label="PZN / ATC" value={[product.pzn, product.atc_code].filter(Boolean).join(" / ")} />
          </ReviewColumn>
        </div>
        <CandidateProvenance candidate={candidate} lang={lang} tx={tx} />
      </div>

      <footer className="sticky bottom-0 z-10 border-t border-border/70 bg-white px-3.5 py-3 sm:static">
        {candidateSet.permissions.can_confirm_identity ? (
          <label className={cn(
            "flex min-h-11 items-start gap-2.5 rounded-md border border-border/70 px-3 py-2.5 text-xs leading-relaxed",
            canAcknowledge ? "cursor-pointer bg-white" : "bg-muted/20 text-muted-foreground",
          )}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!canAcknowledge}
              onChange={(event) => onAcknowledgedChange?.(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-foreground"
            />
            <span>
              {tx(
                "Я сверил название, действующее вещество, дозировку, форму и происхождение кандидата. Подтверждение связывает записи, но не изменяет лечение.",
                "Ich habe Name, Wirkstoff, Stärke, Form und Herkunft des Kandidaten geprüft. Die Bestätigung verknüpft Datensätze, ändert aber keine Therapie.",
              )}
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            {permissionReasonLabel(candidateSet.permissions.reason_code, tx)}
          </p>
        )}
        <div className="mt-2.5 flex justify-end">
          <Button
            type="button"
            className="min-h-11 rounded-lg px-4 text-xs sm:min-h-8"
            disabled={!input || blockedByState || !onConfirm}
            onClick={handleConfirm}
          >
            {status === "confirming"
              ? tx("Подтверждение…", "Bestätigung…")
              : tx("Подтвердить связь", "Verknüpfung bestätigen")}
          </Button>
        </div>
      </footer>
    </section>
  );
}

export function MedicationIdentityWorkflow({
  candidateSet,
  status,
  selectedCandidateId,
  acknowledged,
  errorMessage,
  language,
  onSelectCandidate,
  onAcknowledgedChange,
  onConfirm,
  onReload,
  onRetry,
}: MedicationIdentityWorkflowProps) {
  const { lang: activeLanguage } = useLang();
  const lang = language ?? activeLanguage;
  const tx: Bilingual = (ru, de) => (lang === "de" ? de : ru);
  const selectedCandidate = candidateSet?.candidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  ) ?? null;

  if (status === "loading") {
    return (
      <div role="status" className="rounded-lg border border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
        {tx("Ищем детерминированные совпадения…", "Deterministische Treffer werden gesucht…")}
      </div>
    );
  }

  if (status === "error" && !candidateSet) {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-4 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
        <span>{errorMessage || tx("Не удалось загрузить кандидатов.", "Kandidaten konnten nicht geladen werden.")}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRetry}>
            {tx("Повторить", "Erneut versuchen")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (!candidateSet) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-white px-4 py-8 text-center text-xs text-muted-foreground">
        {tx("Набор кандидатов недоступен.", "Der Kandidatensatz ist nicht verfügbar.")}
      </div>
    );
  }

  if (!candidateSet.permissions.can_search_candidates) {
    return (
      <div className="rounded-lg border border-border/70 bg-white px-4 py-5 text-center text-xs text-muted-foreground">
        {permissionReasonLabel(candidateSet.permissions.reason_code, tx)}
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label={tx("Идентификация медикамента", "Medikamentenidentifikation")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {tx("Идентифицировать медикамент", "Medikament identifizieren")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidateSet.medication.name} · {candidateSet.candidates.length} {tx("кандидатов", "Kandidaten")}
          </p>
        </div>
        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
          {tx("Только ручное подтверждение", "Nur manuelle Bestätigung")}
        </Badge>
      </div>

      {status === "stale" ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {tx(
              "Данные медикамента или набор кандидатов изменились. Загрузите актуальные данные перед подтверждением.",
              "Medikamentendaten oder Kandidatensatz haben sich geändert. Laden Sie vor der Bestätigung die aktuellen Daten.",
            )}
          </span>
          {onReload ? (
            <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onReload}>
              {tx("Обновить кандидатов", "Kandidaten neu laden")}
            </Button>
          ) : null}
        </div>
      ) : status === "error" ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-800 sm:flex-row sm:items-center sm:justify-between">
          <span>{errorMessage || tx("Не удалось выполнить действие.", "Die Aktion konnte nicht ausgeführt werden.")}</span>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" className="min-h-11 bg-white sm:min-h-8" onClick={onRetry}>
              {tx("Повторить", "Erneut versuchen")}
            </Button>
          ) : null}
        </div>
      ) : status === "success" ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-800">
          {tx("Связь подтверждена сотрудником.", "Die Verknüpfung wurde durch einen Mitarbeitenden bestätigt.")}
        </div>
      ) : null}

      {candidateSet.candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 bg-white px-4 py-8 text-center text-xs leading-relaxed text-muted-foreground">
          {tx(
            "Детерминированные кандидаты не найдены. Автоматическая связь не создаётся.",
            "Keine deterministischen Kandidaten gefunden. Es wird keine automatische Verknüpfung erstellt.",
          )}
        </div>
      ) : (
        <fieldset className="space-y-2">
          <legend className="sr-only">{tx("Кандидаты", "Kandidaten")}</legend>
          {candidateSet.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedCandidateId}
              canSelect={candidateSet.permissions.can_confirm_identity
                && status !== "confirming"
                && status !== "stale"
                && status !== "success"}
              lang={lang}
              tx={tx}
              onSelect={onSelectCandidate}
            />
          ))}
        </fieldset>
      )}

      {selectedCandidate ? (
        <CandidateReview
          candidateSet={candidateSet}
          candidate={selectedCandidate}
          acknowledged={acknowledged}
          status={status}
          lang={lang}
          tx={tx}
          onAcknowledgedChange={onAcknowledgedChange}
          onConfirm={onConfirm}
        />
      ) : null}
    </section>
  );
}
