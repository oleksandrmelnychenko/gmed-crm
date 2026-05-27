import { Fragment, useMemo, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  MapPin,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import { AdminInlineMetric, AdminTableCard } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  PageHeader,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type CvStatus = "ready" | "review" | "draft" | "archived";

type CvTreeNode = {
  id: string;
  label: string;
  meta?: string;
  children?: CvTreeNode[];
};

type CvLibraryRow = {
  id: string;
  name: string;
  headline: string;
  location: string;
  languages: string[];
  status: CvStatus;
  owner: string;
  updatedAt: string;
  tree: CvTreeNode[];
};

type SalesPeopleText = {
  sales_people_title: string;
  sales_people_subtitle: string;
  sales_people_search_placeholder: string;
  sales_people_status_all: string;
  sales_people_table_person: string;
  sales_people_table_role: string;
  sales_people_table_location: string;
  sales_people_table_languages: string;
  sales_people_table_owner: string;
  sales_people_table_updated: string;
  sales_people_table_status: string;
  sales_people_empty_title: string;
  sales_people_empty_description: string;
  sales_people_expand_cv: string;
  sales_people_collapse_cv: string;
  sales_people_tree_expand: string;
  sales_people_tree_collapse: string;
  sales_people_cv_tree: string;
  sales_people_stat_total: string;
  sales_people_stat_ready: string;
  sales_people_stat_review: string;
  sales_people_stat_cities: string;
  sales_people_status_ready: string;
  sales_people_status_review: string;
  sales_people_status_draft: string;
  sales_people_status_archived: string;
};

const CV_LIBRARY_ROWS: CvLibraryRow[] = [
  {
    id: "cv-001",
    name: "Anna Keller",
    headline: "Senior patient acquisition manager",
    location: "Munich, DE",
    languages: ["DE", "EN", "RU"],
    status: "ready",
    owner: "Max Richter",
    updatedAt: "2026-05-12",
    tree: [
      {
        id: "profile",
        label: "Profile",
        meta: "Core identity and sales fit",
        children: [
          { id: "summary", label: "Executive summary", meta: "Short commercial profile" },
          { id: "contacts", label: "Contact points", meta: "Phone, email, LinkedIn" },
          { id: "markets", label: "Target markets", meta: "DACH, CIS, international patients" },
        ],
      },
      {
        id: "experience",
        label: "Experience",
        meta: "8 years",
        children: [
          { id: "gmed", label: "Medical tourism sales", meta: "Lead qualification and partner handoff" },
          { id: "clinic", label: "Clinic relations", meta: "Provider coordination" },
        ],
      },
      {
        id: "documents",
        label: "Documents",
        meta: "4 files",
        children: [
          { id: "cv-pdf", label: "CV PDF", meta: "latest" },
          { id: "certificates", label: "Certificates", meta: "sales, compliance" },
          { id: "references", label: "References", meta: "2 verified" },
        ],
      },
    ],
  },
  {
    id: "cv-002",
    name: "Dmytro Bondar",
    headline: "International partnerships lead",
    location: "Berlin, DE",
    languages: ["UA", "DE", "EN"],
    status: "review",
    owner: "Sofia Novak",
    updatedAt: "2026-05-10",
    tree: [
      {
        id: "profile",
        label: "Profile",
        meta: "Partner-facing background",
        children: [
          { id: "summary", label: "Executive summary", meta: "Needs final PM review" },
          { id: "contacts", label: "Contact points", meta: "Email verified" },
        ],
      },
      {
        id: "pipeline",
        label: "Sales pipeline context",
        meta: "3 active matches",
        children: [
          { id: "clinics", label: "Clinic partner network", meta: "Cardiology, orthopedics" },
          { id: "regions", label: "Regions", meta: "Ukraine, Poland, Germany" },
        ],
      },
      {
        id: "documents",
        label: "Documents",
        meta: "2 files",
        children: [
          { id: "cv-docx", label: "CV DOCX", meta: "editable source" },
          { id: "portfolio", label: "Portfolio", meta: "pending clean-up" },
        ],
      },
    ],
  },
  {
    id: "cv-003",
    name: "Marta Schulz",
    headline: "Provider outreach specialist",
    location: "Hamburg, DE",
    languages: ["DE", "EN"],
    status: "draft",
    owner: "Max Richter",
    updatedAt: "2026-05-08",
    tree: [
      {
        id: "profile",
        label: "Profile",
        meta: "Draft intake",
        children: [
          { id: "summary", label: "Executive summary", meta: "Missing one paragraph" },
          { id: "contacts", label: "Contact points", meta: "Private phone hidden" },
        ],
      },
      {
        id: "documents",
        label: "Documents",
        meta: "1 file",
        children: [
          { id: "cv-pdf", label: "CV PDF", meta: "first upload" },
        ],
      },
    ],
  },
  {
    id: "cv-004",
    name: "Oleh Moroz",
    headline: "Referral network consultant",
    location: "Vienna, AT",
    languages: ["UA", "RU", "DE"],
    status: "archived",
    owner: "Sofia Novak",
    updatedAt: "2026-04-28",
    tree: [
      {
        id: "profile",
        label: "Profile",
        meta: "Archived candidate",
        children: [
          { id: "summary", label: "Executive summary", meta: "Kept for history" },
          { id: "contacts", label: "Contact points", meta: "Do not contact" },
        ],
      },
      {
        id: "documents",
        label: "Documents",
        meta: "3 files",
        children: [
          { id: "cv-pdf", label: "CV PDF", meta: "archived" },
          { id: "notes", label: "Sales notes", meta: "closed" },
        ],
      },
    ],
  },
];

const STATUS_CLASS: Record<CvStatus, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  review: "border-amber-200 bg-amber-50 text-amber-700",
  draft: "border-zinc-200 bg-zinc-50 text-zinc-700",
  archived: "border-slate-200 bg-slate-50 text-slate-600",
};

