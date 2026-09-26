import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReadOnlyScope } from "@/components/read-only-scope";
import { uiText } from "@/lib/i18n";
import type { AppointmentDetail, ReportSummary } from "@/pages/appointments/model/types";

import { MemoizedAppointmentReportSection } from "./report-section";

// The editor sheet portals its content only after mounting; render it inline
// so the static markup shows the fields and footer buttons.
vi.mock("@/pages/appointments/ui/shared/workspace-primitives", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/pages/appointments/ui/shared/workspace-primitives")>();
  return {
    ...actual,
    AppointmentEditorSheet: ({
      title,
      children,
      footer,
    }: {
      title: ReactNode;
      children: ReactNode;
      footer: ReactNode;
    }) => (
      <form data-testid="report-editor">
        <h2>{title}</h2>
        {children}
        <footer>{footer}</footer>
      </form>
    ),
  };
});

const detail = {
  id: "appointment-1",
  status: "confirmed",
  date: "2026-09-01",
} as AppointmentDetail;

function report(overrides: Partial<ReportSummary> = {}): ReportSummary {
  return {
    id: "report-1",
    interpreter_id: "interpreter-1",
    interpreter_name: "Synthetic Interpreter",
    hours: "2.5",
    report_text: "Accompanied the consultation.",
    approval_status: "pending",
    notes: null,
    approved_by_name: null,
    approved_at: null,
    created_at: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

const noActions = {
  canSubmitInterpreterReport: false,
  canResubmitRejectedReport: false,
  showReportReviewActions: false,
  canApproveReport: false,
  canRejectReport: false,
};

function renderReadOnly(
  detailReport: ReportSummary | null,
  reportActions: typeof noActions,
  appointment: AppointmentDetail = detail,
) {
  return renderToStaticMarkup(
    <ReadOnlyScope banner={false}>
      <MemoizedAppointmentReportSection
        detail={appointment}
        detailReport={detailReport}
        reportReviewMeta=""
        reportActions={reportActions}
        onRefresh={() => {}}
        onError={() => {}}
      />
    </ReadOnlyScope>,
  );
}

function tagDisabled(tag: string) {
  return /\sdisabled(=""|\s|>|\/)/.test(tag);
}

function hoursInput(html: string) {
  const match = /<input[^>]*type="number"[^>]*>/.exec(html);
  if (!match) throw new Error("no hours input");
  return match[0];
}

function submitButton(html: string) {
  const match = /<button[^>]*type="submit"[^>]*>/.exec(html);
  if (!match) throw new Error("no submit button");
  return match[0];
}

describe("AppointmentReportSection on the read-only interpreter page", () => {
  it("keeps the hours field enabled for the assigned interpreter's first report", () => {
    const html = renderReadOnly(null, {
      ...noActions,
      canSubmitInterpreterReport: true,
    });

    expect(html).toContain('data-testid="report-editor"');
    expect(tagDisabled(hoursInput(html))).toBe(false);
  });

  it("lets the interpreter resubmit a returned report with its hours prefilled", () => {
    const html = renderReadOnly(
      report({ approval_status: "rejected", notes: "Add the waiting time." }),
      {
        ...noActions,
        canSubmitInterpreterReport: true,
        canResubmitRejectedReport: true,
      },
    );

    const input = hoursInput(html);
    expect(tagDisabled(input)).toBe(false);
    expect(input).toContain('value="2.5"');
    expect(tagDisabled(submitButton(html))).toBe(false);
    expect(html).toContain("Повторно отправить отчёт");
  });

  it("explains that an unconfirmed appointment takes no report yet", () => {
    const html = renderReadOnly(
      null,
      { ...noActions, canSubmitInterpreterReport: true },
      { ...detail, status: "planned" },
    );

    expect(html).toContain('data-testid="appointment-report-date-hint"');
    expect(html).toContain(
      uiText("appointments_report_requires_confirmed_appointment", "ru"),
    );
    expect(tagDisabled(submitButton(html))).toBe(true);
  });

  it("does not render the submission form for read-only viewers", () => {
    const html = renderReadOnly(report(), noActions);

    expect(html).not.toContain('data-testid="report-editor"');
    expect(html).not.toContain('type="number"');
  });
});

describe("AppointmentReportSection review decision", () => {
  it("shows the reported hours next to the report text before approval", () => {
    const html = renderToStaticMarkup(
      <MemoizedAppointmentReportSection
        detail={detail}
        detailReport={report()}
        reportReviewMeta=""
        reportActions={{
          ...noActions,
          showReportReviewActions: true,
          canApproveReport: true,
          canRejectReport: true,
        }}
        onRefresh={() => {}}
        onError={() => {}}
      />,
    );

    expect(html).toContain("Решение по проверке");
    expect(html).toContain("Согласовать часы и отчёт");
    expect(html).toMatch(/data-testid="report-review-hours"[^>]*>2\.5 ч</);
    expect(html).toContain("Часы");
    expect(html).toContain("Accompanied the consultation.");
  });

  it("labels the hours in both catalogs", () => {
    expect(uiText("appointments_report_hours", "ru")).toBe("Часы");
    expect(uiText("appointments_report_hours", "de")).toBe("Stunden");
  });
});
