/**
 * CEO review of possible EU sanctions list matches (/sanctions): side-by-side
 * comparison, decisions with a reason, manual FiSaLis check, country blocks
 * and the list itself. See docs/architecture/sanctions-screening_ua.md.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, Gauge, Globe2, ListChecks, Search, ShieldAlert, ShieldCheck } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { AdminGuideButton } from "@/components/admin-guide";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, PageHeader, SuccessBanner, TabLoader, TabShell, tokens } from "@/components/ui-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { copyText, selectElementText } from "@/lib/copy-text";
import { formatUiText, useLang, type Lang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  sanctionsApi,
  type CountryBlocksResponse,
  type CountryLift,
  type CountrySubject,
  type SubjectKind,
  type HitStatus,
  type HitsResponse,
  type SanctionsHit,
  type SubjectData,
} from "./api";
import { SanctionsReasonDialog } from "./components";
import { SanctionsListSettings } from "./list-settings";
import { RiskSettingsTab } from "./risk-settings";
import {
  FISALIS_URL,
  PATIENT_RELATION_ROLES,
  PAYER_CONTACT_RELATION,
  countryList,
  dobMatchLabel,
  fisalisSearchText,
  formatListBirthDate,
  hitStatusLabel,
  labelWithCount,
  listEntryNames,
  regulationLabel,
  safeLegalActUrl,
  scorePercent,
  subjectChanged,
  subjectKindLabel,
} from "./model";

type Tab = "open" | "decided" | "countries" | "list" | "risk";
/**
 * Relations the kind label already names (`lead_payer`, `lead_recipient`, `patient_relation`,
 * `payer_contact`).
 */
const HIDDEN_RELATIONS = new Set<string>([
  "payer",
  "invoice_recipient",
  ...PATIENT_RELATION_ROLES,
  PAYER_CONTACT_RELATION,
]);
const TABS: Tab[] = ["open", "decided", "countries", "list", "risk"];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-[13px]">{children || "—"}</dd>
    </div>
  );
}

function SubjectDetails({
  subject,
  bank,
  t,
  lang,
}: {
  subject: SubjectData;
  bank: boolean;
  t: Translations;
  lang: "ru" | "de";
}) {
  // An organisation has no birth date and no citizenship (QA 2026-10-10): its country is the seat.
  // A bank's country is the country of the account (owner decision 2026-10-11).
  const organisation = subject.organisation;
  return (
    <dl className="space-y-2">
      <Row label={bank ? t.sanctions_field_bank : organisation ? t.sanctions_field_entity : t.sanctions_field_names}>
        {fisalisSearchText(subject)}
      </Row>
      {organisation ? null : (
        <>
          <Row label={t.sanctions_field_dob}>{subject.date_of_birth ? formatAppDate(subject.date_of_birth) : ""}</Row>
          <Row label={t.sanctions_field_citizenships}>{countryList(subject.citizenships, lang)}</Row>
        </>
      )}
      {subject.residence && subject.residence.length > 0 ? (
        <Row
          label={
            bank
              ? t.sanctions_field_account_country
              : organisation
                ? t.sanctions_field_seat
                : t.sanctions_field_residence
          }
        >
          {countryList(subject.residence, lang)}
        </Row>
      ) : null}
      {/* The kind label already says "payer" or "invoice recipient". */}
      {subject.relation && !HIDDEN_RELATIONS.has(subject.relation) && !bank ? (
        <Row label={t.sanctions_field_relation}>{subject.relation}</Row>
      ) : null}
    </dl>
  );
}

