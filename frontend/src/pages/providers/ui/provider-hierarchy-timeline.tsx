import { Fragment, useMemo, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Stethoscope } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { countryNameForDisplay } from "@/components/ui/country-select";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ProviderCategoryIcon } from "./provider-category-icon";
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
const TIMELINE_ROOTS_PAGE_SIZE = 50;
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
  className?: string;
  lang: Lang;
  onProviderClick: (providerId: string) => void;
  providers: readonly ProviderSummary[];
  selectedProviderId?: string | null;
  tr: Record<string, string>;
};

export function ProviderHierarchyTimeline({
  className,
  lang,
  onProviderClick,
  providers,
  selectedProviderId,
  tr,
}: ProviderHierarchyTimelineProps) {
  const [collapsedRootIds, setCollapsedRootIds] = useState<Set<string>>(() => new Set());
  const [pageIndex, setPageIndex] = useState(0);
  const tree = useMemo(() => buildProviderTimelineTree(providers), [providers]);
  const totalPages = Math.max(1, Math.ceil(tree.length / TIMELINE_ROOTS_PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = safePageIndex * TIMELINE_ROOTS_PAGE_SIZE;
  const pagedTree = useMemo(
    () => tree.slice(pageStart, pageStart + TIMELINE_ROOTS_PAGE_SIZE),
    [pageStart, tree],
  );
  const timelineItems = useMemo(
    () => flattenProviderTimelineTree(pagedTree, { collapsedRootIds }),
    [collapsedRootIds, pagedTree],
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

  if (providers.length === 0) return null;

  return (
    <section
      data-testid="provider-hierarchy-timeline"
      className={cn("rounded-lg border border-border/70 bg-card shadow-sm", className)}
    >
      {totalPages > 1 ? (
        <TimelinePager
          className="border-b border-border/60"
          pageStart={pageStart}
          safePageIndex={safePageIndex}
          totalPages={totalPages}
          totalRoots={tree.length}
          tr={tr}
          onPageChange={setPageIndex}
        />
      ) : null}
      {tree.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          {tr.providers_hierarchy_timeline_empty ?? tr.common_no_results}
        </div>
      ) : (
        <div className="p-3.5">
          <div className="space-y-1.5">
            {timelineItems.map((item) => (
              <Fragment key={item.node.provider.id}>
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
      {totalPages > 1 ? (
        <TimelinePager
          className="border-t border-border/60 bg-muted/15"
          pageStart={pageStart}
          safePageIndex={safePageIndex}
          totalPages={totalPages}
          totalRoots={tree.length}
          tr={tr}
          onPageChange={setPageIndex}
        />
      ) : null}
    </section>
  );
}

function TimelinePager({
  className,
  pageStart,
  safePageIndex,
  totalPages,
  totalRoots,
  tr,
  onPageChange,
}: {
  className?: string;
  pageStart: number;
  safePageIndex: number;
  totalPages: number;
  totalRoots: number;
  tr: Record<string, string>;
  onPageChange: (pageIndex: number) => void;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-4 py-2", className)}>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {pageStart + 1}-{Math.min(pageStart + TIMELINE_ROOTS_PAGE_SIZE, totalRoots)} / {totalRoots}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={safePageIndex === 0}
          aria-label={tr.pagination_previous ?? "Previous"}
          onClick={() => onPageChange(Math.max(0, safePageIndex - 1))}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center font-mono text-xs font-medium tabular-nums text-foreground">
          {safePageIndex + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={safePageIndex >= totalPages - 1}
          aria-label={tr.pagination_next ?? "Next"}
          onClick={() => onPageChange(Math.min(totalPages - 1, safePageIndex + 1))}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
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

const LOCATION_CHIP_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-orange-200 bg-orange-50 text-orange-700",
] as const;

function locationChipTone(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return LOCATION_CHIP_TONES[Math.abs(hash) % LOCATION_CHIP_TONES.length];
}

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
  const locationText = [
    provider.address_city,
    countryNameForDisplay(provider.address_country, lang),
  ].filter(Boolean).join(", ");
  const specializationText = providerSpecializationText(provider, lang);
  const connectorWidth = (depth + 1) * CONNECTOR_STEP;
  const currentCenter = depth * CONNECTOR_STEP + CONNECTOR_CENTER;
  const canToggleRoot = depth === 0 && hasChildren;

  return (
    <div className="relative flex min-w-0 items-stretch">
      <div className="relative shrink-0" style={{ width: connectorWidth }}>
        {item.ancestorHasNext.map((hasNext, levelDepth) => {
          if (!hasNext || levelDepth === 0 || levelDepth >= depth) return null;

          // Pass-through rail for an ancestor level that continues below.
          // The -6px top bridges the 6px gap between rows, keeping the
          // line continuous without poking outside the list container.
          return (
            <span
              key={levelDepth}
              aria-hidden="true"
              className={cn("absolute w-px", railClassForDepth(levelDepth))}
              style={{
                left: levelDepth * CONNECTOR_STEP + CONNECTOR_CENTER,
                top: -6,
                bottom: 0,
              }}
            />
          );
        })}
        {depth > 0 ? (
          <>
            {/* Own rail: elbow for the last sibling, tee otherwise. */}
            <span
              aria-hidden="true"
              className={cn("absolute w-px", tone.rail)}
              style={
                isLast
                  ? { left: currentCenter, top: -6, height: "calc(50% + 6px)" }
                  : { left: currentCenter, top: -6, bottom: 0 }
              }
            />
            {/* Horizontal stub from the rail to the row card. */}
            <span
              aria-hidden="true"
              className={cn("absolute h-px", tone.rail)}
              style={{
                left: currentCenter,
                top: "50%",
                width: connectorWidth - currentCenter - 4,
              }}
            />
          </>
        ) : null}
      </div>
      <div
        className={cn(
          "group flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-border/60 bg-white/95 px-3 py-2 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-primary/35 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
          active && "border-primary/55 bg-white shadow-[inset_3px_0_0_var(--primary),0_1px_3px_rgba(15,23,42,0.08)]",
        )}
      >
        {canToggleRoot ? (
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
            className={cn(
              "relative flex size-7 shrink-0 items-center justify-center rounded-full border bg-background transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              tone.dot,
            )}
            onClick={() => onToggleRootCollapsed(provider.id)}
          >
            <ProviderCategoryIcon
              providerType={provider.provider_type}
              categoryKey={provider.taxonomy_node?.code ?? null}
              className="size-3.5"
            />
            <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-border/60 bg-card shadow-sm">
              <ChevronRight
                className={cn("size-2.5 text-muted-foreground transition-transform", !isCollapsed && "rotate-90")}
              />
            </span>
          </button>
        ) : (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border bg-background",
              tone.dot,
            )}
            aria-hidden="true"
          >
            <ProviderCategoryIcon
              providerType={provider.provider_type}
              categoryKey={provider.taxonomy_node?.code ?? null}
              className="size-3.5"
            />
          </span>
        )}
        <button
          type="button"
          onClick={() => onProviderClick(provider.id)}
          className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-start gap-1">
              <span className="min-w-0 truncate text-xs font-semibold text-foreground" title={provider.name}>
                {provider.name}
              </span>
              <span
                className={cn(
                  "mt-[3px] size-1.5 shrink-0 rounded-full",
                  provider.is_active ? "bg-emerald-500" : "bg-zinc-300",
                )}
                title={provider.is_active ? (tr.common_active ?? "Active") : (tr.common_inactive ?? "Inactive")}
              />
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
              <Badge
                variant="outline"
                className={cn("rounded-full text-[10px]", contractTone(provider))}
              >
                {contractLabel(provider, tr)}
              </Badge>
            </span>
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {specializationText ? (
                <span className="min-w-0 max-w-full break-words font-mono text-foreground">
                  <span className="font-medium">{tr.providers_fachbereich}: </span>
                  {specializationText}
                </span>
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
            {locationText ? (
              <span
                title={`${tr.providers_city} / ${tr.providers_country}`}
                className={cn(
                  "max-w-[220px] truncate rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
                  locationChipTone(locationText),
                )}
              >
                {locationText}
              </span>
            ) : null}
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
