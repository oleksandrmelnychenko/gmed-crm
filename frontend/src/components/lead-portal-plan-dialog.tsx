import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";

import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import {
  fetchLeadPortalPlanCatalogue,
  requestLeadPortalPlan,
  type LeadPortalPlanCatalogue,
} from "@/lib/lead-portal-plan-requests";
import { cn } from "@/lib/utils";
import { fetchMyLeadRequests } from "@/pages/patient-lead/lead-request-api";

const TEXT = {
  de: {
    title: "Patientenbereich",
    locked: "Dieser Bereich ist noch gesperrt.",
    explanation: "Er wird nach der Aufnahme als Patient und der Freigabe des Zugangs verfügbar. Sie können GMED jetzt Ihr Interesse an einem Paket mitteilen.",
    disclaimer: "Die Anfrage aktiviert kein Paket und schaltet diesen Bereich nicht frei.",
    request: "Anfrage auswählen",
    forRequest: "Für die Anfrage",
    unnamed: "Anfrage ohne Namen",
    packages: "Paket auswählen",
    empty: "Zurzeit sind keine Pakete verfügbar. Bitte wenden Sie sich an GMED.",
    unavailable: "Keine zugängliche Anfrage gefunden. Bitte wenden Sie sich an GMED.",
    loading: "Pakete werden geladen…",
    error: "Die Pakete konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
    submitError: "Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
    retry: "Erneut versuchen",
    submit: "Interesse senden",
    pending: "Bereits angefragt",
    sent: "Ihr Interesse wurde an GMED übermittelt.",
    existing: "Ihr Interesse an diesem Paket liegt GMED bereits vor.",
  },
  ru: {
    title: "Раздел пациента",
    locked: "Этот раздел пока закрыт.",
    explanation: "Он станет доступен после оформления пациента и подтверждения доступа. Сейчас можно сообщить GMED о желании оформить пакет.",
    disclaimer: "Запрос не активирует пакет и не открывает этот раздел.",
    request: "Выберите заявку",
    forRequest: "Для заявки",
    unnamed: "Заявка без имени",
    packages: "Выберите пакет",
    empty: "Сейчас нет доступных пакетов. Обратитесь в GMED.",
    unavailable: "Доступная заявка не найдена. Обратитесь в GMED.",
    loading: "Загружаем пакеты…",
    error: "Не удалось загрузить пакеты. Попробуйте ещё раз.",
    submitError: "Не удалось отправить запрос. Попробуйте ещё раз.",
    retry: "Повторить",
    submit: "Запросить пакет",
    pending: "Уже запрошен",
    sent: "Ваш запрос отправлен в GMED.",
    existing: "GMED уже получил ваш запрос на этот пакет.",
  },
} as const;

type RequestChoice = { id: string; name: string };

