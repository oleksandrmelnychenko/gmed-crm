import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlert, ClipboardList, FileSignature, Files, ReceiptText, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Lang } from "@/lib/i18n";

const STEP_ICONS = [UserRoundCheck, ClipboardList, ReceiptText, FileSignature, Files, ShieldCheck];

export function OrderWizardShell({ title, description, lang, steps, step, disabled, busy, loading, dirty, onClose, onStepChange, children, footer, error }: {
  title: string;
  description: string;
  lang: Lang;
  steps: string[];
  step: number;
  disabled: boolean;
  busy: boolean;
  loading: boolean;
  dirty: boolean;
  onClose: () => void;
  onStepChange: (step: number) => void;
  children: ReactNode;
  footer: ReactNode;
  error?: string | null;
}) {
  const navRef = useRef<HTMLElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    const active = tabsRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    const nav = navRef.current;
    if (!active || !nav) return;
    nav.scrollTo({ left: nav.scrollLeft + active.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - active.offsetWidth) / 2 });
  }, [step, lang]);

  return <Dialog open dirty={!busy && dirty} onOpenChange={(open, details) => {
    if (!open && busy) { details.cancel(); return; }
    if (!open) onClose();
  }}>
    <DialogContent data-testid="order-wizard" showCloseButton={!busy} className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(88vh,52rem)] sm:w-[91vw] sm:max-w-[91vw] sm:pb-0">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 pr-14 sm:gap-4 sm:px-5 sm:pr-14">
        <div className="min-w-0">
          <DialogTitle className="truncate text-base font-semibold text-foreground">{title}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">{description}</DialogDescription>
        </div>
      </header>
      <nav ref={navRef} aria-label={lang === "ru" ? "Этапы заказа" : "Auftragsschritte"} className="shrink-0 overflow-x-auto overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max min-w-full justify-center px-4 py-2.5">
          <div ref={tabsRef} className="t-tabs lead-wizard-step-tabs" role="tablist">
            {steps.map((label, index) => {
              const Icon = STEP_ICONS[index];
              return <button key={index} type="button" role="tab" id={`order-wizard-tab-${index}`} data-step={index} aria-controls="order-wizard-step-panel" aria-selected={step === index} aria-current={step === index ? "step" : undefined} tabIndex={step === index ? 0 : -1}
                className="t-tab lead-wizard-step-tab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} onClick={() => onStepChange(index)}
                onKeyDown={event => {
                  const next = event.key === "ArrowRight" ? (index + 1) % steps.length : event.key === "ArrowLeft" ? (index + steps.length - 1) % steps.length : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
                  if (next === null) return;
                  event.preventDefault();
                  tabsRef.current?.querySelector<HTMLElement>(`[data-step="${next}"]`)?.focus();
                }}>
                <Icon aria-hidden className="size-4 shrink-0" /><span className="whitespace-nowrap">{label}</span>
                <span aria-hidden data-count className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none ${step === index ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>{index + 1}</span>
              </button>;
            })}
          </div>
        </div>
      </nav>
      <main ref={panelRef} id="order-wizard-step-panel" role="tabpanel" aria-labelledby={`order-wizard-tab-${step}`} aria-busy={loading || busy} tabIndex={-1} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-4 py-5 outline-none sm:px-5">{children}</main>
      <footer className="shrink-0 border-t border-border bg-muted/50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
        {error ? <div role="alert" className="mb-3 flex max-h-28 items-start gap-2 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"><CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div> : null}
        {footer}
      </footer>
    </DialogContent>
  </Dialog>;
}
