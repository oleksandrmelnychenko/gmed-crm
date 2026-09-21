/**
 * Tree helpers for document lists: saved translations are ordinary documents
 * that carry `translation_source_document_id`. Lists show them as children
 * directly under their source document instead of as unrelated rows. A
 * translation of a translation nests one level deeper.
 */
export type TranslationTreeItem = {
  id: string;
  translation_source_document_id?: string | null;
};

export type TranslationTree<T extends TranslationTreeItem> = {
  /** Rows to sort, filter and paginate: everything except attached children. */
  roots: T[];
  childrenByParent: Map<string, T[]>;
  /** Nesting level per attached child (1 = direct translation). */
  depthById: Map<string, number>;
};

const MAX_DEPTH = 6;

export function splitTranslationTree<T extends TranslationTreeItem>(
  items: readonly T[],
): TranslationTree<T> {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const childrenByParent = new Map<string, T[]>();
  const depthById = new Map<string, number>();
  const roots: T[] = [];

  const depthOf = (item: T): number => {
    const cached = depthById.get(item.id);
    if (cached !== undefined) return cached;
    let depth = 0;
    let current: T | undefined = item;
    const seen = new Set<string>();
    while (current && depth < MAX_DEPTH) {
      const parentId: string | null = current.translation_source_document_id ?? null;
      if (!parentId || parentId === current.id || seen.has(parentId)) break;
      const parent = byId.get(parentId);
      if (!parent) break;
      seen.add(current.id);
      depth += 1;
      current = parent;
    }
    depthById.set(item.id, depth);
    return depth;
  };

  for (const item of items) {
    const parentId = item.translation_source_document_id ?? null;
    // A translation whose source is filtered out stays visible as a root row.
    if (parentId && parentId !== item.id && byId.has(parentId) && depthOf(item) > 0) {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(item);
      childrenByParent.set(parentId, siblings);
    } else {
      depthById.delete(item.id);
      roots.push(item);
    }
  }
  return { roots, childrenByParent, depthById };
}

/** Re-attach children (recursively) after their parent in a sorted/paged list. */
export function withTranslationChildren<T extends TranslationTreeItem>(
  rows: readonly T[],
  childrenByParent: Map<string, T[]>,
): T[] {
  if (childrenByParent.size === 0) return [...rows];
  const output: T[] = [];
  const visit = (row: T, depth: number) => {
    output.push(row);
    if (depth >= MAX_DEPTH) return;
    for (const child of childrenByParent.get(row.id) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const row of rows) visit(row, 0);
  return output;
}

/** Indentation for a nested translation row, in pixels. */
export function translationIndent(depth: number | undefined): number {
  return depth && depth > 0 ? 8 + (depth - 1) * 16 : 0;
}
