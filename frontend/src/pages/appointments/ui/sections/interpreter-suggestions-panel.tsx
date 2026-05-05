import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Banner, CountBadge, Section, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import {
  interpreterLanguageStatusLabel,
  interpreterPreferenceLabel,
  interpreterSuggestionReasonLabel,
  roleLabel,
} from "@/pages/appointments/model/labels";
import type {
  InterpreterHistoryItem,
  InterpreterPreference,
  InterpreterSuggestion,
} from "@/lib/api/clinical";

type InterpreterSuggestionsPanelProps = {
  suggestions: InterpreterSuggestion[];
  selectedInterpreterId?: string | null;
  loading?: boolean;
  error?: string;
  history?: InterpreterHistoryItem[];
  historyLoading?: boolean;
  historyError?: string;
  preferenceSavingId?: string | null;
  onSelect?: (interpreterId: string) => void;
  onSetPreference?: (
    interpreterId: string,
    preference: InterpreterPreference,
  ) => void;
};

const PREFERENCE_OPTIONS: InterpreterPreference[] = [
  "preferred",
  "neutral",
  "avoid",
];

export function InterpreterSuggestionsPanel({
  suggestions,
  selectedInterpreterId,
  loading = false,
  error,
  history = [],
  historyLoading = false,
  historyError,
  preferenceSavingId = null,
  onSelect,
  onSetPreference,
}: InterpreterSuggestionsPanelProps) {
  const { t } = useLang();
  const topSuggestion = suggestions[0] ?? null;
  const preferredCount = history.filter(
    (item) => item.preference === "preferred",
  ).length;
  const avoidCount = history.filter((item) => item.preference === "avoid").length;

  return (
    <Section
      title={t.appointments_interpreter_suggestions_title}
      accessory={<CountBadge>{suggestions.length}</CountBadge>}
    >
      <p className={tokens.text.muted}>
        {t.appointments_interpreter_suggestions_description}
      </p>

      {topSuggestion ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">
                {t.appointments_interpreter_recommended_now}:{" "}
                {topSuggestion.interpreter_name}
              </p>
              <p className="mt-1 text-xs text-sky-800/80">
                {t.appointments_interpreter_score} {topSuggestion.score} -{" "}
                {topSuggestion.reasons.map(interpreterSuggestionReasonLabel).join(", ")}
              </p>
            </div>
            {onSelect ? (
              <Button
                type="button"
                size="sm"
                className="rounded-lg"
                onClick={() => onSelect(topSuggestion.interpreter_id)}
              >
                {t.appointments_interpreter_use_recommendation}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
      {loading ? (
        <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-5 text-sm text-muted-foreground">
          {t.appointments_interpreter_loading_suggestions}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
          {t.appointments_interpreter_no_suggestions}
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
                        {interpreterPreferenceLabel(suggestion.preference)}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        {interpreterLanguageStatusLabel(suggestion.language_status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {suggestion.previous_appointment_count}{" "}
                      {t.appointments_interpreter_worked_before} -{" "}
                      {suggestion.total_report_hours}
                      {t.appointments_interpreter_hours_approved} -{" "}
                      {t.appointments_interpreter_score.toLowerCase()}{" "}
                      {suggestion.score}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {suggestion.reasons.map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full border border-border/60 bg-muted/25 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        >
                          {interpreterSuggestionReasonLabel(reason)}
                        </span>
                      ))}
                    </div>
                    {suggestion.languages.length > 0 ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {t.appointments_interpreter_languages}:{" "}
                        {suggestion.languages.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {onSelect ? (
                      <Button
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        className="rounded-lg"
                        onClick={() => onSelect(suggestion.interpreter_id)}
                      >
                        {selected
                          ? t.appointments_interpreter_selected
                          : t.appointments_interpreter_use}
                      </Button>
                    ) : null}
                    {onSetPreference ? (
                      <PreferenceButtons
                        activePreference={suggestion.preference}
                        disabled={preferenceSavingId === suggestion.interpreter_id}
                        onSelectPreference={(preference) =>
                          onSetPreference(suggestion.interpreter_id, preference)
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {t.appointments_interpreter_history_title}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {preferredCount} {interpreterPreferenceLabel("preferred")} -{" "}
              {avoidCount} {interpreterPreferenceLabel("avoid")} - {history.length}{" "}
              {t.appointments_interpreter_total_relationships}
            </p>
          </div>
          <CountBadge>{history.length}</CountBadge>
        </div>
        {historyError ? (
          <div className="mt-3">
            <Banner tone="error" withIcon>{historyError}</Banner>
          </div>
        ) : null}
        {historyLoading ? (
          <div className="mt-3 rounded-xl border border-border/50 bg-muted/25 px-4 py-4 text-sm text-muted-foreground">
            {t.appointments_interpreter_loading_history}
          </div>
        ) : history.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-5 text-center text-sm text-muted-foreground">
            {t.appointments_interpreter_no_history}
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {history.map((item) => {
              const interpreterId = item.interpreter_id;
              return (
                <div
                  key={
                    interpreterId ??
                    item.patient_id ??
                    item.interpreter_name ??
                    item.patient_name
                  }
                  className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {item.interpreter_name ??
                            item.patient_name ??
                            t.appointments_interpreter_fallback_name}
                        </p>
                        <Badge variant="outline" className="rounded-full">
                          {interpreterPreferenceLabel(item.preference)}
                        </Badge>
                        {item.average_feedback_score ? (
                          <Badge variant="outline" className="rounded-full">
                            {t.appointments_interpreter_feedback}{" "}
                            {item.average_feedback_score.toFixed(1)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.appointment_count}{" "}
                        {t.appointments_interpreter_appointments} -{" "}
                        {item.completed_appointment_count}{" "}
                        {t.appointments_interpreter_completed} -{" "}
                        {item.total_report_hours}
                        {t.appointments_interpreter_hours_approved}
                        {item.last_appointment_date
                          ? ` - ${t.appointments_interpreter_last} ${item.last_appointment_date}`
                          : ""}
                      </p>
                      {item.preference_note ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.appointments_interpreter_note}: {item.preference_note}
                        </p>
                      ) : null}
                    </div>
                    {onSetPreference && interpreterId ? (
                      <PreferenceButtons
                        activePreference={item.preference}
                        disabled={preferenceSavingId === interpreterId}
                        onSelectPreference={(preference) =>
                          onSetPreference(interpreterId, preference)
                        }
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}

function PreferenceButtons({
  activePreference,
  disabled,
  onSelectPreference,
}: {
  activePreference: InterpreterPreference;
  disabled?: boolean;
  onSelectPreference: (preference: InterpreterPreference) => void;
}) {
  const { t } = useLang();
  return (
    <div className="flex flex-wrap gap-1.5 md:justify-end">
      {PREFERENCE_OPTIONS.map((preference) => (
        <Button
          key={preference}
          type="button"
          variant={activePreference === preference ? "default" : "outline"}
          size="sm"
          className="h-7 rounded-full px-2.5 text-[11px]"
          disabled={disabled}
          onClick={() => onSelectPreference(preference)}
        >
          {disabled
            ? t.appointments_interpreter_saving
            : interpreterPreferenceLabel(preference)}
        </Button>
      ))}
    </div>
  );
}
