import { useEffect, useState } from "react";
import { Package, Tags } from "lucide-react";

import { SectionHeading } from "@/components/ui/section-heading";
import { apiFetch } from "@/lib/api";
import { useLang, type Lang } from "@/lib/i18n";
import {
  activePackages,
  agencyServiceRows,
  packageItemLine,
  type ConciergeAgencyService,
  type ConciergeServicePackage,
} from "@/pages/services-agency-catalog.model";

const copy = {
  ru: {
    title: "Услуги и пакеты GMED",
    hint: "Только для просмотра. Цены ведёт бухгалтерия.",
    services: "Услуги агентства",
    packages: "Пакеты услуг",
    loading: "Загрузка каталога GMED...",
    failed: "Не удалось загрузить каталог GMED.",
    noServices: "Активных услуг агентства нет.",
    noPackages: "Активных пакетов нет.",
    unit: "Единица",
  },
  de: {
    title: "GMED-Leistungen und -Pakete",
    hint: "Nur zur Ansicht. Preise pflegt die Buchhaltung.",
    services: "Agenturleistungen",
    packages: "Leistungspakete",
    loading: "GMED-Katalog wird geladen...",
    failed: "GMED-Katalog konnte nicht geladen werden.",
    noServices: "Keine aktiven Agenturleistungen.",
    noPackages: "Keine aktiven Pakete.",
    unit: "Einheit",
  },
} as const satisfies Record<Lang, Record<string, string>>;

/**
 * GMED's own agency services and packages for the concierge, read-only and
 * without prices (owner decision 4 of 2026-11-12). The server strips every
 * amount from the answer; this view only lists what it gets.
 */
export function AgencyCatalogReadOnly() {
  const { lang, t } = useLang();
  const text = copy[lang];
  const [services, setServices] = useState<ConciergeAgencyService[] | null>(null);
  const [packages, setPackages] = useState<ConciergeServicePackage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<ConciergeAgencyService[]>("/agency-services?active_only=true"),
      apiFetch<ConciergeServicePackage[]>("/service-packages"),
    ])
      .then(([nextServices, nextPackages]) => {
        if (cancelled) return;
        setServices(Array.isArray(nextServices) ? nextServices : []);
        setPackages(Array.isArray(nextPackages) ? nextPackages : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const serviceRows = services ? agencyServiceRows(services, t, lang) : [];
  const packageRows = packages ? activePackages(packages) : [];

  return (
    <section
      aria-label={text.title}
      data-testid="agency-catalog-read-only"
      className="space-y-3 rounded-lg border border-border/70 bg-card p-4 shadow-sm"
    >
      <div className="space-y-1">
        <SectionHeading icon={Tags}>{text.title}</SectionHeading>
        <p className="text-xs text-muted-foreground">{text.hint}</p>
      </div>

      {failed ? (
        <p className="text-sm text-rose-700">{text.failed}</p>
      ) : services === null || packages === null ? (
        <p className="text-sm text-muted-foreground">{text.loading}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">{text.services}</h3>
            {serviceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{text.noServices}</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                {serviceRows.map((row) => (
                  <li key={row.id} className="space-y-0.5 px-3 py-2">
                    <p className="break-words text-sm font-medium">{row.name}</p>
                    {row.description ? (
                      <p className="break-words text-xs text-muted-foreground">{row.description}</p>
                    ) : null}
                    {row.unit ? (
                      <p className="text-xs text-muted-foreground">
                        {text.unit}: {row.unit}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">{text.packages}</h3>
            {packageRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{text.noPackages}</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                {packageRows.map((entry) => (
                  <li key={entry.id} className="space-y-1 px-3 py-2">
                    <p className="flex items-center gap-1.5 break-words text-sm font-medium">
                      <Package aria-hidden="true" className="size-3.5 shrink-0" />
                      {entry.label}
                    </p>
                    {entry.shownDescription ? (
                      <p className="break-words text-xs text-muted-foreground">{entry.shownDescription}</p>
                    ) : null}
                    {entry.items.length > 0 ? (
                      <ul className="list-disc space-y-0.5 pl-5 text-xs">
                        {entry.items.map((item) => (
                          <li key={item.id} className="break-words">
                            {packageItemLine(item, t, lang)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
