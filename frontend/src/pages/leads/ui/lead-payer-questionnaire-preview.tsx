import { SectionHeading } from "@/components/ui/section-heading";
import { useId, useState } from "react";
import { ChevronDown, FileText, ListCheck, ArrowRightLeft } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { appDateKey, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadPayerLinkState } from "../data/lead-payer-link-api";
import { normalizeLeadPortalBilling } from "../data/lead-portal-intake-api";
import { billingStatements } from "../model/lead-gwg-statements";
import { payerQuestionnaireGroups, type Tx } from "../model/lead-payer-link";
import { PayerAnswersGroup } from "./lead-gwg-statements";

/** The submitted payer answers already returned by the staff API; no requests or writes. */
export function LeadPayerQuestionnairePreview({ state, tx }: { state: LeadPayerLinkState; tx: Tx }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const questionnaire = state.questionnaire;
  if (!questionnaire?.submitted_at) return null;

  const lang = tx("ru", "de");
  const today = appDateKey();
  const groups = payerQuestionnaireGroups(questionnaire, tx, lang, today);
  const rows = groups.flatMap((group) => group.rows);
  const summaryKeys = questionnaire.payer_type === "person"
    ? ["name", "email", "phone", "relationship", "funds_sources"]
    : ["organisation_name", "representative", "email", "phone", "funds_sources"];
  const summary = summaryKeys.flatMap((key) => {
    const row = rows.find((item) => item.key === key);
    return row ? [row] : [];
  });
  const route = questionnaire.payment_route;
  const billing = route?.asked ? normalizeLeadPortalBilling({ ...route, payment_route_by: "payer" }) : null;
  const payment = billing ? billingStatements(billing, tx, lang, true).payment : [];
  const method = payment.find((row) => row.key === "payment_method");
  const received = tx(
    `От плательщика · ${formatAppDateTime(questionnaire.submitted_at)}`,
    `Vom Zahler am ${formatAppDateTime(questionnaire.submitted_at)}`,
  );

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="lead-payer-questionnaire-preview">
      {/* A plain card header (owner 2026-10-19: no green band): title, then when it came. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <AdminSectionTitle icon={ListCheck} variant="mono">{tx("Заполненная анкета плательщика", "Ausgefüllte Angaben des Zahlers")}</AdminSectionTitle>
        <p className="text-xs leading-5 text-muted-foreground sm:ml-auto">{received}</p>
      </div>
      <div className="space-y-2 p-3">
        <dl className="grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((row) => <PreviewFact key={row.key} label={row.label} value={row.key === "email" ? questionnaire.email ?? "" : row.value} />)}
          {method ? <PreviewFact label={tx("Способ оплаты", "Zahlungsart")} value={method.value} /> : null}
        </dl>
        <p className="border-t border-border/50 pt-2 text-xs leading-5 text-muted-foreground">
          {tx(
            "Подписание документов — отдельный шаг «Договор и смета».",
            "Die Dokumente werden separat im Schritt „Vertrag & Angebot“ unterschrieben.",
          )}
        </p>
      </div>
      <div className="border-t border-border/60 px-3 py-2">
      <Button
        type="button"
        size="sm"
        variant="default"
        className="gap-2 whitespace-normal text-left"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <FileText aria-hidden="true" className="size-3.5 shrink-0" />
        {open ? tx("Свернуть анкету", "Angaben einklappen") : tx("Показать полную анкету", "Vollständige Angaben anzeigen")}
        <ChevronDown aria-hidden="true" className={cn("ml-auto size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      </div>
      <div id={detailsId} hidden={!open} data-testid="lead-payer-questionnaire-details">
        {open ? <div className="space-y-2 border-t border-border/60 bg-muted/20 p-3">
          <PayerAnswersGroup state={state} tx={tx} lang={lang} today={today} />
          {payment.length > 0 ? (
            <section className="space-y-2 rounded-lg border border-border/60 bg-card p-3" data-testid="lead-payer-questionnaire-payment">
              <h3><SectionHeading icon={ArrowRightLeft}>{tx("Способ и путь оплаты", "Zahlungsart und Zahlungsweg")}</SectionHeading></h3>
              <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {payment.map((row) => <PreviewFact key={row.key} label={row.label} value={row.value} details={row.details} warning={row.warning} />)}
              </dl>
            </section>
          ) : null}
        </div> : null}
      </div>
    </div>
  );
}

function PreviewFact({ label, value, details, warning }: { label: string; value: string; details?: string; warning?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="break-words text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 break-words text-[13px] font-medium [overflow-wrap:anywhere]", warning && "text-amber-700 dark:text-amber-300")}>
        {value || "—"}
        {details ? <span className="mt-0.5 block whitespace-pre-line font-normal">{details}</span> : null}
      </dd>
    </div>
  );
}
