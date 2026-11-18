/** Manual order of the agency service catalog (owner 2026-11-18). */

/** Moves `id` to the place of `targetId`; the items in between shift by one. */
export function moveCatalogItemTo<T extends { id: string }>(
  items: readonly T[],
  id: string,
  targetId: string,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return items.slice();
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Moves `id` by `delta` places, clamped to the list. */
export function moveCatalogItemBy<T extends { id: string }>(
  items: readonly T[],
  id: string,
  delta: number,
): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items.slice();
  const to = Math.min(Math.max(from + delta, 0), items.length - 1);
  const target = items[to];
  return target ? moveCatalogItemTo(items, id, target.id) : items.slice();
}

/** The nearest scrolling ancestor of a drag handle (the table body). */
export function findScrollParent(element: HTMLElement): HTMLElement | null {
  let scroller = element.parentElement;
  while (
    scroller &&
    !(
      scroller.scrollHeight > scroller.clientHeight &&
      /(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    )
  ) {
    scroller = scroller.parentElement;
  }
  return scroller;
}

/** Scrolls the table under a dragged row when the pointer nears its top or bottom edge. */
export function scrollTableWhileDragging(scroller: HTMLElement | null, clientY: number) {
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 40;
  if (clientY < rect.top + edge) scroller.scrollBy({ top: -16 });
  else if (clientY > rect.bottom - edge) scroller.scrollBy({ top: 16 });
}

export function sameCatalogOrder(
  left: readonly { id: string }[],
  right: readonly { id: string }[],
): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}
