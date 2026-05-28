import { useMemo } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  providerTaxonomyChildren,
  providerTaxonomyKindRoot,
  providerTaxonomyIsLeafSelection,
  providerTaxonomyNodeLabel,
  providerTaxonomyVisiblePathForNodeId,
  type ProviderTaxonomyScope,
  type ProviderTaxonomySelectionMode,
} from "@/pages/providers/model/provider-taxonomy-cascade";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";

type ProviderTaxonomyCascadeSelectProps = {
  value: string;
  nodes: ProviderTaxonomyNode[];
  providerType?: ProviderTaxonomyScope;
  mode?: ProviderTaxonomySelectionMode;
  disabled?: boolean;
  placeholder: string;
  allLabel?: string;
  containerClassName?: string;
  selectClassName?: string;
  levelPlaceholders?: Partial<Record<ProviderTaxonomyNode["level"], string>>;
  "aria-label"?: string;
  onChange: (value: string) => void;
};

type TaxonomyTreeOption = {
  node: ProviderTaxonomyNode;
  depth: number;
};

const DEFAULT_LEVEL_PLACEHOLDERS: Record<ProviderTaxonomyNode["level"], string> = {
  category: "Provider type",
  group: "Category",
  subgroup: "Subcategory",
  type: "Type",
};

export function ProviderTaxonomyCascadeSelect({
  value,
  nodes,
  providerType,
  mode = "any",
  disabled,
  placeholder,
  allLabel,
  containerClassName,
  selectClassName,
  levelPlaceholders,
  "aria-label": ariaLabel,
  onChange,
}: ProviderTaxonomyCascadeSelectProps) {
  const { lang } = useLang();
  const root = providerTaxonomyKindRoot(nodes, providerType);
  const treeOptions = useMemo(() => {
    const result: TaxonomyTreeOption[] = [];
    const appendChildren = (parentId: string | null, depth: number) => {
      const children = providerTaxonomyChildren(nodes, parentId, providerType);
      for (const child of children) {
        result.push({ node: child, depth });
        appendChildren(child.id, depth + 1);
      }
    };

    appendChildren(root?.id ?? null, 0);
    return result;
  }, [nodes, providerType, root?.id]);
  const selectedNode = useMemo(
    () => treeOptions.find((option) => option.node.id === value)?.node ?? null,
    [treeOptions, value],
  );
  const selectedTitle = useMemo(() => {
    if (!value) return allLabel ?? placeholder;
    const path = providerTaxonomyVisiblePathForNodeId(nodes, value, providerType);
    const labels = path.map((node) => providerTaxonomyNodeLabel(node, lang)).filter(Boolean);
    return labels.at(-1) ?? (selectedNode ? providerTaxonomyNodeLabel(selectedNode, lang) : placeholder);
  }, [allLabel, lang, nodes, placeholder, providerType, selectedNode, value]);

  if (treeOptions.length === 0) {
    return (
      <div className={cn("flex min-w-0 flex-wrap gap-2", containerClassName)}>
        <NativeComboboxSelect
          value=""
          onChange={() => undefined}
          disabled
          className={cn("col-span-full", selectClassName)}
          title={allLabel ?? placeholder}
          aria-label={ariaLabel ?? placeholder}
        >
          <option value="">{allLabel ?? placeholder}</option>
        </NativeComboboxSelect>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-wrap gap-2", containerClassName)}>
      <NativeComboboxSelect
        value={selectedNode ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || treeOptions.length === 0}
        className={cn("col-span-full", selectClassName)}
        title={selectedTitle}
        aria-label={ariaLabel ?? placeholder}
      >
        <option value="">{allLabel ?? placeholder}</option>
        {treeOptions.map(({ node, depth }) => {
          const disabledOption = mode === "leaf" && !providerTaxonomyIsLeafSelection(node);
          const levelPlaceholder = levelPlaceholders?.[node.level] ?? DEFAULT_LEVEL_PLACEHOLDERS[node.level];
          const label = providerTaxonomyNodeLabel(node, lang);
          const searchText = providerTaxonomyVisiblePathForNodeId(nodes, node.id, providerType)
            .map((pathNode) => providerTaxonomyNodeLabel(pathNode, lang))
            .join(" ");

          return (
            <option
              key={node.id}
              value={node.id}
              disabled={disabledOption}
              data-disabled-presentation={disabledOption ? "group" : undefined}
              data-search-text={`${node.code} ${searchText}`}
            >
              <span
                className="flex min-w-0 items-center truncate"
                style={{ paddingLeft: `${depth * 18}px` }}
                title={`${levelPlaceholder}: ${label}`}
              >
                {depth > 0 ? (
                  <span className="mr-2 flex h-5 w-4 shrink-0 items-center" aria-hidden="true">
                    <span className="h-full w-px bg-border/80" />
                    <span className="h-px w-3 bg-border/80" />
                  </span>
                ) : (
                  <span className="mr-2 h-4 w-1 shrink-0 rounded-full bg-foreground/35" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    depth === 0 && "font-medium text-foreground",
                    depth === 1 && "text-foreground/90",
                    depth >= 2 && "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </span>
            </option>
          );
        })}
      </NativeComboboxSelect>
    </div>
  );
}
