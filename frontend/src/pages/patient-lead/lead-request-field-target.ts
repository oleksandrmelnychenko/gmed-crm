import { isBillingField } from "./lead-request-billing-model";
import { isRecipientField } from "./lead-request-recipient-model";
import { representativeSubmitPart } from "./lead-request-representation-model";
import { SECTION_ANCHORS, type SectionAnchor } from "./lead-request-steps";

// The way from a missing item ("still missing: …", the summary, "please add in
// the section …") straight to its field (owner report 2026-10-21: every such
// link opens the right step and the field, not the neighbouring step).

/** Where a link of the cabinet points inside a step: a section, a field (a missing key), or both. */
export type CabinetTarget = { anchor?: SectionAnchor; field?: string };

/** What a link found on screen: the field itself, or only its section (or follow-up block). */
export type FoundCabinetTarget = { element: HTMLElement; field: boolean };

/** Keys are form keys (`first_name`, `rep1_last_name`) or follow-up keys `<block>:<key>`. */
const SAFE_KEY = /^[A-Za-z0-9_-]+$/;

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const RING = ["ring-2", "ring-amber-400", "ring-offset-2", "rounded-md"];

function byId(scope: ParentNode, id: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[id="${id}"]`);
}

function byTestId(scope: ParentNode, id: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

/** The element that answers one form key, searched by the ids and labels the cabinet gives its fields. */
export function fieldElement(scope: ParentNode, key: string): HTMLElement | null {
  if (!SAFE_KEY.test(key)) return null;
  const dashed = key.replace(/_/g, "-");
  const label = scope.querySelector<HTMLElement>(`label[for="lead-request-${key}"]`);
  const groupLabel = byId(scope, `lead-request-${key}-label`);
  const direct =
    byId(scope, `lead-request-${key}`) ??
    (label ? label.parentElement : null) ??
    (groupLabel ? groupLabel.parentElement : null) ??
    byTestId(scope, `lead-request-${key}`) ??
    byTestId(scope, `lead-request-${dashed}`) ??
    byId(scope, `lead-request-${dashed}`);
  if (direct) return direct;
  if (key === "inquiry_consent") return byTestId(scope, "lead-request-inquiry-consent");
  if (key === "id_document_upload" || key.startsWith("id_")) return byTestId(scope, "lead-request-identity-upload");
  if (key === "request_reason") return byTestId(scope, "lead-request-reason");
  const representative = representativeSubmitPart(key);
  if (representative) {
    // An upload of a person: its own button (a parent's identity copy is on step "Document").
    const upload =
      representative.part === "id_upload"
        ? byTestId(scope, `lead-request-${representative.slot}-identity-upload`)
        : representative.part === "authority_upload"
          ? byTestId(scope, `lead-request-${representative.slot}-authority-upload`)
          : null;
    if (upload) return upload;
    return (
      byTestId(scope, `lead-request-representative-${representative.slot}`) ??
      byId(scope, SECTION_ANCHORS.representatives)
    );
  }
  if (key === "has_insurance" || key.startsWith("insurance_")) return byTestId(scope, "lead-request-insurance");
  if (isRecipientField(key)) return byTestId(scope, "lead-request-invoice-recipient");
  if (key.startsWith("payer_")) return byId(scope, SECTION_ANCHORS.payer) ?? byTestId(scope, "lead-request-payer");
  if (isBillingField(key)) return byTestId(scope, "lead-request-billing");
  return null;
}

/**
 * The element a link points to: the field (inside the section when one is
 * named; a follow-up key `<block>:<key>` inside its block), else the section
 * or block. `null` while the step has not rendered it yet.
 */
export function findCabinetTarget(target: CabinetTarget, root: ParentNode = document): FoundCabinetTarget | null {
  const section = target.anchor ? byId(root, target.anchor) : null;
  if (target.field) {
    const [block, key] = target.field.includes(":") ? target.field.split(":", 2) : [null, target.field];
    const blockElement = block && SAFE_KEY.test(block) ? byTestId(root, `lead-request-follow-up-${block}`) : null;
    const scope = blockElement ?? section ?? root;
    const field = fieldElement(scope, key) ?? (scope !== root ? fieldElement(root, key) : null);
    if (field) return { element: field, field: true };
    if (blockElement) return { element: blockElement, field: false };
  }
  return section ? { element: section, field: false } : null;
}

/**
 * Brings the element into view. A field also gets the cursor in its first
 * control, so the person can type at once, and a short ring shows where the
 * link led; a section starts at the top of the screen.
 */
export function revealCabinetTarget({ element, field }: FoundCabinetTarget) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView?.({ block: field ? "center" : "start", behavior: reduced ? "auto" : "smooth" });
  if (!field) return;
  const control = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
  control?.focus({ preventScroll: true });
  element.classList.add(...RING);
  window.setTimeout(() => element.classList.remove(...RING), 1600);
}
