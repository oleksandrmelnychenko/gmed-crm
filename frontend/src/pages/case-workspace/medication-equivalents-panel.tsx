import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui-shell";
import type { GermanEquivalent } from "@/lib/api/clinical";
import { useLang, type Translations } from "@/lib/i18n";

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

function verificationStatusLabel(
  translations: Translations,
  status?: string | null,
) {
  if (status === "verified") return translations.cases_medications_status_verified;
  if (status === "rejected") return translations.cases_medications_status_rejected;
  if (status === "candidate") return translations.cases_medications_status_candidate;
  if (status === "pending") return translations.cases_medications_status_pending;
  return translations.cases_medications_status_unknown;
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
  const { t } = useLang();

  return (
    <Panel
      title={t.cases_medications_equivalents_title}
      description={t.cases_medications_equivalents_description}
      action={
        <>
          <CountBadge>
            {candidates.length} {t.cases_medications_equivalents_count_label}
          </CountBadge>
          {onFind ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg"
              onClick={onFind}
              disabled={loading}
            >
              {loading
                ? t.cases_medications_searching
                : t.cases_medications_equivalents_find}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
        {t.cases_medications_equivalents_warning}
      </div>

      <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">{medicationName}</p>
        {medicationSubstance ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t.cases_medications_equivalents_active_substance}:{" "}
            {medicationSubstance}
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
          {t.cases_medications_equivalents_include_unverified}
        </label>
      ) : null}

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
          {t.cases_medications_equivalents_empty}
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {candidates.map((candidate) => (
            <article
              key={candidate.equivalent_id}
              className="rounded-xl border border-border/50 bg-card/60 px-4 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="max-w-full break-words text-sm font-semibold text-foreground">
                    {candidate.brand_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {candidate.country_code}
                    {candidate.strength ? ` · ${candidate.strength}` : ""}
                    {candidate.form ? ` · ${candidate.form}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {verificationStatusLabel(t, candidate.verification_status)}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t.cases_medications_substances}:{" "}
                {candidate.substances.join(", ") ||
                  t.cases_medications_unknown}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.cases_medications_equivalents_confidence}:{" "}
                {candidate.confidence}
              </p>
              {candidate.verification_status !== "verified" ? (
                <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                  {t.cases_medications_equivalents_unverified_warning}
                </p>
              ) : null}
              {onVerifyEquivalent && candidate.relationship_id ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
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
                    {t.cases_medications_equivalents_verify}
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
                    {t.cases_medications_reject}
                  </Button>
                </div>
              ) : candidate.verification_status !== "verified" ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t.cases_medications_equivalents_no_link}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
