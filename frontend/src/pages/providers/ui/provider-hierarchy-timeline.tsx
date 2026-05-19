import { Fragment, useMemo, useState } from "react";
import { Building2, ChevronRight, MapPin, Stethoscope, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { providerTypeLabel } from "../model/list-model";
import { specializationLabelForItem, specializationLabelForValue } from "../model/specialization-labels";
import type { ProviderOrganizationLevel, ProviderSummary, SpecializationItem } from "../model/types";

export type ProviderTimelineNode = {
  children: ProviderTimelineNode[];
  provider: ProviderSummary;
};

type ProviderTimelineVisualNode = {
  ancestorHasNext: boolean[];
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  node: ProviderTimelineNode;
};

type FlattenProviderTimelineOptions = {
  collapsedRootIds?: ReadonlySet<string>;
};

const LEVEL_ORDER: Record<ProviderOrganizationLevel, number> = {
  organization: 0,
  clinic: 1,
  department: 2,
  unit: 3,
};
const CONNECTOR_STEP = 34;
const CONNECTOR_CENTER = 14;
const LEVEL_BY_DEPTH: ProviderOrganizationLevel[] = ["organization", "clinic", "department", "unit"];

function levelLabel(level: ProviderOrganizationLevel, tr: Record<string, string>) {
  switch (level) {
    case "organization":
      return tr.providers_level_organization ?? level;
    case "clinic":
      return tr.providers_level_clinic ?? level;
    case "department":
      return tr.providers_level_department ?? level;
    case "unit":
      return tr.providers_level_unit ?? level;
    default:
      return level;
  }
}

function levelTone(level: ProviderOrganizationLevel) {
  switch (level) {
    case "organization":
      return {
        badge: "border-slate-200 bg-slate-50 text-slate-700",
        dot: "border-slate-200 bg-slate-50 text-slate-700",
        rail: "bg-slate-200",
      };
    case "clinic":
      return {
        badge: "border-sky-200 bg-sky-50 text-sky-700",
        dot: "border-sky-200 bg-sky-50 text-sky-700",
        rail: "bg-sky-200",
      };
    case "department":
      return {
        badge: "border-amber-200 bg-amber-50 text-amber-700",
        dot: "border-amber-200 bg-amber-50 text-amber-700",
        rail: "bg-amber-200",
      };
    case "unit":
      return {
        badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
        dot: "border-emerald-200 bg-emerald-50 text-emerald-700",
        rail: "bg-emerald-200",
      };
    default:
      return {
        badge: "border-border bg-muted text-muted-foreground",
        dot: "border-border bg-muted text-muted-foreground",
        rail: "bg-border",
      };
  }
}

function ProviderLevelIcon({
  className,
  level,
}: {
  className?: string;
  level: ProviderOrganizationLevel;
}) {
  switch (level) {
    case "organization":
      return <Building2 className={className} />;
    case "clinic":
      return <Stethoscope className={className} />;
    case "department":
      return <UsersRound className={className} />;
    case "unit":
      return <MapPin className={className} />;
    default:
      return <Building2 className={className} />;
  }
}

function railClassForDepth(depth: number) {
  const level = LEVEL_BY_DEPTH[depth] ?? "unit";
  return levelTone(level).rail;
}

function specializationLabel(item: SpecializationItem, lang: Lang) {
  return specializationLabelForItem(item, lang);
}

function providerSpecializationText(provider: ProviderSummary, lang: Lang) {
  const seen = new Set<string>();
  const labels = provider.specializations.flatMap((item) => {
    const label = specializationLabel(item, lang).trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
  if (labels.length > 0) return labels.join(", ");
  return provider.fachbereich
    ? specializationLabelForValue(provider.fachbereich, provider.specializations, lang)
    : "";
}

function contractLabel(provider: ProviderSummary, tr: Record<string, string>) {
  return provider.has_contract
    ? (tr.providers_contract_with ?? tr.providers_contract ?? "")
    : (tr.providers_contract_without ?? tr.providers_contract ?? "");
}

function contractTone(provider: ProviderSummary) {
  return provider.has_contract
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-neutral-200 bg-neutral-50 text-neutral-600";
}

function providerTypeTone(provider: ProviderSummary) {
  return provider.provider_type === "medical"
    ? "border-sky-200 bg-sky-50 text-sky-700"
    : "border-violet-200 bg-violet-50 text-violet-700";
}

function ProviderStatusBadge({
  active,
  tr,
}: {
  active: boolean;
  tr: Record<string, string>;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
        active ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600",
      )}
    >
      <span className={cn("size-1.5 rounded-full", active ? "bg-emerald-500" : "bg-neutral-400")} />
      {active ? (tr.common_active ?? "active") : (tr.common_inactive ?? "inactive")}
    </span>
  );
}

function compareProviders(a: ProviderSummary, b: ProviderSummary) {
  const levelCmp = LEVEL_ORDER[a.organization_level] - LEVEL_ORDER[b.organization_level];
  if (levelCmp !== 0) return levelCmp;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function sortNodes(nodes: ProviderTimelineNode[]) {
  nodes.sort((a, b) => compareProviders(a.provider, b.provider));
  for (const node of nodes) {
    sortNodes(node.children);
  }
  return nodes;
}

function cloneWithoutCycles(
  node: ProviderTimelineNode,
  ancestors: ReadonlySet<string>,
): ProviderTimelineNode {
  if (ancestors.has(node.provider.id)) {
    return { provider: node.provider, children: [] };
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(node.provider.id);
  return {
    provider: node.provider,
    children: node.children.map((child) => cloneWithoutCycles(child, nextAncestors)),
  };
}

export function buildProviderTimelineTree(
  providers: readonly ProviderSummary[],
): ProviderTimelineNode[] {
  const nodesById = new Map<string, ProviderTimelineNode>();
  const roots: ProviderTimelineNode[] = [];

  for (const provider of providers) {
    nodesById.set(provider.id, { provider, children: [] });
  }

  for (const provider of providers) {
    const node = nodesById.get(provider.id);
    if (!node) continue;

    const parent =
      provider.parent_provider_id && provider.parent_provider_id !== provider.id
        ? nodesById.get(provider.parent_provider_id)
        : null;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const attachedIds = new Set<string>();
  const collect = (node: ProviderTimelineNode) => {
    if (attachedIds.has(node.provider.id)) return;
    attachedIds.add(node.provider.id);
    node.children.forEach(collect);
  };
  roots.forEach(collect);

  for (const provider of providers) {
    if (!attachedIds.has(provider.id)) {
      const node = nodesById.get(provider.id);
      if (node) roots.push(node);
    }
  }

  return sortNodes(roots.map((node) => cloneWithoutCycles(node, new Set())));
}

const EMPTY_COLLAPSED_ROOT_IDS = new Set<string>();

export function flattenProviderTimelineTree(
  nodes: readonly ProviderTimelineNode[],
  options: FlattenProviderTimelineOptions = {},
  depth = 0,
  ancestorHasNext: boolean[] = [],
): ProviderTimelineVisualNode[] {
  const collapsedRootIds = options.collapsedRootIds ?? EMPTY_COLLAPSED_ROOT_IDS;

  return nodes.flatMap((node, index) => {
    const isLast = index === nodes.length - 1;
    const isCollapsedRoot = depth === 0 && collapsedRootIds.has(node.provider.id);
    return [
      {
        ancestorHasNext,
        depth,
        isFirst: index === 0,
        isLast,
        node,
      },
      ...(isCollapsedRoot
        ? []
        : flattenProviderTimelineTree(
            node.children,
            options,
            depth + 1,
            [...ancestorHasNext, !isLast],
          )),
    ];
  });
}

type ProviderHierarchyTimelineProps = {
  lang: Lang;
  onProviderClick: (providerId: string) => void;
  providers: readonly ProviderSummary[];
  selectedProviderId?: string | null;
  tr: Record<string, string>;
};

export function ProviderHierarchyTimeline({
  lang,
  onProviderClick,
  providers,
  selectedProviderId,
  tr,
}: ProviderHierarchyTimelineProps) {
  const [collapsedRootIds, setCollapsedRootIds] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildProviderTimelineTree(providers), [providers]);
  const timelineItems = useMemo(
    () => flattenProviderTimelineTree(tree, { collapsedRootIds }),
    [collapsedRootIds, tree],
  );
  const toggleRootCollapsed = (providerId: string) => {
    setCollapsedRootIds((current) => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };
  const organizationDividerIds = useMemo(() => {
    const ids = new Set<string>();
    let hasRootOrganization = false;

    for (const item of timelineItems) {
      if (item.depth !== 0 || item.node.provider.organization_level !== "organization") {
        continue;
      }

      if (hasRootOrganization) {
        ids.add(item.node.provider.id);
      }
      hasRootOrganization = true;
    }

    return ids;
  }, [timelineItems]);
  const childCount = providers.filter((provider) => provider.parent_provider_id).length;

  if (providers.length === 0) return null;

  return (
    <section
      data-testid="provider-hierarchy-timeline"
      className="rounded-lg border border-border/70 bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {tr.providers_hierarchy_timeline_title ?? tr.providers_children ?? tr.providers_title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{providers.length}</span>
            <span>{tr.providers_title?.toLowerCase() ?? "providers"}</span>
            <span className="text-border">/</span>
            <span className="tabular-nums">{childCount}</span>
            <span>{tr.providers_children?.toLowerCase() ?? "children"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["organization", "clinic", "department", "unit"] as const).map((level) => (
            <Badge
              key={level}
              variant="outline"
              className={cn("rounded-full text-[10px]", levelTone(level).badge)}
            >
              {levelLabel(level, tr)}
            </Badge>
          ))}
        </div>
      </div>
      {tree.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {tr.providers_hierarchy_timeline_empty ?? tr.common_no_results}
        </div>
      ) : (
        <div className="p-4">
          <div className="space-y-2">
            {timelineItems.map((item) => (
              <Fragment key={item.node.provider.id}>
                {organizationDividerIds.has(item.node.provider.id) ? <OrganizationDivider /> : null}
                <TimelineNode
                  item={item}
                  isCollapsed={item.depth === 0 && collapsedRootIds.has(item.node.provider.id)}
                  lang={lang}
                  onProviderClick={onProviderClick}
                  onToggleRootCollapsed={toggleRootCollapsed}
                  selectedProviderId={selectedProviderId}
                  tr={tr}
                />
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function OrganizationDivider() {
  return (
    <div className="flex items-center gap-2 py-2" aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
      <span className="size-1.5 rounded-full bg-orange-400" />
      <span className="size-1.5 rounded-full bg-orange-300" />
      <span className="size-1.5 rounded-full bg-orange-200" />
      <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
    </div>
  );
}

type TimelineNodeProps = {
  isCollapsed: boolean;
  item: ProviderTimelineVisualNode;
  lang: Lang;
  onProviderClick: (providerId: string) => void;
  onToggleRootCollapsed: (providerId: string) => void;
  selectedProviderId?: string | null;
  tr: Record<string, string>;
};

function TimelineNode({
  isCollapsed,
  item,
  lang,
  onProviderClick,
  onToggleRootCollapsed,
  selectedProviderId,
  tr,
}: TimelineNodeProps) {
  const { depth, isLast, node } = item;
  const { provider, children } = node;
  const hasChildren = children.length > 0;
  const tone = levelTone(provider.organization_level);
  const active = selectedProviderId === provider.id;
  const locationText = [provider.address_city, provider.address_country].filter(Boolean).join(", ");
  const specializationText = providerSpecializationText(provider, lang);
  const connectorWidth = (depth + 1) * CONNECTOR_STEP;
  const currentCenter = depth * CONNECTOR_STEP + CONNECTOR_CENTER;
  const isRootOrganization = depth === 0 && provider.organization_level === "organization";
  const canToggleRoot = depth === 0 && hasChildren;
  const showCurrentConnector = !isRootOrganization;
  const connectParentAbove = showCurrentConnector && depth > 0;
  const connectBelow = showCurrentConnector && depth > 0 && !isLast;

  return (
    <div className="relative flex min-w-0 items-stretch">
      <div className="relative shrink-0" style={{ width: connectorWidth }}>
        {item.ancestorHasNext.map((hasNext, levelDepth) => {
          if (!hasNext || levelDepth === 0 || levelDepth >= depth) return null;

          return (
            <span
              key={levelDepth}
              aria-hidden="true"
              className={cn("absolute inset-y-[-10px] w-px rounded-full", railClassForDepth(levelDepth))}
              style={{ left: levelDepth * CONNECTOR_STEP + CONNECTOR_CENTER }}
            />
          );
        })}
        {connectParentAbove ? (
          <span
            aria-hidden="true"
            className={cn("absolute top-[-10px] w-px rounded-full", tone.rail)}
            style={{
              left: currentCenter,
              height: "calc(50% - 4px)",
            }}
          />
        ) : null}
        {connectBelow ? (
          <span
            aria-hidden="true"
            className={cn("absolute bottom-[-10px] w-px rounded-full", tone.rail)}
            style={{
              left: currentCenter,
              top: "calc(50% + 14px)",
            }}
          />
        ) : null}
        <span
          className={cn(
            "absolute z-10 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm ring-4 ring-card",
            tone.dot,
          )}
          style={{
            left: currentCenter - CONNECTOR_CENTER,
            top: "50%",
            transform: "translateY(-50%)",
          }}
        >
          <ProviderLevelIcon className="size-3.5" level={provider.organization_level} />
        </span>
      </div>
      <div
        className={cn(
          "group flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/95 px-3 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/35 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          active && "border-primary/55 bg-white shadow-[inset_3px_0_0_var(--primary),0_1px_3px_rgba(15,23,42,0.08)]",
        )}
      >
        {depth === 0 ? (
          canToggleRoot ? (
            <button
              type="button"
              aria-expanded={!isCollapsed}
              aria-label={
                isCollapsed
                  ? (tr.providers_tree_expand ?? provider.name)
                  : (tr.providers_tree_collapse ?? provider.name)
              }
              title={
                isCollapsed
                  ? (tr.providers_tree_expand ?? provider.name)
                  : (tr.providers_tree_collapse ?? provider.name)
              }
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => onToggleRootCollapsed(provider.id)}
            >
              <ChevronRight className={cn("size-4 transition-transform", !isCollapsed && "rotate-90")} />
            </button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden="true" />
          )
        ) : null}
        <button
          type="button"
          onClick={() => onProviderClick(provider.id)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-foreground">
              {provider.name}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn("rounded-full text-[10px]", tone.badge)}
              >
                {levelLabel(provider.organization_level, tr)}
              </Badge>
              <Badge
                variant="outline"
                className={cn("rounded-full text-[10px]", providerTypeTone(provider))}
              >
                {providerTypeLabel(provider.provider_type, tr)}
              </Badge>
              <ProviderStatusBadge active={provider.is_active} tr={tr} />
              <Badge
                variant="outline"
                className={cn("rounded-full text-[10px]", contractTone(provider))}
              >
                {contractLabel(provider, tr)}
              </Badge>
            </span>
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {locationText ? (
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground/70">
                    {tr.providers_city} / {tr.providers_country}:{" "}
                  </span>
                  {locationText}
                </span>
              ) : null}
              {specializationText ? (
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground/70">{tr.providers_fachbereich}: </span>
                  {specializationText}
                </span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
            {hasChildren ? (
              <TimelineMetric
                icon="children"
                label={
                  tr.providers_hierarchy_metric_children ??
                  tr.providers_children ??
                  "children"
                }
                value={children.length}
              />
            ) : null}
            {provider.doctor_count > 0 ? (
              <TimelineMetric
                icon="doctors"
                label={
                  tr.providers_hierarchy_metric_doctors ??
                  tr.providers_doctors ??
                  "doctors"
                }
                value={provider.doctor_count}
              />
            ) : null}
          </span>
        </button>
      </div>
    </div>
  );
}

function TimelineMetric({
  icon,
  label,
  value,
}: {
  icon: "children" | "doctors";
  label: string;
  value: number;
}) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
      title={`${value} ${label}`}
    >
      {icon === "children" ? (
        <Building2 className="size-3 shrink-0" />
      ) : (
        <Stethoscope className="size-3 shrink-0" />
      )}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="max-w-24 truncate">{label}</span>
    </span>
  );
}
