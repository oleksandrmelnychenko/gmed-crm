import { ArrowUpRight, Building2, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  providerOrganizationLevelLabel,
  providerTypeLabel,
} from "../model/list-model";
import type { ProviderDetail } from "../model/types";
import { ProviderStatusPill } from "./provider-status-pill";

type ProviderChildrenSectionProps = {
  children: ProviderDetail["children"];
  className?: string;
  onOpenProvider: (providerId: string) => void;
};

function localizedFallback(lang: "de" | "ru", de: string, ru: string) {
  return lang === "de" ? de : ru;
}

export function ProviderChildrenSection({
  children: providerChildren,
  className,
  onOpenProvider,
}: ProviderChildrenSectionProps) {
  const { lang, t } = useLang();
  const labels = t as unknown as Record<string, string>;
  const title = t.uiText.providers_children ?? localizedFallback(lang, "Untereinheiten", "Дочерние подразделения");
  const emptyTitle = t.uiText.providers_children_empty ?? localizedFallback(lang, "Keine untergeordneten Provider", "Нет дочерних провайдеров");
  const emptyText =
    t.uiText.providers_children_empty_description ??
    localizedFallback(
      lang,
      "Dieser Provider hat noch keine verknüpften Kliniken, Abteilungen oder Einheiten.",
      "У этого провайдера пока нет связанных клиник, отделений или подразделений.",
    );
  const providerLabel = t.providers_title ?? localizedFallback(lang, "Provider", "Провайдеры");
  const openLabel = t.uiText.providers_open_provider ?? localizedFallback(lang, "Provider öffnen", "Открыть провайдера");

  return (
    <section className={cn("space-y-2.5 rounded-xl border border-border/70 bg-card p-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {providerChildren.length}
          </span>
        </div>
      </div>

      {providerChildren.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-5 py-6">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {providerChildren.map((child) => {
            const location = [child.address_city, child.address_country].filter(Boolean).join(", ");

            return (
              <button
                key={child.id}
                type="button"
                aria-label={`${openLabel}: ${child.name}`}
                className="group flex min-h-32 flex-col justify-between rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-colors hover:border-primary/35 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                onClick={() => onOpenProvider(child.id)}
              >
                <span className="flex min-w-0 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                    <Building2 className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block min-w-0 max-w-full truncate text-sm font-semibold text-foreground" title={child.name}>
                      {child.name}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge
                        variant="outline"
                        className="rounded-full border-border bg-muted/30 text-[10px] text-muted-foreground"
                      >
                        {providerOrganizationLevelLabel(child.organization_level)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px]",
                          child.provider_type === "medical"
                            ? "border-sky-200 bg-sky-50 text-sky-700"
                            : "border-violet-200 bg-violet-50 text-violet-700",
                        )}
                      >
                        {providerTypeLabel(child.provider_type, labels)}
                      </Badge>
                      <ProviderStatusPill active={child.is_active} labels={labels} />
                    </span>
                  </span>
                </span>
                <span className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="min-w-0 max-w-full break-words">{location || t.common_not_set}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    title={openLabel}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:text-foreground"
                  >
                    <ArrowUpRight className="size-4" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {providerChildren.length} {providerLabel.toLocaleLowerCase()}
      </p>
    </section>
  );
}
