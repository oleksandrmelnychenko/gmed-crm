/**
 * CEO card: EU sanctions list status, manual upload / refresh and the blocked
 * countries. Shown in the admin settings and on the sanctions page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCcw, ShieldCheck, Upload } from "lucide-react";

import { CitizenshipMultiSelect, normalizeCitizenships } from "@/components/ui/citizenship-multi-select";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, SuccessBanner, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { sanctionsApi, type ListStatusResponse } from "./api";
import { countryList } from "./model";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SanctionsListSettings({ className }: { className?: string }) {
  const { t, lang } = useLang();
  const [status, setStatus] = useState<ListStatusResponse | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "refresh" | "upload" | "countries">("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await sanctionsApi.listStatus();
      setStatus(next);
      setBlocked(next.blocked_countries);
    } catch (loadError) {
      setError(errorText(loadError, t.common_error));
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (kind: typeof busy, action: () => Promise<string>) => {
    setBusy(kind);
    setError("");
    setFlash("");
    try {
      setFlash(await action());
      await load();
    } catch (actionError) {
      setError(errorText(actionError, t.common_error));
    } finally {
      setBusy("");
    }
  };

  const upload = (file: File) =>
    run("upload", async () => {
      const result = await sanctionsApi.uploadList(file);
      if (result.outcome.result === "unchanged") return t.sanctions_list_unchanged;
      return formatUiText(t.sanctions_list_uploaded, {
        date: formatAppDate(result.outcome.list_date),
        entries: result.outcome.entries,
        new_hits: result.rescreen?.new_hits ?? 0,
      });
    });

  const list = status?.list;
  const active = list?.active ?? null;
  const savedBlocked = status?.blocked_countries ?? [];
  const blockedChanged =
    [...normalizeCitizenships(blocked)].sort().join(",") !== [...savedBlocked].sort().join(",");

  return (
    <section className={cn("space-y-4 rounded-xl p-4", tokens.surface.card, className)} data-testid="sanctions-list-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <AdminSectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-4" aria-hidden />
              {t.sanctions_list_title}
            </span>
          </AdminSectionTitle>
          <p className="text-xs text-muted-foreground">{t.sanctions_list_source}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {list?.automatic_download !== false ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() =>
                run("refresh", async () => {
                  await sanctionsApi.refreshList();
                  return t.sanctions_list_refresh_started;
                })
              }
            >
              {busy === "refresh" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <RefreshCcw className="size-4" aria-hidden />}
              {t.sanctions_list_refresh}
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            {busy === "upload" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {t.sanctions_list_upload}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.zip,application/xml,text/xml,application/zip"
            className="hidden"
            aria-label={t.sanctions_list_upload}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {flash ? <SuccessBanner>{flash}</SuccessBanner> : null}

      {list ? (
        <div className="space-y-1.5 text-sm">
          <p className={cn(!active && "text-amber-700")}>
            {active
              ? formatUiText(t.sanctions_list_active, {
                  date: formatAppDate(active.list_date),
                  entries: active.entry_count,
                  persons: active.person_count,
                })
              : t.sanctions_list_none}
          </p>
          {active && list.stale ? <p className="text-amber-700">{t.sanctions_list_stale}</p> : null}
          {!list.automatic_download ? <p className="text-amber-700">{t.sanctions_list_auto_off}</p> : null}
          {list.sync.last_success_at ? (
            <p className="text-xs text-muted-foreground">
              {formatUiText(t.sanctions_list_last_success, { date: formatAppDateTime(list.sync.last_success_at) })}
            </p>
          ) : null}
          {list.sync.last_error_code && list.sync.last_error_at ? (
            <p className="text-xs text-amber-700">
              {formatUiText(t.sanctions_list_last_error, {
                code: list.sync.last_error_code,
                date: formatAppDateTime(list.sync.last_error_at),
              })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t.sanctions_list_upload_hint}</p>
          {list.versions.length > 0 ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t.sanctions_list_versions}</summary>
              <ul className="mt-1.5 space-y-1">
                {list.versions.map((version) => (
                  <li key={version.id} className={cn("flex flex-wrap gap-x-3", version.is_active && "font-semibold")}>
                    <span>{formatAppDate(version.list_date)}</span>
                    <span>
                      {version.source === "upload" ? t.sanctions_list_source_upload : t.sanctions_list_source_download}
                      {version.imported_by_name ? ` · ${version.imported_by_name}` : ""}
                    </span>
                    <span>{version.entry_count}</span>
                    <span className="text-muted-foreground">{formatAppDateTime(version.created_at)}</span>
                    <span className="font-mono text-muted-foreground" title={version.sha256}>
                      {version.sha256.slice(0, 12)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border/60 pt-3">
        <AdminSectionTitle>{t.sanctions_blocked_countries}</AdminSectionTitle>
        <p className="text-xs leading-5 text-muted-foreground">{t.sanctions_blocked_countries_hint}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <CitizenshipMultiSelect
              value={blocked}
              onChange={setBlocked}
              placeholder={t.sanctions_blocked_countries_placeholder}
              disabled={busy === "countries"}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!blockedChanged || Boolean(busy)}
            onClick={() =>
              run("countries", async () => {
                await sanctionsApi.setBlockedCountries(normalizeCitizenships(blocked));
                return t.sanctions_blocked_countries_saved;
              })
            }
          >
            {busy === "countries" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t.common_save}
          </Button>
        </div>
        {savedBlocked.length > 0 ? (
          <p className="text-xs text-muted-foreground">{countryList(savedBlocked, lang)}</p>
        ) : null}
      </div>
    </section>
  );
}
