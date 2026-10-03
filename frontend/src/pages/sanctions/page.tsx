/**
 * CEO review of possible EU sanctions list matches (/sanctions): side-by-side
 * comparison, decisions with a reason, manual FiSaLis check, country blocks
 * and the list itself. See docs/architecture/sanctions-screening_ua.md.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, Globe2, ListChecks, Search, ShieldAlert, ShieldCheck } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner, PageHeader, StatusBadge, SuccessBanner, TabLoader, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { copyText, selectElementText } from "@/lib/copy-text";
import { formatUiText, useLang, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  sanctionsApi,
  type CountryBlocksResponse,
  type HitStatus,
  type SanctionsHit,
  type SubjectData,
} from "./api";
import { SanctionsReasonDialog } from "./components";
import { SanctionsListSettings } from "./list-settings";
import {
  FISALIS_URL,
  countryList,
  fisalisSearchText,
  formatListBirthDate,
  hitStatusLabel,
  listEntryNames,
  regulationLabel,
  safeLegalActUrl,
  scorePercent,
  subjectChanged,
  subjectKindLabel,
} from "./model";

type Tab = "open" | "decided" | "countries" | "list";
const TABS: Tab[] = ["open", "decided", "countries", "list"];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children || "—"}</dd>
    </div>
  );
}

function SubjectDetails({ subject, t, lang }: { subject: SubjectData; t: Translations; lang: "ru" | "de" }) {
  return (
    <dl className="space-y-2">
      <Row label={subject.organisation ? t.sanctions_field_entity : t.sanctions_field_names}>
        {fisalisSearchText(subject)}
      </Row>
      <Row label={t.sanctions_field_dob}>{subject.date_of_birth ? formatAppDate(subject.date_of_birth) : ""}</Row>
      <Row label={t.sanctions_field_citizenships}>{countryList(subject.citizenships, lang)}</Row>
      {subject.residence && subject.residence.length > 0 ? (
        <Row label={t.sanctions_field_residence}>{countryList(subject.residence, lang)}</Row>
      ) : null}
      {subject.relation && subject.relation !== "payer" ? (
        <Row label={t.sanctions_field_relation}>{subject.relation}</Row>
      ) : null}
    </dl>
  );
}

function HitCard({
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
  const name = fisalisSearchText(subject);

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
      className={cn("space-y-4 rounded-xl p-4", tokens.surface.card)}
      data-testid="sanctions-hit"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={hit.status === "confirmed" ? "error" : hit.status === "open" ? "warning" : "neutral"}>
              {hitStatusLabel(hit.status, t)}
            </StatusBadge>
            <span className="text-sm font-semibold">{subjectKindLabel(hit.subject_kind, t)}</span>
            {hit.owner_name ? <span className="text-sm text-muted-foreground">· {hit.owner_name}</span> : null}
            {hit.patient_number ? <span className="font-mono text-xs text-muted-foreground">{hit.patient_number}</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn("space-y-3 rounded-lg p-3", tokens.surface.mutedCard)}>
          <h3 className="text-sm font-semibold">{t.sanctions_our_person}</h3>
          <SubjectDetails subject={subject} t={t} lang={lang} />
          {changed ? (
            <div className="space-y-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              <p>{t.sanctions_snapshot_differs}</p>
              <SubjectDetails subject={hit.subject_snapshot} t={t} lang={lang} />
            </div>
          ) : null}
        </section>
        <section className={cn("space-y-3 rounded-lg p-3", tokens.surface.mutedCard)}>
          <h3 className="text-sm font-semibold">
            {t.sanctions_list_entry}
            {entry.subject_type === "entity" ? ` · ${t.sanctions_field_entity}` : ""}
          </h3>
          <dl className="space-y-2">
            <Row label={t.sanctions_field_names}>
              <ul className="space-y-0.5">
                {listEntryNames(entry).map((listName) => (
                  <li key={listName}>{listName}</li>
                ))}
              </ul>
            </Row>
            <Row label={t.sanctions_field_dob}>
              {entry.birth_dates.map((birth) => formatListBirthDate(birth, t)).filter(Boolean).join("; ")}
              {hit.match_details.dob ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({
                    {
                      exact: t.sanctions_dob_exact,
                      year: t.sanctions_dob_year,
                      conflict: t.sanctions_dob_conflict,
                      unknown: t.sanctions_dob_unknown,
                    }[hit.match_details.dob]
                  })
                </span>
              ) : null}
            </Row>
            <Row label={t.sanctions_field_citizenships}>{countryList(entry.citizenships, lang)}</Row>
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
            <Button type="button" variant="outline" onClick={() => setDecision("false_positive")}>
              <ShieldCheck className="size-4" aria-hidden />
              {t.sanctions_button_false_positive}
            </Button>
            <Button type="button" variant="destructive" onClick={() => setDecision("confirmed")}>
              <ShieldAlert className="size-4" aria-hidden />
              {t.sanctions_button_confirm}
            </Button>
            <Button type="button" variant="ghost" onClick={openFisalis}>
              <Search className="size-4" aria-hidden />
              {t.sanctions_button_fisalis}
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
          </div>
          {fisalisNote ? (
            <p className="text-xs text-muted-foreground" role="status">
              {fisalisNote.ok ? t.sanctions_fisalis_copied : t.sanctions_fisalis_copy_failed}
              <span ref={nameRef} className="ml-1 rounded bg-muted px-1 font-mono text-foreground">
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

function HitsTab({ status }: { status: HitStatus | "decided" }) {
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
      } else {
        setHits((await sanctionsApi.hits(status)).hits);
      }
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
      setHits([]);
    }
  }, [status, t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hits === null) return <TabLoader />;
  return (
    <div className="space-y-3">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {hits.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.sanctions_no_hits}</p>
      ) : (
        hits.map((hit) => <HitCard key={hit.id} hit={hit} onDecided={() => void load()} />)
      )}
    </div>
  );
}

function CountriesTab() {
  const { t, lang } = useLang();
  const [data, setData] = useState<CountryBlocksResponse | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [lifting, setLifting] = useState<{ leadId: string } | null>(null);
  const [revoking, setRevoking] = useState<{ overrideId: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await sanctionsApi.countryBlocks());
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
      setData({ leads: [] });
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <TabLoader />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t.sanctions_country_hint}</p>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {flash ? <SuccessBanner>{flash}</SuccessBanner> : null}
      {data.leads.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.sanctions_country_none}</p>
      ) : (
        <ul className="space-y-2">
          {data.leads.map((item) => (
            <li key={item.lead_id} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg p-3", tokens.surface.card)}>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={item.flag === "blocked_country" ? "warning" : "neutral"}>
                    {item.flag === "blocked_country" ? t.sanctions_badge_blocked_country : t.sanctions_badge_country_lifted}
                  </StatusBadge>
                  <StaffLink to={`/leads?lead=${item.lead_id}`} className="text-sm font-semibold hover:underline">
                    {item.name ?? item.lead_id}
                  </StaffLink>
                  <span className="text-sm text-muted-foreground">{countryList(item.found, lang)}</span>
                </div>
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
                <Button type="button" size="sm" variant="outline" onClick={() => setLifting({ leadId: item.lead_id })}>
                  {t.sanctions_country_lift}
                </Button>
              ) : item.lift ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setRevoking({ overrideId: item.lift!.id })}>
                  {t.sanctions_country_revoke}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <SanctionsReasonDialog
        open={lifting !== null}
        title={t.sanctions_country_lift_title}
        description={t.sanctions_country_lift_hint}
        confirmLabel={t.sanctions_country_lift}
        onConfirm={async (reason) => {
          if (!lifting) return;
          await sanctionsApi.liftLeadCountryBlock(lifting.leadId, reason);
          setFlash(t.settings_updated);
          await load();
        }}
        onClose={() => setLifting(null)}
      />
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

  useEffect(() => {
    sanctionsApi
      .hits("open")
      .then((response) => setOpenCount(response.counts.open))
      .catch(() => setOpenCount(null));
  }, [tab]);

  const labels: Record<Tab, string> = {
    open: openCount ? `${t.sanctions_tab_open} (${openCount})` : t.sanctions_tab_open,
    decided: t.sanctions_tab_decided,
    countries: t.sanctions_tab_countries,
    list: t.sanctions_tab_list,
  };
  const icons: Record<Tab, ReactNode> = {
    open: <ShieldAlert className="size-4" aria-hidden />,
    decided: <ListChecks className="size-4" aria-hidden />,
    countries: <Globe2 className="size-4" aria-hidden />,
    list: <ShieldCheck className="size-4" aria-hidden />,
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t.nav_sanctions} description={t.sanctions_page_intro} />
      <Banner tone="warning" withIcon>
        {t.sanctions_disclaimer}
      </Banner>
      <nav aria-label={t.nav_sanctions} className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <Button
            key={entry}
            type="button"
            size="sm"
            variant={entry === tab ? "default" : "ghost"}
            aria-current={entry === tab ? "page" : undefined}
            className="h-9 rounded-md px-3 text-xs sm:h-8"
            onClick={() => setParams(entry === "open" ? {} : { tab: entry }, { replace: true })}
          >
            {icons[entry]}
            {labels[entry]}
          </Button>
        ))}
      </nav>
      {tab === "open" ? <HitsTab status="open" /> : null}
      {tab === "decided" ? <HitsTab status="decided" /> : null}
      {tab === "countries" ? <CountriesTab /> : null}
      {tab === "list" ? <SanctionsListSettings /> : null}
    </div>
  );
}

export default SanctionsPage;