export function HitCard({
  hit,
  onDecided,
}: {
  hit: SanctionsHit;
  onDecided: () => void;
}) {
  const { t, lang } = useLang();
  const cardRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [decision, setDecision] = useState<"false_positive" | "confirmed" | null>(null);
  const [fisalisNote, setFisalisNote] = useState<{ ok: boolean; name: string } | null>(null);
  const subject = hit.current_subject ?? hit.subject_snapshot;
  const changed = subjectChanged(hit);
  const entry = hit.list_entry;
  // For a bank FiSaLis is searched by the bank's name as well.
  const name = fisalisSearchText(subject);
  const bank = hit.subject_kind === "lead_bank";
  const listBirthDates = entry.birth_dates
    .map((birth) => formatListBirthDate(birth, t))
    .filter(Boolean)
    .join("; ");
  const dobMatch = dobMatchLabel(hit.match_details.dob, t);

  const openFisalis = () => {
    // The name goes to the clipboard, never into the URL; FiSaLis opens empty.
    const copying = copyText(name, cardRef.current);
    window.open(FISALIS_URL, "_blank", "noopener,noreferrer");
    void copying.then((ok) => {
      setFisalisNote({ ok, name });
      if (!ok) window.setTimeout(() => selectElementText(nameRef.current), 0);
    });
  };

  const ownerLink = hit.lead_id
    ? { to: `/leads?lead=${hit.lead_id}`, label: t.sanctions_open_lead }
    : hit.patient_id
      ? { to: `/patients?patient=${hit.patient_id}`, label: t.sanctions_open_patient }
      : null;

  return (
    <article
      ref={cardRef}
      className="min-w-0 space-y-3.5 rounded-xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4"
      data-testid="sanctions-hit"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={hit.status === "confirmed" ? "error" : hit.status === "open" ? "warning" : "success"}>
              {hitStatusLabel(hit.status, t)}
            </StatusChip>
            <span className="text-sm font-semibold" data-testid="sanctions-hit-kind">
              {subjectKindLabel(hit.subject_kind, t, hit.subject_ref, subject.relation)}
            </span>
            {hit.owner_name ? <span className="text-sm text-muted-foreground">· {hit.owner_name}</span> : null}
            {hit.patient_number ? <span className="font-mono text-xs text-muted-foreground">{hit.patient_number}</span> : null}
          </div>
          <p className="break-words text-xs leading-5 text-muted-foreground">
            {formatAppDateTime(hit.created_at)} · {t.sanctions_field_score}: {scorePercent(hit.score)}
            {hit.match_details.matched_name ? ` · ${t.sanctions_field_matched_name}: ${hit.match_details.matched_name}` : ""}
          </p>
        </div>
        {ownerLink ? (
          <StaffLink to={ownerLink.to} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">
            {ownerLink.label}
          </StaffLink>
        ) : null}
      </header>

      {!hit.still_matches ? <Banner tone="warning">{t.sanctions_no_longer_matches}</Banner> : null}

      <div className="grid gap-3 rounded-xl bg-muted p-3 lg:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-lg border border-border/50 bg-card p-3">
          <AdminSectionTitle>{t.sanctions_our_person}</AdminSectionTitle>
          <SubjectDetails subject={subject} bank={bank} t={t} lang={lang} />
          {changed ? (
            <div className="space-y-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              <p>{t.sanctions_snapshot_differs}</p>
              <SubjectDetails subject={hit.subject_snapshot} bank={bank} t={t} lang={lang} />
            </div>
          ) : null}
        </section>
        <section className="min-w-0 space-y-3 rounded-lg border border-border/50 bg-card p-3">
          <AdminSectionTitle>
            {t.sanctions_list_entry}
            {entry.subject_type === "entity" ? ` · ${t.sanctions_field_entity}` : ""}
          </AdminSectionTitle>
          <dl className="space-y-2">
            <Row label={t.sanctions_field_names}>
              <ul className="space-y-0.5">
                {listEntryNames(entry).map((listName) => (
                  <li key={listName}>{listName}</li>
                ))}
              </ul>
            </Row>
            {entry.subject_type === "entity" ? null : (
              <Row label={t.sanctions_field_dob}>
                {listBirthDates}
                {/* A real space, not a margin: copied or read text must not run together (QA N-07). */}
                {dobMatch ? (
                  <>
                    {listBirthDates ? " " : null}
                    <span className="text-xs text-muted-foreground">{dobMatch}</span>
                  </>
                ) : null}
              </Row>
            )}
            {entry.subject_type === "entity" ? null : (
              <Row label={t.sanctions_field_citizenships}>{countryList(entry.citizenships, lang)}</Row>
            )}
            <Row label={t.sanctions_field_regulation}>
              <ul className="space-y-0.5">
                {entry.regulations.map((regulation, index) => {
                  const url = safeLegalActUrl(regulation.url);
                  return (
                    <li key={`${regulation.number_title ?? ""}-${index}`} className="flex flex-wrap items-center gap-1.5">
                      <span>{regulationLabel(regulation)}</span>
                      {regulation.publication_date ? (
                        <span className="text-xs text-muted-foreground">{formatAppDate(regulation.publication_date)}</span>
                      ) : null}
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
                        >
                          {t.sanctions_legal_act}
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Row>
            <Row label={t.sanctions_field_eu_reference}>{entry.eu_reference ?? ""}</Row>
            {entry.un_reference ? <Row label={t.sanctions_field_un_reference}>{entry.un_reference}</Row> : null}
            {entry.remark ? (
              <Row label={t.sanctions_field_remark}>
                <span className="whitespace-pre-line text-xs">{entry.remark}</span>
              </Row>
            ) : null}
            <Row label={t.sanctions_field_list_version}>{formatAppDate(hit.list_version_date)}</Row>
          </dl>
        </section>
      </div>

      {hit.status === "open" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9 rounded-lg bg-field sm:h-8" onClick={() => setDecision("false_positive")}>
              <ShieldCheck className="size-4" aria-hidden />
              {t.sanctions_button_false_positive}
            </Button>
            <Button type="button" size="sm" variant="destructive" className="h-9 rounded-lg sm:h-8" onClick={() => setDecision("confirmed")}>
              <ShieldAlert className="size-4" aria-hidden />
              {t.sanctions_button_confirm}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-9 rounded-lg sm:h-8" onClick={openFisalis}>
              <Search className="size-4" aria-hidden />
              {t.sanctions_button_fisalis}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
          </div>
          {fisalisNote ? (
            <p className="text-xs text-muted-foreground" role="status">
              {fisalisNote.ok ? t.sanctions_fisalis_copied : t.sanctions_fisalis_copy_failed}{" "}
              <span ref={nameRef} className="rounded bg-muted px-1 font-mono text-foreground">
                {fisalisNote.name}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatUiText(t.sanctions_decided_by, {
            name: hit.decided_by_name ?? "—",
            date: hit.decided_at ? formatAppDateTime(hit.decided_at) : "",
          })}
          {hit.decision_reason ? ` · ${hit.decision_reason}` : ""}
        </p>
      )}

      <SanctionsReasonDialog
        open={decision !== null}
        title={decision === "confirmed" ? t.sanctions_decide_confirm_title : t.sanctions_decide_false_positive_title}
        description={decision === "confirmed" ? t.sanctions_decide_confirm_hint : t.sanctions_decide_false_positive_hint}
        confirmLabel={decision === "confirmed" ? t.sanctions_button_confirm : t.sanctions_button_false_positive}
        destructive={decision === "confirmed"}
        onConfirm={async (reason) => {
          if (!decision) return;
          await sanctionsApi.decide(hit.id, decision, reason);
          onDecided();
        }}
        onClose={() => setDecision(null)}
      />
    </article>
  );
}

/**
 * The hits of one tab. Every load (also the one after a decision) reports the
 * counts, so the tab label never shows a stale number (QA 2026-10-11 N-05).
 */
function HitsTab({
  status,
  onCounts,
}: {
  status: HitStatus | "decided";
  onCounts: (counts: HitsResponse["counts"]) => void;
}) {
  const { t } = useLang();
  const [hits, setHits] = useState<SanctionsHit[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      if (status === "decided") {
        const [falsePositives, confirmed] = await Promise.all([
          sanctionsApi.hits("false_positive"),
          sanctionsApi.hits("confirmed"),
        ]);
        setHits(
          [...confirmed.hits, ...falsePositives.hits].sort((left, right) =>
            (right.decided_at ?? "").localeCompare(left.decided_at ?? ""),
          ),
        );
        onCounts(confirmed.counts);
      } else {
        const response = await sanctionsApi.hits(status);
        setHits(response.hits);
        onCounts(response.counts);
      }
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
      setHits([]);
    }
  }, [status, t.common_error, onCounts]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hits === null) return <TabLoader />;
  return (
    <div className="space-y-3">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {hits.length === 0 ? (
        <p className="rounded-xl border border-border/50 bg-card px-4 py-10 text-center text-sm text-muted-foreground">{t.sanctions_no_hits}</p>
      ) : (
        hits.map((hit) => <HitCard key={hit.id} hit={hit} onDecided={() => void load()} />)
      )}
    </div>
  );
}

/** One lead or patient of the «Страны» tab. */
type CountryBlockItem = {
  kind: "lead" | "patient";
  id: string;
  to: string;
  name: string;
  number: string | null;
  flag: "blocked_country" | "country_lifted";
  found: string[];
  lift: CountryLift | null;
  subjects: CountrySubject[];
};

/** "Default payer: Beispiel GmbH (organisation) — Russia". */
function countrySubjectLine(subject: CountrySubject, t: Translations, lang: Lang): string {
  const role =
    subject.kind === "paying_patient"
      ? (t.uiText.sanctions_country_subject_paying_patient ?? subject.kind)
      : subjectKindLabel(subject.kind as SubjectKind, t, null, subject.role) ?? subject.kind;
  const organisation = subject.organisation
    ? ` (${t.uiText.sanctions_country_subject_organisation ?? ""})`
    : "";
  return `${role}: ${subject.name}${organisation} — ${countryList(subject.countries, lang)}`;
}

function countryBlockItems(data: CountryBlocksResponse): { leads: CountryBlockItem[]; patients: CountryBlockItem[] } {
  return {
    leads: data.leads.map((item) => ({
      kind: "lead",
      id: item.lead_id,
      to: `/leads?lead=${item.lead_id}`,
      name: item.name ?? item.lead_id,
      number: null,
      flag: item.flag,
      found: item.found,
      lift: item.lift,
      subjects: item.subjects ?? [],
    })),
    patients: data.patients.map((item) => ({
      kind: "patient",
      id: item.patient_id,
      to: `/patients?patient=${item.patient_id}`,
      name: item.name || item.patient_number || item.patient_id,
      number: item.patient_number,
      flag: item.flag,
      found: item.found,
      lift: item.lift,
      subjects: item.subjects ?? [],
    })),
  };
}

function CountriesTab() {
  const { t, lang } = useLang();
  const [data, setData] = useState<CountryBlocksResponse | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  // The whole row: the lift dialog names the patient or lead and who carries
  // the blocked country (QA 2026-10-12 B3-13).
  const [lifting, setLifting] = useState<CountryBlockItem | null>(null);
  const [revoking, setRevoking] = useState<{ overrideId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await sanctionsApi.countryBlocks());
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
      setData({ leads: [], patients: [] });
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <TabLoader />;
  const { leads, patients } = countryBlockItems(data);
  const renderItem = (item: CountryBlockItem) => (
    <li
      key={`${item.kind}-${item.id}`}
      className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg p-3", tokens.surface.card)}
      data-testid={`sanctions-country-${item.kind}`}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={item.flag === "blocked_country" ? "warning" : "success"}>
            {item.flag === "blocked_country" ? t.sanctions_badge_blocked_country : t.sanctions_badge_country_lifted}
          </StatusChip>
          <StaffLink to={item.to} className="text-sm font-semibold hover:underline">
            {item.name}
          </StaffLink>
          {item.number && item.number !== item.name ? (
            <span className="font-mono text-xs text-muted-foreground">{item.number}</span>
          ) : null}
          <span className="text-sm text-muted-foreground">{countryList(item.found, lang)}</span>
        </div>
        {item.subjects.length > 0 ? (
          <ul className="space-y-0.5" data-testid={`sanctions-country-${item.kind}-subjects`}>
            {item.subjects.map((subject) => (
              <li
                key={`${subject.kind}-${subject.role ?? ""}-${subject.name}`}
                className="text-xs text-foreground"
              >
                {countrySubjectLine(subject, t, lang)}
              </li>
            ))}
          </ul>
        ) : null}
        {item.lift ? (
          <p className="text-xs text-muted-foreground">
            {formatUiText(t.sanctions_banner_country_lifted, {
              countries: countryList(item.lift.countries, lang),
              name: item.lift.lifted_by_name ?? "—",
              date: formatAppDate(item.lift.lifted_at),
              reason: item.lift.reason,
            })}
          </p>
        ) : null}
      </div>
      {item.flag === "blocked_country" ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setLifting(item)}>
          {item.kind === "patient" ? t.sanctions_country_lift_patient : t.sanctions_country_lift}
        </Button>
      ) : item.lift ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setRevoking({ overrideId: item.lift!.id })}>
          {t.sanctions_country_revoke}
        </Button>
      ) : null}
    </li>
  );
  const liftingPatient = lifting?.kind === "patient";
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t.sanctions_country_hint}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {flash ? <SuccessBanner>{flash}</SuccessBanner> : null}
      {leads.length === 0 && patients.length === 0 ? (
        <p className="rounded-xl border border-border/50 bg-card px-4 py-10 text-center text-sm text-muted-foreground">{t.sanctions_country_none}</p>
      ) : null}
      {leads.length > 0 ? (
        <section className="space-y-2" aria-label={t.sanctions_country_leads}>
          <AdminSectionTitle>{t.sanctions_country_leads}</AdminSectionTitle>
          <ul className="space-y-2">{leads.map(renderItem)}</ul>
        </section>
      ) : null}
      {patients.length > 0 ? (
        <section className="space-y-2" aria-label={t.sanctions_country_patients}>
          <AdminSectionTitle>{t.sanctions_country_patients}</AdminSectionTitle>
          <p className="text-xs text-muted-foreground">{t.sanctions_country_patients_hint}</p>
          <ul className="space-y-2">{patients.map(renderItem)}</ul>
        </section>
      ) : null}
      <SanctionsReasonDialog
        open={lifting !== null}
        title={liftingPatient ? t.sanctions_country_lift_patient_title : t.sanctions_country_lift_title}
        description={liftingPatient ? t.sanctions_country_lift_patient_hint : t.sanctions_country_lift_hint}
        confirmLabel={liftingPatient ? t.sanctions_country_lift_patient : t.sanctions_country_lift}
        onConfirm={async (reason) => {
          if (!lifting) return;
          if (lifting.kind === "patient") {
            await sanctionsApi.liftPatientCountryBlock(lifting.id, reason);
          } else {
            await sanctionsApi.liftLeadCountryBlock(lifting.id, reason);
          }
          setFlash(t.settings_updated);
          await load();
        }}
        onClose={() => setLifting(null)}
      >
        {lifting ? (
          // Whose block is lifted and who carries the country (QA 2026-10-12 B3-13).
          <div
            className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
            data-testid="sanctions-country-lift-subject"
          >
            <p>
              <span className="text-muted-foreground">
                {t.uiText[
                  liftingPatient ? "sanctions_country_lift_patient_label" : "sanctions_country_lift_lead_label"
                ]}
                :{" "}
              </span>
              <span className="font-semibold text-foreground">
                {lifting.number && lifting.number !== lifting.name
                  ? `${lifting.number} · ${lifting.name}`
                  : lifting.name}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t.uiText.sanctions_country_lift_subjects_label}:
            </p>
            {lifting.subjects.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-foreground">
                {lifting.subjects.map((subject) => (
                  <li key={`${subject.kind}-${subject.role ?? ""}-${subject.name}`}>
                    {countrySubjectLine(subject, t, lang)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-foreground">{countryList(lifting.found, lang)}</p>
            )}
          </div>
        ) : null}
      </SanctionsReasonDialog>
      <SanctionsReasonDialog
        open={revoking !== null}
        title={t.sanctions_country_revoke_title}
        confirmLabel={t.sanctions_country_revoke}
        destructive
        onConfirm={async (reason) => {
          if (!revoking) return;
          await sanctionsApi.revokeCountryLift(revoking.overrideId, reason);
          setFlash(t.settings_updated);
          await load();
        }}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
}

export function SanctionsPage() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "open";
  const [openCount, setOpenCount] = useState<number | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const showsHits = tab === "open" || tab === "decided";
  const updateCounts = useCallback((counts: HitsResponse["counts"]) => setOpenCount(counts.open), []);

  useEffect(() => {
    const navigation = navigationRef.current;
    const viewport = navigation?.parentElement;
    if (!navigation || !viewport) return;
    const revealActive = () => {
      const active = navigation.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || viewport.scrollWidth <= viewport.clientWidth) return;
      const item = active.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      if (item.left < frame.left || item.right > frame.right) {
        viewport.scrollLeft += item.left - frame.left - (viewport.clientWidth - item.width) / 2;
      }
    };
    revealActive();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealActive);
    observer.observe(viewport);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, [tab]);

  useEffect(() => {
    // The hit tabs report the counts with every load of their list.
    if (showsHits) return undefined;
    let cancelled = false;
    sanctionsApi
      .hits("open")
      .then((response) => {
        if (!cancelled) setOpenCount(response.counts.open);
      })
      .catch(() => {
        if (!cancelled) setOpenCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, showsHits]);

  const labels: Record<Tab, string> = {
    open: labelWithCount(t.sanctions_tab_open, openCount),
    decided: t.sanctions_tab_decided,
    countries: t.sanctions_tab_countries,
    list: t.sanctions_tab_list,
    risk: t.sanctions_tab_risk,
  };
  const icons: Record<Tab, ReactNode> = {
    open: <ShieldAlert className="size-4" aria-hidden />,
    decided: <ListChecks className="size-4" aria-hidden />,
    countries: <Globe2 className="size-4" aria-hidden />,
    list: <ShieldCheck className="size-4" aria-hidden />,
    risk: <Gauge className="size-4" aria-hidden />,
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t.nav_sanctions} actions={(
        <AdminGuideButton title={t.nav_sanctions} description={t.sanctions_page_intro} showTableToolbarGuide={false}>
          <p className="text-muted-foreground">{t.sanctions_disclaimer}</p>
        </AdminGuideButton>
      )} />
      <div className="min-w-0 overflow-x-auto overflow-y-hidden rounded-xl border border-border/60 bg-card p-1.5">
      <nav ref={navigationRef} aria-label={t.nav_sanctions} className="flex w-max min-w-full gap-1">
        {TABS.map((entry) => (
          <Button
            key={entry}
            type="button"
            size="sm"
            variant={entry === tab ? "default" : "ghost"}
            aria-current={entry === tab ? "page" : undefined}
            className="h-9 min-w-0 flex-1 rounded-lg px-3 text-xs"
            onClick={() => setParams(entry === "open" ? {} : { tab: entry }, { replace: true })}
          >
            {icons[entry]}
            {labels[entry]}
          </Button>
        ))}
      </nav>
      </div>
      <TabShell className="mt-0 min-w-0 rounded-xl border border-border/50 bg-muted p-3 sm:p-4">
      {tab === "open" ? <HitsTab status="open" onCounts={updateCounts} /> : null}
      {tab === "decided" ? <HitsTab status="decided" onCounts={updateCounts} /> : null}
      {tab === "countries" ? <CountriesTab /> : null}
      {tab === "list" ? <SanctionsListSettings /> : null}
      {tab === "risk" ? <RiskSettingsTab /> : null}
      </TabShell>
    </div>
  );
}

export default SanctionsPage;
