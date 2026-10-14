import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { checkboxClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { CONSENT_RECIPIENTS_INVALID, fetchMyLeadRequestList, LEAD_REQUEST_GUARDIAN_ONLY, saveLeadTrustedPersons, type LeadRequest } from "./lead-request-api";
import { choiceOnlyByGuardian, choosesForChild } from "./lead-request-consent-form";
import { LeadCabinetFrame } from "./lead-request-page";
import { CabinetSection, errorBody } from "./lead-request-parts";
import { asLeadCabinetLang, leadRequestText, resolveLeadCabinetLang, type LeadCabinetLang } from "./lead-request-text";
import { TrustedPersonsEditor } from "./lead-trusted-persons-editor";
import { disclosureChanged, disclosureDraft, disclosureProblem, disclosureToSend, requestForLead, type DisclosureDraft } from "./lead-trusted-persons-model";
import { trustedPersonsText } from "./lead-trusted-persons-text";

const LANGUAGE_KEY = "gmed_lead_cabinet_lang";

export function LeadTrustedPersonsPage() {
  const { user } = useAuth();
  const { lang: portalLang, setLang: setPortalLang } = useLang();
  const [chosenLang, setChosenLang] = useState<LeadCabinetLang | null>(() => {
    try { return asLeadCabinetLang(window.localStorage.getItem(LANGUAGE_KEY)); } catch { return null; }
  });
  const [requests, setRequests] = useState<LeadRequest[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get("lead"));
  const [closed, setClosed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DisclosureDraft>>({});
  const [errors, setErrors] = useState<Record<string, "invalid" | "failed" | "outdated" | "consentRequired" | "required" | "decision" | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const saving = useRef(false);
  const request = requestForLead(requests ?? [], selected);
  const requestLang = asLeadCabinetLang(request?.personal_data.primary_language);
  const lang = resolveLeadCabinetLang(chosenLang, requestLang, portalLang);
  const common = leadRequestText(lang);
  const text = trustedPersonsText(lang);

  const chooseLang = useCallback((next: LeadCabinetLang) => {
    setChosenLang(next);
    try { window.localStorage.setItem(LANGUAGE_KEY, next); } catch { /* The choice lasts for this visit. */ }
    if (next === "de" || next === "ru") setPortalLang(next);
  }, [setPortalLang]);
  useEffect(() => {
    if (!chosenLang && !user?.preferred_language && (requestLang === "de" || requestLang === "ru")) chooseLang(requestLang);
  }, [chosenLang, user?.preferred_language, requestLang, chooseLang]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const result = await fetchMyLeadRequestList();
      setRequests(result.requests);
      setClosed(result.ownAccessClosed);
    } catch { setLoadFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const anyUnsaved = (requests ?? []).some((item) => drafts[item.lead_id] && disclosureChanged(drafts[item.lead_id], item, user?.id));
  useEffect(() => {
    if (!anyUnsaved && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyUnsaved, busy]);

  const draft = request ? drafts[request.lead_id] ?? disclosureDraft(request, user?.id) : { allowDisclosure: null, consentGiven: false, persons: [] };
  const changed = Boolean(request && disclosureChanged(draft, request, user?.id));
  const problem = disclosureProblem(draft);
  const companyName = request?.disclosure_company_name?.trim() || request?.disclosure?.company_name?.trim() || "GMED";
  const childName = [request?.personal_data.first_name, request?.personal_data.last_name].filter(Boolean).join(" ");
  const ownMinor = request ? choiceOnlyByGuardian(request) : false;
  const requestHref = `${user?.portal_mode === "lead" ? "/" : "/request"}?lead=${encodeURIComponent(request?.lead_id ?? "")}`;

  async function save() {
    if (!request || ownMinor || problem || !changed || saving.current) return;
    const leadId = request.lead_id;
    saving.current = true;
    setBusy(leadId);
    setErrors((current) => ({ ...current, [leadId]: undefined }));
    try {
      const saved = await saveLeadTrustedPersons(leadId, disclosureToSend(draft, lang));
      setRequests((current) => current?.map((item) => item.lead_id === leadId ? saved : item) ?? null);
      setDrafts((current) => ({ ...current, [leadId]: disclosureDraft(saved, user?.id) }));
    } catch (cause) {
      const code = errorBody(cause)?.code;
      setErrors((current) => ({ ...current, [leadId]: code === CONSENT_RECIPIENTS_INVALID ? "invalid" : code === "disclosure_consent_required" ? "consentRequired" : code === "disclosure_version_outdated" ? "outdated" : code === "consent_recipients_required" ? "required" : code === "disclosure_decision_invalid" ? "decision" : "failed" }));
      if (code === LEAD_REQUEST_GUARDIAN_ONLY || cause instanceof ApiRequestError && (cause.status === 403 || cause.status === 404)) {
        // A revoked grant or a newly closed minor login must not retain an editable stale form.
        setRequests((current) => current?.filter((item) => item.lead_id !== leadId) ?? null);
        if (code === LEAD_REQUEST_GUARDIAN_ONLY) setClosed(true);
        await load();
      }
    } finally { saving.current = false; setBusy(null); }
  }

  function update(patch: Partial<DisclosureDraft>) {
    if (!request) return;
    setDrafts((current) => ({ ...current, [request.lead_id]: { ...draft, ...patch } }));
    setErrors((current) => ({ ...current, [request.lead_id]: undefined }));
  }

  return <LeadCabinetFrame lang={lang} onLang={chooseLang}>
    <h1 className="text-xl font-semibold">{text.title}</h1>
    {loadFailed ? <><Banner tone="error">{common.loadFailed}</Banner><Button variant="outline" onClick={() => void load()}>{common.retry}</Button></> :
      !requests ? <div role="status" className="py-10"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /></div> :
        !request || ownMinor ? <p className="text-sm text-muted-foreground" data-testid={closed || ownMinor ? "lead-request-guardian-only" : "trusted-persons-no-request"}>{closed || ownMinor ? common.guardianOnly : common.noRequest}</p> : <>
          {requests.length > 1 ? <label className="block max-w-xl space-y-1 text-sm" data-testid="trusted-persons-request"><span>{common.requestFor}</span>
            <NativeComboboxSelect className={selectClass} value={request.lead_id} disabled={Boolean(busy)} onChange={(event) => setSelected(event.target.value)}>
              {requests.map((item) => <option key={item.lead_id} value={item.lead_id}>{[item.personal_data.first_name, item.personal_data.last_name].filter(Boolean).join(" ") || common.title}</option>)}
            </NativeComboboxSelect>
          </label> : null}
          <CabinetSection title={text.question}>
            <div className="space-y-4" data-testid="trusted-persons-form">
              {request.access_kind === "guardian" ? <p className="rounded-xl border border-border/60 bg-muted/40 p-3 text-sm leading-relaxed">{choosesForChild(request) ? text.guardianContext(childName) : text.representativeContext(childName)}</p> : null}
              <p className="text-sm leading-relaxed text-muted-foreground">{text.introduction}</p>
              <fieldset className="space-y-2" disabled={Boolean(busy)}>
                <legend className="sr-only">{text.question}</legend>
                {[false, true].map((allow) => <label key={String(allow)} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-sm has-[:checked]:border-[var(--brand)]">
                  <input type="radio" name={`disclosure-${request.lead_id}`} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" checked={draft.allowDisclosure === allow} data-testid={allow ? "disclosure-yes" : "disclosure-no"} onChange={() => update({ allowDisclosure: allow, consentGiven: false })} />
                  <span>{allow ? text.yes : text.no}</span>
                </label>)}
              </fieldset>
              {draft.allowDisclosure === true ? <>
                <TrustedPersonsEditor persons={draft.persons} lang={lang} disabled={Boolean(busy)} onChange={(persons) => update({ persons, consentGiven: false })} />
                <fieldset className="space-y-3 rounded-xl border border-border/60 bg-card p-4" disabled={Boolean(busy)}>
                  <legend className="px-1 font-medium">{text.consentHeading}</legend>
                  <p className="text-xs text-muted-foreground">{text.consentNote}</p>
                  <label className="flex items-start gap-3 text-sm leading-relaxed">
                    <input type="checkbox" className={`${checkboxClass} mt-1 shrink-0`} checked={draft.consentGiven} data-testid="disclosure-consent" onChange={(event) => update({ consentGiven: event.currentTarget.checked })} />
                    <span>{text.consent(companyName)}</span>
                  </label>
                  <a className="text-sm text-[var(--brand)] underline underline-offset-4" href={`/legal?lang=${lang}#privacy`} target="_blank" rel="noreferrer">{text.privacy}</a>
                </fieldset>
              </> : null}
              {problem ? <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{problem === "consent" ? text.consentRequired : text[problem]}</p> : null}
              <p className="text-sm leading-relaxed text-muted-foreground">{text.footer}</p>
              {request.disclosure ? <p className="text-xs text-muted-foreground" data-testid="disclosure-receipt">{text.saved} · {formatAppDateTime(request.disclosure.chosen_at)}{request.disclosure.chosen_by_name ? ` · ${request.disclosure.chosen_by_name}` : ""}</p> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" disabled={Boolean(busy) || problem !== null || !changed} onClick={() => void save()} data-testid="trusted-persons-save">
                  {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{busy ? common.saving : text.save}
                </Button>
                <span role="status" className="inline-flex items-center gap-1 text-sm text-muted-foreground" data-testid="trusted-persons-save-state">
                  {changed ? text.unsaved : request.disclosure ? <><Check aria-hidden="true" className="size-4 text-emerald-600" />{text.saved}</> : text.unanswered}
                </span>
              </div>
              {errors[request.lead_id] ? <div role="alert"><Banner tone="error">{errors[request.lead_id] === "failed" ? common.errors.request_failed : text[errors[request.lead_id] as Exclude<typeof errors[string], "failed" | undefined>]}</Banner></div> : null}
              <a href={requestHref} className="text-sm font-medium text-[var(--brand)] underline underline-offset-4">{text.requestLink}</a>
            </div>
          </CabinetSection>
        </>}
  </LeadCabinetFrame>;
}
