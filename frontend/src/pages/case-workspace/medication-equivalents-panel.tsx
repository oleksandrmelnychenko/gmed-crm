import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui-shell";
import type { GermanEquivalent } from "@/lib/api/clinical";
import { useLang } from "@/lib/i18n";

import { Panel } from "./primitives";

type MedicationEquivalentsPanelProps = {
  medicationName: string;
  medicationSubstance?: string | null;
  candidates: GermanEquivalent[];
  includeCandidates?: boolean;
  loading?: boolean;
  error?: string;
  verifyingEquivalentId?: string | null;
  onFind?: () => void;
  onToggleCandidates?: (includeCandidates: boolean) => void;
  onVerifyEquivalent?: (
    relationshipId: string,
    verificationStatus: "verified" | "rejected" | "candidate",
  ) => void;
};

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function verificationStatusLabel(lang: string, status?: string | null) {
  if (status === "verified") return tri(lang, "Verifiziert", "Проверено", "Verified");
  if (status === "rejected") return tri(lang, "Abgelehnt", "Отклонено", "Rejected");
  if (status === "candidate") return tri(lang, "Kandidat", "Кандидат", "Candidate");
  if (status === "pending") return tri(lang, "Ausstehend", "Ожидает", "Pending");
  return tri(lang, "Unbekannter Status", "Неизвестный статус", "Unknown status");
}

export function MedicationEquivalentsPanel({
  medicationName,
  medicationSubstance,
  candidates,
  includeCandidates = false,
  loading = false,
  error,
  verifyingEquivalentId = null,
  onFind,
  onToggleCandidates,
  onVerifyEquivalent,
}: MedicationEquivalentsPanelProps) {
  const { lang } = useLang();

  return (
    <Panel
      title={tri(lang, "Deutsches Äquivalent finden", "Найти немецкий эквивалент", "Find German equivalent")}
      description={tri(
        lang,
        "Team-Referenz für deutsche Medikationsäquivalente. Keine Verordnung.",
        "Справочная информация для команды по немецким эквивалентам. Это не назначение.",
        "Staff reference for German medication equivalents. This is not a prescription.",
      )}
      action={
        <>
          <CountBadge>{candidates.length} {tri(lang, "Kandidaten", "кандидатов", "candidates")}</CountBadge>
          {onFind ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg"
              onClick={onFind}
              disabled={loading}
            >
              {loading ? tri(lang, "Suche...", "Поиск...", "Searching...") : tri(lang, "Finden", "Найти", "Find")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
        {tri(
          lang,
          "Deutsche Äquivalente sind nur Team-Referenzinformationen, keine Verordnung. Ungeprüfte Kandidaten dürfen nicht patientenseitig angezeigt werden.",
          "Немецкие эквиваленты являются только справочной информацией для команды, не назначением. Непроверенные кандидаты нельзя показывать пациенту.",
          "German equivalents are staff reference information only, not a prescription. Unverified candidates must not be shown patient-facing.",
        )}
      </div>

      <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{medicationName}</p>
        {medicationSubstance ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {tri(lang, "Wirkstoff", "Действующее вещество", "Active substance")}: {medicationSubstance}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {onToggleCandidates ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeCandidates}
            onChange={(event) => onToggleCandidates(event.target.checked)}
          />
          {tri(lang, "Ungeprüfte Team-Kandidaten einschließen", "Включить непроверенные кандидаты только для команды", "Include unverified staff-only candidates")}
        </label>
      ) : null}

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
          {tri(lang, "Noch keine deutschen Äquivalente gefunden.", "Немецкие эквиваленты пока не найдены.", "No German equivalents found yet.")}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {candidates.map((candidate) => (
            <article
              key={candidate.equivalent_id}
              className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {candidate.brand_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.country_code}
                    {candidate.strength ? ` · ${candidate.strength}` : ""}
                    {candidate.form ? ` · ${candidate.form}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {verificationStatusLabel(lang, candidate.verification_status)}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tri(lang, "Wirkstoffe", "Действующие вещества", "Substances")}: {candidate.substances.join(", ") || tri(lang, "Unbekannt", "Неизвестно", "Unknown")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tri(lang, "Trefferquote", "Уверенность", "Confidence")}: {candidate.confidence}
              </p>
              {candidate.verification_status !== "verified" ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                  {tri(lang, "Ungeprüfter Kandidat: nur für das Team, nicht patientenseitig.", "Непроверенный кандидат: только для команды, не показывать пациенту.", "Unverified candidate: staff-only, not patient-facing.")}
                </p>
              ) : null}
              {onVerifyEquivalent && candidate.relationship_id ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-2.5 text-[11px]"
                    disabled={verifyingEquivalentId === candidate.relationship_id}
                    onClick={() =>
                      onVerifyEquivalent(candidate.relationship_id!, "verified")
                    }
                  >
                    {tri(lang, "Prüfen", "Проверить", "Verify")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-2.5 text-[11px]"
                    disabled={verifyingEquivalentId === candidate.relationship_id}
                    onClick={() =>
                      onVerifyEquivalent(candidate.relationship_id!, "rejected")
                    }
                  >
                    {tri(lang, "Ablehnen", "Отклонить", "Reject")}
                  </Button>
                </div>
              ) : candidate.verification_status !== "verified" ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {tri(lang, "Noch keine kuratierte Äquivalent-Verknüpfung vorhanden. Zuerst einen Produkt-Match hinzufügen.", "Курируемой связи с эквивалентом пока нет. Сначала добавьте связь с препаратом.", "No curated equivalent link exists yet. Add a product match first.")}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
