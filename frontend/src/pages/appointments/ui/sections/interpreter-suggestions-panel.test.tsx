import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InterpreterSuggestionsPanel } from "./interpreter-suggestions-panel";

describe("InterpreterSuggestionsPanel", () => {
  it("renders history, feedback, and language unknown without blocking", () => {
    const html = renderToStaticMarkup(
      <InterpreterSuggestionsPanel
        suggestions={[
          {
            interpreter_id: "int-1",
            interpreter_name: "Iryna Interpreter",
            role: "interpreter",
            preference: "preferred",
            language_status: "language unknown",
            languages: [],
            previous_appointment_count: 4,
            completed_appointment_count: 3,
            approved_report_count: 2,
            total_report_hours: "6.5",
            average_feedback_score: 4.9,
            last_worked_at: "2026-04-20",
            score: 188,
            reasons: ["preferred for this patient", "worked before", "high feedback"],
          },
        ]}
      />,
    );

    expect(html).toContain("Iryna Interpreter");
    expect(html).toContain("worked before");
    expect(html).toContain("high feedback");
    expect(html).toContain("language unknown");
  });
});
