import { useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { DatevReadResult } from "./read-result";
import { DatevActionButton } from "./action-button";
import { fetchDatevSetup, type DatevProfile } from "./setup-api";
import { fiscalYear } from "./live-validation";
import { operationDescription } from "./operation-text";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ApiRequestError } from "@/lib/api";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { DatevSetupSection } from "./setup-section";
import { useDatevText } from "./text";
import { authorizeDatev, checkDatev, disconnectDatev, loadConnection, loadDatevEvents, readDatev, safeAuthorizationUrl, saveCredentials, type AccessCheck, type Connection, type Credentials, type ReadEvent, type ReadKind, type ReadResult } from "./live-api";
import { liveDe, liveError, liveRu } from "./live-text";

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

export function DatevLiveConnection() {
  const { canStaffPath } = useStaffNavigate();
  const { lang } = useDatevText(); const de = lang === "de"; const t = de ? liveDe : liveRu;
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<DatevProfile | null>(null);
  const [profileRevision, setProfileRevision] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [reconnectFor, setReconnectFor] = useState<string | null>(null);
  const epoch = useRef(0); const mounted = useRef(true); const hydrated = useRef<string | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const tokenVersion = `${connection?.revision}:${connection?.expires_at}`;
  const requiresReconnect = reconnectFor === tokenVersion;
  const [events, setEvents] = useState<ReadEvent[]>([]);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [kind, setKind] = useState<ReadKind>("fiscal-years"); const [year, setYear] = useState("");
  const [credentials, setCredentials] = useState<Credentials>({ client_id: "", client_secret: "", mode: "sandbox", redirect_uri: `${window.location.origin}/api/v1/datev/oauth/callback`, exchange_enabled: false });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const changed = () => { epoch.current += 1; setReady(false); setAccess(null); setResult(null); setReload((n) => n + 1); };
    window.addEventListener("gmed-datev-profile-saved", changed);
    return () => window.removeEventListener("gmed-datev-profile-saved", changed);
  }, []);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    Promise.all([loadConnection(), fetchDatevSetup()]).then(([value, setup]) => {
      if (!active) return;
      if (!setup?.profile || typeof setup.profile.company_name !== "string") throw new Error("invalid-profile");
      setConnection(value); setProfile(setup.profile); setProfileRevision(setup.revision); setReady(true);
      const revision = value.revision ?? "unconfigured";
      if (hydrated.current !== revision) {
        hydrated.current = revision; setReconnectFor(null);
        setCredentials((old) => ({ ...old, mode: value.mode ?? old.mode, redirect_uri: value.redirect_uri ?? old.redirect_uri, exchange_enabled: value.exchange_enabled ?? false }));
      }
    }).catch((cause: unknown) => { if (active) { setReady(false); setConnection(null); setProfile(null); setAccess(null); setResult(null); setError(liveError(cause instanceof ApiRequestError ? cause.code : undefined, de)); } });
    loadDatevEvents().then((value) => { if (active) { setEvents(value); setHistoryError(false); } }).catch(() => { if (active) { setEvents([]); setHistoryError(true); } });
    return () => { active = false; mounted.current = false; };
  }, [reload, de]);
  const [callbackResult, setCallbackResult] = useState(() => new URLSearchParams(window.location.search).get("datev_result"));
  useEffect(() => {
    if (!callbackResult) return;
    const url = new URL(window.location.href); url.searchParams.delete("datev_result");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [callbackResult]);
  async function run(action: (current: () => boolean) => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setReady(false); setCallbackResult(null); setError(""); setNotice("");
    const started = epoch.current;
    try { await action(() => mounted.current && started === epoch.current); }
    catch (cause) {
      setAccess(null); setResult(null);
      if (cause instanceof ApiRequestError && cause.code === "datev_reconnect_required") setReconnectFor(tokenVersion);
      setError(liveError(cause instanceof ApiRequestError ? cause.code : undefined, de));
    } finally { lock.current = false; if (mounted.current) { setBusy(false); setReady(false); setReload((n) => n + 1); } }
  }
  function clearRead() { setAccess(null); setResult(null); }
  const stateLabels: Record<string,string> = { not_configured: t.notConfigured, disconnected: t.disconnected, connected: t.connected, reconnect_required: t.reconnect, revocation_pending: t.revoking };
  const kinds: Record<ReadKind,string> = { "fiscal-years": t.fiscal, "terms-of-payment": t.terms, "sums-and-balances": t.balances };
  const date = (value?: string | null) => value ? new Date(value).toLocaleString(de ? "de-DE" : "ru-RU") : t.never;
  const blocked = busy || !ready;
  const hasCompany = !!profileRevision && !!profile && /^\d{1,7}$/.test(profile.consultant_number) && Number(profile.consultant_number) > 0 && /^\d{1,5}$/.test(profile.client_number) && Number(profile.client_number) > 0;
  const canRead = !blocked && !requiresReconnect && hasCompany && connection?.status === "connected" && connection.exchange_enabled;
  const identity = `${connection?.revision}:${connection?.generation}:${connection?.status}:${profileRevision}:${profile?.consultant_number}:${profile?.client_number}:${reload}`;
  const keysBlocked = blocked || !!connection?.has_tokens || connection?.status === "revocation_pending";
  function connectionTarget() {
    if (!ready || !connection?.revision || !connection.generation || !connection.mode) throw new ApiRequestError("DATEV confirmation required", { code: "datev_confirmation_required" });
    return { revision: connection.revision, generation: connection.generation, mode: connection.mode };
  }
  const connectionContext = <><p>{connection?.mode === "production" ? "Production" : connection?.mode === "sandbox" ? "Sandbox" : "—"}</p><p className="break-all">{connection?.redirect_uri}</p><p>{t.connectionScope}</p></>;
  function confirmedTarget() {
    if (!ready || !hasCompany || !profileRevision || !connection?.revision || !connection.generation || !connection.mode) throw new ApiRequestError("DATEV confirmation required", { code: "datev_confirmation_required" });
    return { revision: connection.revision, generation: connection.generation, mode: connection.mode, profile_revision: profileRevision, consultant_number: Number(profile?.consultant_number), client_number: Number(profile?.client_number) };
  }
  const context = <><p className="font-medium">{profile?.company_name || t.companyMissing}</p><p>{connection?.mode === "production" ? "Production" : connection?.mode === "sandbox" ? "Sandbox" : "—"} · Beraternummer: {profile?.consultant_number || "—"} · Mandantennummer: {profile?.client_number || "—"}</p></>;
  const describe = (operation: Parameters<typeof operationDescription>[0]) => operationDescription(operation, de);
  function matchesCompany(value: { mode: string; consultant_number: number; client_number: number }) {
    if (value.mode !== connection?.mode || value.consultant_number !== Number(profile?.consultant_number) || value.client_number !== Number(profile?.client_number)) throw new ApiRequestError("DATEV company mismatch", { code: "datev_client_mismatch" });
  }
  return <div className="min-w-0 space-y-3" data-testid="datev-live-connection">
    <DatevSetupSection title={t.title} description={t.hint} action={<Badge variant="outline">{!ready ? error ? t.unavailable : t.loading : requiresReconnect ? t.reconnect : stateLabels[connection?.status ?? "not_configured"] ?? t.reconnect}</Badge>}>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {callbackResult && ready ? <p className="text-sm">{callbackResult === "connected" && connection?.status === "connected" ? t.callbackOk : t.callbackFailed}</p> : null}
      {!connection && !error ? <p role="status" className="text-sm">{t.loading}</p> : null}
      <div className="flex flex-wrap gap-2">
        {connection?.configured ? <Badge variant="secondary">{connection.mode === "production" ? "Production" : "Sandbox"}</Badge> : null}
        <DatevActionButton title={t.connect} description={describe("connect")} context={connectionContext} contextKey={identity} size="sm" disabled={blocked || !connection?.configured || connection.has_tokens || connection.status === "revocation_pending"} onConfirm={() => run(async (current) => { const response = await authorizeDatev(connectionTarget()); if (current()) window.location.assign(safeAuthorizationUrl(response.authorization_url)); })}><Link2 className="size-4" />{t.connect}</DatevActionButton>
        <DatevActionButton title={t.check} description={describe("check")} context={context} contextKey={identity} size="sm" disabled={blocked || requiresReconnect || !hasCompany || connection?.status !== "connected"} onConfirm={() => run(async (current) => { clearRead(); const value = await checkDatev(confirmedTarget()); value.clients.forEach((client) => matchesCompany({ ...client, mode: value.mode })); if (current()) setAccess(value); })}>{t.check}</DatevActionButton>
        <DatevActionButton title={t.disconnect} description={describe("disconnect")} context={connectionContext} contextKey={identity} size="sm" disabled={blocked || !connection?.configured || connection.status === "disconnected"} onConfirm={() => run(async () => { clearRead(); setConnection(await disconnectDatev(connectionTarget())); })}><Unplug className="size-4" />{t.disconnect}</DatevActionButton>
        <DatevActionButton title={t.refresh} description={describe("refresh")} size="sm" disabled={busy} onConfirm={() => { clearRead(); setError(""); setReady(false); epoch.current += 1; setReload((n) => n + 1); }}><RefreshCw className="size-4" />{t.refresh}</DatevActionButton>
      </div>
      {busy ? <p role="status" className="text-sm text-muted-foreground">{t.busy}</p> : null}
      <p className="text-xs text-muted-foreground">{t.numbersHint}</p><div className="text-xs text-muted-foreground">{context}</div>
      {connection?.configured ? <dl className="grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">{t.checked}</dt><dd>{date(connection.checked_at)}{connection.checked_at && connection.checked_consultant ? ` · ${connection.checked_consultant} / ${connection.checked_client}` : ""}</dd></div><div><dt className="text-muted-foreground">{t.expires}</dt><dd>{date(connection.expires_at)}</dd></div></dl> : null}
      <DatevActionButton title={t.revokeLink} description={describe("portal")} size="sm" onConfirm={() => { window.open("https://apps.datev.de/tokrevui", "_blank", "noopener,noreferrer"); }}>{t.revokeLink}</DatevActionButton>
      <details className="rounded-md border p-3" open={!connection?.configured}>
        <summary className="cursor-pointer text-sm font-medium">{t.settings}</summary>
        <form className="mt-3 space-y-3" autoComplete="off" onSubmit={(e) => { e.preventDefault(); e.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(); }}>
          <fieldset disabled={keysBlocked} className="grid min-w-0 gap-3 sm:grid-cols-2 disabled:opacity-60">
            <label className="space-y-1 text-xs">{t.mode}<select className={selectClass} value={credentials.mode} onChange={(e) => setCredentials((c) => ({ ...c, mode: e.target.value as Credentials["mode"] }))}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
            <label className="space-y-1 text-xs">{t.id}<Input required autoComplete="off" maxLength={256} value={credentials.client_id} onChange={(e) => setCredentials((c) => ({ ...c, client_id: e.target.value }))} /></label>
            <label className="space-y-1 text-xs">{t.secret}<Input required type="password" autoComplete="new-password" maxLength={256} value={credentials.client_secret} onChange={(e) => setCredentials((c) => ({ ...c, client_secret: e.target.value }))} /></label>
            <label className="space-y-1 text-xs">{t.redirect}<Input required type="url" value={credentials.redirect_uri} onChange={(e) => setCredentials((c) => ({ ...c, redirect_uri: e.target.value }))} /></label>
            <label className="flex items-start gap-2 text-xs sm:col-span-2"><input type="checkbox" className="mt-0.5 accent-primary" checked={credentials.exchange_enabled} onChange={(e) => setCredentials((c) => ({ ...c, exchange_enabled: e.target.checked }))} />{t.exchange}</label>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{t.keyHint} {t.exchangeHint}</p>
            <DatevActionButton type="submit" size="sm" className="justify-self-start" title={t.save} description={describe("save")} context={<><p>{credentials.mode === "production" ? "Production" : "Sandbox"}</p><p className="break-all">{credentials.redirect_uri}</p></>} contextKey={`${identity}:${credentials.mode}:${credentials.redirect_uri}:${credentials.exchange_enabled}`} disabled={keysBlocked || !credentials.client_id.trim() || !credentials.client_secret.trim()} onConfirm={() => run(async () => {
              clearRead(); const saved = await saveCredentials({ ...credentials }, connection?.configured ? connection.revision : undefined, connection?.configured ? connection.generation : undefined);
              setConnection(saved); setCredentials((old) => ({ ...old, client_id: "", client_secret: "" })); setNotice(t.saved);
            })}>{t.save}</DatevActionButton>
          </fieldset>
        </form>
      </details>
      {access ? <section className="space-y-2 rounded-md border p-3" aria-label={t.services}>
        <h3 className="text-sm font-medium">{t.services}</h3><p className="text-xs text-muted-foreground">{t.servicesHint}</p>
        {access.clients.map((company) => <div key={company.id} className="space-y-2"><p className="text-sm font-medium">{company.name}</p><p className="text-xs">Beraternummer: {company.consultant_number} · Mandantennummer: {company.client_number}</p><ul className="space-y-1 text-sm">{company.services.map((service, index) => <li key={`${service.name}-${index}`}>{service.name}</li>)}</ul>{company.services.length === 0 ? <p className="text-sm">{t.noServices}</p> : null}</div>)}
      </section> : null}
    </DatevSetupSection>
    {canStaffPath("/invoices") ? <DatevSetupSection title={t.readTitle} description={t.readHint}>
      <p className="text-xs leading-5 text-muted-foreground">{t.originals}</p>
      <div className="grid items-end gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">{t.kind}<select aria-label={t.kind} className={selectClass} disabled={busy} value={kind} onChange={(e) => { setKind(e.target.value as ReadKind); setResult(null); }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {kind !== "fiscal-years" ? <label className="space-y-1 text-xs">{t.year}<Input aria-label={t.year} type="date" min="1992-01-01" max="2099-12-31" value={year} disabled={busy} onChange={(e) => { setYear(e.target.value); setResult(null); }} /></label> : <div />}
        <DatevActionButton title={t.read} description={describe("read")} context={<>{context}<p className="mt-2 font-medium">{kinds[kind]}{kind !== "fiscal-years" ? ` · ${year}` : ""}</p></>} contextKey={`${identity}:${kind}:${year}`} disabled={!canRead || (kind !== "fiscal-years" && !fiscalYear(year))} onConfirm={() => run(async (current) => { setResult(null); const value = await readDatev(confirmedTarget(), kind, kind === "fiscal-years" ? undefined : fiscalYear(year)); matchesCompany(value); if (current()) setResult(value); })}>{t.read}</DatevActionButton>
      </div>
      {kind !== "fiscal-years" ? <p className="text-xs text-muted-foreground">{t.yearHint}</p> : null}
      {!hasCompany ? <p className="text-xs text-muted-foreground">{t.companyMissing}</p> : !connection?.exchange_enabled ? <p className="text-xs text-muted-foreground">{t.exchangeMissing}</p> : null}
      <div className="rounded-md border bg-muted/20 p-3 text-xs leading-5">{t.unavailableOperations}</div>
      {result ? <DatevReadResult key={result.retrieved_at} result={result} disabled={blocked} de={de} /> : null}
    </DatevSetupSection>
    : null}
    <DatevSetupSection title={t.history}>
      {historyError ? <p role="alert" className="text-sm text-destructive">{t.historyError}</p> : events.length === 0 ? <p className="text-xs text-muted-foreground">{t.noHistory}</p> : <ul className="space-y-2">{events.map((item, index) => <li key={`${item.created_at}-${index}`} className="flex flex-wrap justify-between gap-2 border-b border-border/50 pb-2 text-xs"><span>{date(item.created_at)} · {kinds[item.operation as ReadKind] ?? ({ configure: t.save, authorize: t.connect, check: t.check, disconnect: t.disconnect }[item.operation] ?? item.operation)}</span><span>{["success", "saved", "connected", "disconnected"].includes(item.outcome) ? t.success : item.outcome === "started" ? t.started : `${t.failed}: ${liveError(item.outcome, de)}`}{item.record_count ? ` · ${item.record_count}` : ""}</span></li>)}</ul>}
    </DatevSetupSection>
  </div>;
}