function getTreeRootKeys(row: CvLibraryRow) {
  return row.tree.map((node) => treeNodeKey(row.id, node.id));
}

function treeNodeKey(rowId: string, nodeId: string) {
  return `${rowId}:${nodeId}`;
}

function titleWithDot(title: string) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function statusLabel(status: CvStatus, text: SalesPeopleText) {
  switch (status) {
    case "ready":
      return text.sales_people_status_ready;
    case "review":
      return text.sales_people_status_review;
    case "draft":
      return text.sales_people_status_draft;
    case "archived":
      return text.sales_people_status_archived;
  }
}

function matchesSearch(row: CvLibraryRow, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [
    row.name,
    row.headline,
    row.location,
    row.owner,
    row.status,
    row.languages.join(" "),
    row.tree.map((node) => `${node.label} ${node.meta ?? ""}`).join(" "),
  ].join(" ").toLowerCase();

  return haystack.includes(query);
}

export function SalesPeoplePage() {
  const { t } = useLang();
  const text = t as unknown as SalesPeopleText;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CvStatus | "all">("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(CV_LIBRARY_ROWS[0] ? [CV_LIBRARY_ROWS[0].id] : []),
  );
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Set<string>>(
    () => new Set(CV_LIBRARY_ROWS.flatMap(getTreeRootKeys)),
  );

  const normalizedSearch = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    return CV_LIBRARY_ROWS.filter((row) => {
      const statusMatches = status === "all" || row.status === status;
      return statusMatches && matchesSearch(row, normalizedSearch);
    });
  }, [normalizedSearch, status]);

  const readyCount = CV_LIBRARY_ROWS.filter((row) => row.status === "ready").length;
  const reviewCount = CV_LIBRARY_ROWS.filter((row) => row.status === "review").length;
  const cityCount = new Set(CV_LIBRARY_ROWS.map((row) => row.location)).size;

  function toggleRow(row: CvLibraryRow) {
    const isCurrentlyExpanded = expandedRows.has(row.id);
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      return next;
    });

    if (!isCurrentlyExpanded) {
      setExpandedTreeNodes((current) => {
        const next = new Set(current);
        for (const key of getTreeRootKeys(row)) {
          next.add(key);
        }
        return next;
      });
    }
  }

  function toggleTreeNode(rowId: string, nodeId: string) {
    const key = treeNodeKey(rowId, nodeId);
    setExpandedTreeNodes((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={text.sales_people_title}
        description={text.sales_people_subtitle}
      />

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={UsersRound}
          label={text.sales_people_stat_total}
          value={CV_LIBRARY_ROWS.length}
        />
        <AdminInlineMetric
          icon={BadgeCheck}
          label={text.sales_people_stat_ready}
          value={readyCount}
        />
        <AdminInlineMetric
          icon={Clock3}
          label={text.sales_people_stat_review}
          value={reviewCount}
        />
        <AdminInlineMetric
          icon={MapPin}
          label={text.sales_people_stat_cities}
          value={cityCount}
        />
      </div>

      <AdminTableCard title={titleWithDot(text.sales_people_title)} count={filteredRows.length}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="relative min-w-[240px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className={cn(shellInputClassName, "h-8 rounded-lg bg-background pl-8 text-[13px]")}
              placeholder={text.sales_people_search_placeholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <NativeComboboxSelect
            value={status}
            onChange={(event) => setStatus(event.target.value as CvStatus | "all")}
            className={cn(shellSelectClassName, "h-8 w-[180px] bg-background text-[13px]")}
            aria-label={text.sales_people_table_status}
          >
            <option value="all">{text.sales_people_status_all}</option>
            <option value="ready">{text.sales_people_status_ready}</option>
            <option value="review">{text.sales_people_status_review}</option>
            <option value="draft">{text.sales_people_status_draft}</option>
            <option value="archived">{text.sales_people_status_archived}</option>
          </NativeComboboxSelect>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed border-separate border-spacing-0">
            <thead>
              <tr className="bg-muted/35 text-left text-[11px] font-semibold text-muted-foreground">
                <th className="w-12 px-3 py-2" />
                <th className="w-[24%] px-3 py-2">{text.sales_people_table_person}</th>
                <th className="w-[25%] px-3 py-2">{text.sales_people_table_role}</th>
                <th className="w-[14%] px-3 py-2">{text.sales_people_table_location}</th>
                <th className="w-[14%] px-3 py-2">{text.sales_people_table_languages}</th>
                <th className="w-[13%] px-3 py-2">{text.sales_people_table_owner}</th>
                <th className="w-[10%] px-3 py-2">{text.sales_people_table_updated}</th>
                <th className="w-[132px] px-3 py-2">{text.sales_people_table_status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70 text-sm">
              {filteredRows.map((row) => {
                const isExpanded = expandedRows.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr className="align-top hover:bg-muted/25">
                      <td className="px-3 py-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-md"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? text.sales_people_collapse_cv
                              : text.sales_people_expand_cv
                          }
                          title={
                            isExpanded
                              ? text.sales_people_collapse_cv
                              : text.sales_people_expand_cv
                          }
                          onClick={() => toggleRow(row)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </Button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <UserRound className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{row.name}</div>
                            <div className="truncate text-xs text-muted-foreground">ID {row.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="truncate text-foreground">{row.headline}</div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{row.location}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {row.languages.map((language) => (
                            <Badge
                              key={language}
                              variant="outline"
                              className="rounded-md px-1.5 py-0 text-[11px] font-medium"
                            >
                              {language}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{row.owner}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.updatedAt}</td>
                      <td className="px-3 py-3">
                        <Badge
                          variant="outline"
                          className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", STATUS_CLASS[row.status])}
                        >
                          {statusLabel(row.status, text)}
                        </Badge>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td className="px-3 pb-4 pt-1" />
                        <td colSpan={7} className="px-3 pb-5 pt-1">
                          <CvTree
                            row={row}
                            expandedTreeNodes={expandedTreeNodes}
                            onToggle={toggleTreeNode}
                            text={text}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {text.sales_people_empty_title}
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              {text.sales_people_empty_description}
            </p>
          </div>
        ) : null}
      </AdminTableCard>
    </div>
  );
}

function CvTree({
  row,
  expandedTreeNodes,
  onToggle,
  text,
}: {
  row: CvLibraryRow;
  expandedTreeNodes: Set<string>;
  onToggle: (rowId: string, nodeId: string) => void;
  text: SalesPeopleText;
}) {
  return (
    <div aria-label={text.sales_people_cv_tree} className="max-w-4xl py-1">
      <ol className="space-y-1">
        {row.tree.map((node) => (
          <CvTreeItem
            key={node.id}
            rowId={row.id}
            node={node}
            depth={0}
            expandedTreeNodes={expandedTreeNodes}
            onToggle={onToggle}
            text={text}
          />
        ))}
      </ol>
    </div>
  );
}

function CvTreeItem({
  rowId,
  node,
  depth,
  expandedTreeNodes,
  onToggle,
  text,
}: {
  rowId: string;
  node: CvTreeNode;
  depth: number;
  expandedTreeNodes: Set<string>;
  onToggle: (rowId: string, nodeId: string) => void;
  text: SalesPeopleText;
}) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedTreeNodes.has(treeNodeKey(rowId, node.id));
  const Icon = depth === 0 ? FolderOpen : depth === 1 ? FileText : BriefcaseBusiness;

  return (
    <li>
      <div
        className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-sm"
        style={{ paddingLeft: depth * 22 }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-md"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? text.sales_people_tree_collapse : text.sales_people_tree_expand}
            title={isExpanded ? text.sales_people_tree_collapse : text.sales_people_tree_expand}
            onClick={() => onToggle(rowId, node.id)}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        ) : (
          <span className="size-7" />
        )}

        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{node.label}</span>
        </div>

        {node.meta ? (
          <span className="max-w-[220px] truncate text-xs text-muted-foreground">
            {node.meta}
          </span>
        ) : null}
      </div>

      {hasChildren && isExpanded ? (
        <ol className="space-y-0.5">
          {children.map((child) => (
            <CvTreeItem
              key={child.id}
              rowId={rowId}
              node={child}
              depth={depth + 1}
              expandedTreeNodes={expandedTreeNodes}
              onToggle={onToggle}
              text={text}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
