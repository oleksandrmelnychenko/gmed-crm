/**
 * Copies text to the clipboard. The async Clipboard API is refused in some
 * browsers and embedded views (no permission, not a secure context), so the
 * legacy `execCommand("copy")` on a temporary textarea is tried next. The
 * textarea is placed inside `container` (e.g. the open dialog): a modal focus
 * trap would otherwise pull the focus away and copy nothing.
 */
export async function copyText(text: string, container?: Element | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  return legacyCopy(text, container);
}

function legacyCopy(text: string, container?: Element | null): boolean {
  if (typeof document === "undefined") return false;
  const host = container ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  host.appendChild(textarea);
  const active = document.activeElement as HTMLElement | null;
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    active?.focus?.();
  }
}

/** Selects the text of `element` so the person can copy it by hand. */
export function selectElementText(element: Element | null | undefined) {
  if (!element || typeof window === "undefined") return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