export function LeadPortalPlanDialog({ moduleId, moduleLabel, onClose }: {
  moduleId: string;
  moduleLabel: string;
  onClose: () => void;
}) {
  const { lang, t } = useLang();
  const text = TEXT[lang];
  const generation = useRef(0);
  const [choices, setChoices] = useState<RequestChoice[]>([]);
  const [leadId, setLeadId] = useState("");
  const [catalogue, setCatalogue] = useState<LeadPortalPlanCatalogue | null>(null);
  const [packageId, setPackageId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"load" | "submit" | null>(null);
  const [result, setResult] = useState<"sent" | "existing" | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    void fetchMyLeadRequests().then(async (requests) => {
      if (!active || generation.current !== version) return;
      const nextChoices = requests.map((request) => ({
        id: request.lead_id,
        name: [request.personal_data.first_name, request.personal_data.middle_name, request.personal_data.last_name]
          .filter(Boolean).join(" ") || text.unnamed,
      }));
      setChoices(nextChoices);
      // A parent may have several children's requests: never silently choose
      // the first child's request for this independent interest form.
      const selected = nextChoices.length === 1 ? nextChoices[0].id : "";
      setLeadId(selected);
      if (!selected) return;
      const next = await fetchLeadPortalPlanCatalogue(selected);
      if (active && generation.current === version) setCatalogue(next);
    }).catch(() => {
      if (active && generation.current === version) setError("load");
    }).finally(() => {
      if (active && generation.current === version) setLoading(false);
    });
    return () => { active = false; generation.current += 1; };
  }, [retryVersion, text.unnamed]);

  async function selectRequest(nextLeadId: string) {
    if (!choices.some((choice) => choice.id === nextLeadId)) return;
    const version = ++generation.current;
    setLeadId(nextLeadId);
    setPackageId("");
    setCatalogue(null);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const next = await fetchLeadPortalPlanCatalogue(nextLeadId);
      if (generation.current === version) setCatalogue(next);
    } catch {
      if (generation.current === version) setError("load");
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }

  const pending = catalogue?.requests.some((request) =>
    request.package_id === packageId && request.module_id === moduleId && request.status === "pending",
  ) ?? false;

  async function submit() {
    if (loading || saving || pending || !leadId || !catalogue?.packages.some((plan) => plan.id === packageId)) return;
    const version = generation.current;
    setSaving(true);
    setError(null);
    try {
      const response = await requestLeadPortalPlan(leadId, packageId, moduleId);
      if (generation.current !== version) return;
      setCatalogue((previous) => previous ? {
        ...previous,
        requests: [...previous.requests.filter((request) => request.id !== response.request.id), response.request],
      } : previous);
      setResult(response.created ? "sent" : "existing");
    } catch {
      if (generation.current === version) setError("submit");
    } finally {
      if (generation.current === version) setSaving(false);
    }
  }

  return (
    <Dialog open dirty={false} allowImplicitDismissal onOpenChange={(open) => { if (!open) onClose(); }}>
      <AdminDialogScaffold
        testId="lead-portal-plan-dialog"
        title={`${text.title}: ${moduleLabel}`}
        description={text.locked}
        maxWidthClassName="sm:max-w-[680px]"
        footer={<div className="flex flex-wrap justify-end gap-2 p-3">
          <Button type="button" variant="outline" onClick={onClose}>{t.common_close}</Button>
          <Button type="button" data-testid="lead-portal-plan-submit" onClick={() => void submit()}
            disabled={loading || saving || !packageId || pending || !catalogue?.packages.length}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {pending ? text.pending : text.submit}
          </Button>
        </div>}
      >
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800">
          <p className="flex items-start gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{text.explanation}</p>
          <p className="font-medium">{text.disclaimer}</p>
        </div>
        {choices.length ? <AdminFormSection title={text.forRequest}>
          {choices.length > 1 ? <div className="space-y-1.5">
            <label htmlFor="lead-portal-plan-request" className="text-xs text-muted-foreground">{text.request}</label>
            <NativeComboboxSelect id="lead-portal-plan-request" aria-label={text.request} value={leadId}
              hidePlaceholderOption disabled={saving} onChange={(event) => void selectRequest(event.target.value)}>
              <option value="">{text.request}</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
            </NativeComboboxSelect>
          </div> : <p className="break-words font-medium" data-testid="lead-portal-plan-request-name">{choices[0].name}</p>}
        </AdminFormSection> : null}
        {loading ? <p role="status" className="flex items-center gap-2 p-2 text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{text.loading}</p> : null}
        {error ? <div role="alert" className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <p>{error === "load" ? text.error : text.submitError}</p>
          {error === "load" ? <Button type="button" variant="outline" onClick={() => {
            setCatalogue(null); setPackageId(""); setResult(null); setRetryVersion((value) => value + 1);
          }}>{text.retry}</Button> : null}
        </div> : null}
        {!loading && !error && !choices.length ? <p className="p-2 text-muted-foreground">{text.unavailable}</p> : null}
        {!loading && catalogue ? <AdminFormSection title={text.packages}>
          {catalogue.packages.length ? <fieldset aria-label={text.packages} className="grid min-w-0 gap-2 sm:grid-cols-2">
            {catalogue.packages.map((plan) => <label key={plan.id} className={cn(
              "flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              packageId === plan.id ? "border-primary bg-primary text-white" : "border-border bg-card hover:border-primary",
              saving && "pointer-events-none",
            )}>
              <input type="radio" name="lead-portal-plan" value={plan.id} checked={packageId === plan.id}
                disabled={saving} className="mt-0.5 shrink-0 accent-[var(--brand)]"
                onChange={() => { setPackageId(plan.id); setResult(null); setError(null); }} />
              <span className="min-w-0 break-words font-medium">{plan.name}</span>
            </label>)}
          </fieldset> : <p className="text-muted-foreground">{text.empty}</p>}
        </AdminFormSection> : null}
        {result ? <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{result === "sent" ? text.sent : text.existing}
        </div> : null}
      </AdminDialogScaffold>
    </Dialog>
  );
}
