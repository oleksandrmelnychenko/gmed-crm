/** A category of the document dictionary as the tree needs it. */
export type TreeCategory = {
  key: string;
  parent_key?: string | null;
  sort_order?: number;
};

export type OrderedTreeCategory<T extends TreeCategory> = T & {
  /** 0 for a top-level category, 1 for its children, … */
  depth: number;
};

function bySortOrder(left: TreeCategory, right: TreeCategory) {
  const order = (left.sort_order ?? 999) - (right.sort_order ?? 999);
  return order !== 0 ? order : left.key.localeCompare(right.key);
}

/**
 * The categories in tree order: every top-level category followed by its
 * children (depth-first), siblings by their sort order. A category whose
 * parent is unknown is shown on the top level, so nothing is lost; the
 * sort order of one level never moves a child under another parent
 * (QA 2026-10-11 B-12: a flat sort put "Labor / Analyse" under ADMIN and
 * "PERS · Reisepass" under UEB).
 */
export function orderCategoryTree<T extends TreeCategory>(
  categories: readonly T[],
): Array<OrderedTreeCategory<T>> {
  const keys = new Set(categories.map((category) => category.key));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const category of categories) {
    const parent = category.parent_key?.trim();
    if (parent && parent !== category.key && keys.has(parent)) {
      const siblings = children.get(parent) ?? [];
      siblings.push(category);
      children.set(parent, siblings);
    } else {
      roots.push(category);
    }
  }

  const ordered: Array<OrderedTreeCategory<T>> = [];
  const visited = new Set<string>();
  const visit = (category: T, depth: number) => {
    if (visited.has(category.key)) return;
    visited.add(category.key);
    ordered.push({ ...category, depth });
    for (const child of [...(children.get(category.key) ?? [])].sort(bySortOrder)) {
      visit(child, depth + 1);
    }
  };
  for (const root of [...roots].sort(bySortOrder)) visit(root, 0);
  // A cycle in the parents (never written by the migrations) still shows
  // every category once.
  for (const category of [...categories].sort(bySortOrder)) visit(category, 0);
  return ordered;
}
