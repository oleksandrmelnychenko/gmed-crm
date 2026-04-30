import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner, CountBadge, Section, tokens } from "@/components/ui-shell";
import { appointmentText, roleLabel } from "@/pages/appointments/model/labels";
import type { InterpreterSuggestion } from "@/lib/api/clinical";

type InterpreterSuggestionsPanelProps = {
  suggestions: InterpreterSuggestion[];
  selectedInterpreterId?: string | null;
  loading?: boolean;
  error?: string;
  onSelect?: (interpreterId: string) => void;
};

export function InterpreterSuggestionsPanel({
  suggestions,
  selectedInterpreterId,
  loading = false,
  error,
  onSelect,
}: InterpreterSuggestionsPanelProps) {
  return (
    <Section
      title={appointmentText(
        "Dolmetscher-Vorschläge",
        "Предложения переводчиков",
        "Interpreter suggestions",
      )}
      accessory={<CountBadge>{suggestions.length}</CountBadge>}
    >
      <p className={tokens.text.muted}>
        {appointmentText(
          "Ranking basiert auf Patientenhistorie, Präferenz, Feedback und Sprache. Fehlende Sprachen blockieren den Vorschlag nicht.",
          "Рейтинг учитывает историю пациента, предпочтения, отзывы и язык. Отсутствие языков не блокирует предложение.",
          "Ranking uses patient history, preference, feedback and language. Missing languages do not block the suggestion.",
        )}
      </p>

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
      {loading ? (
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-5 text-sm text-muted-foreground">
          {appointmentText("Vorschläge werden geladen", "Загрузка предложений", "Loading suggestions")}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
          {appointmentText(
            "Keine passenden Vorschläge. Avoid-Präferenzen werden nicht angezeigt.",
            "Нет подходящих предложений. Предпочтения avoid не показываются.",
            "No matching suggestions. Avoid preferences are not shown.",
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {suggestions.map((suggestion) => {
            const selected = selectedInterpreterId === suggestion.interpreter_id;
            return (
              <article
                key={suggestion.interpreter_id}
                className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-foreground">
                        {suggestion.interpreter_name}
                      </h4>
                      <Badge variant="outline" className="rounded-full">
                        {roleLabel(suggestion.role)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {suggestion.preference}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {suggestion.language_status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {suggestion.previous_appointment_count} worked before ·{" "}
                      {suggestion.total_report_hours}h approved · score{" "}
                      {suggestion.score}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {suggestion.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                    {suggestion.languages.length > 0 ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Languages: {suggestion.languages.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  {onSelect ? (
                    <Button
                      type="button"
                      variant={selected ? "default" : "outline"}
                      size="sm"
                      className="rounded-lg"
                      onClick={() => onSelect(suggestion.interpreter_id)}
                    >
                      {selected
                        ? appointmentText("Ausgewählt", "Выбрано", "Selected")
                        : appointmentText("Übernehmen", "Выбрать", "Use")}
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Section>
  );
}
