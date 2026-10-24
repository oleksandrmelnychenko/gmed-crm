import type { LeadRequest } from "./lead-request-api";
import { isBillingField } from "./lead-request-billing-model";
import { draftFromRecipient, flowOf, isRecipientField, recipientFieldOf } from "./lead-request-recipient-model";
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

/**
 * Block R names a representative's answer as `representative:<id>:<field>`;
 * the input of that answer has the id `representative-<id>-<field>`
 * (`RepresentativeQuestionsBlock`). Null for any other key.
 */
export function representativeQuestionId(key: string): { id: string; person: string } | null {
  if (!key.startsWith("representative:")) return null;
  const [, person, field, ...rest] = key.split(":");
  if (!person || !field || rest.length > 0 || !SAFE_KEY.test(person) || !SAFE_KEY.test(field)) return null;
  return { id: `representative-${person}-${field}`, person };
}

/**
 * The recipient's field that answers a payer key when the invoice recipient
 * is the payer: the server lists `payer_email`, the form shows the recipient's
 * e-mail (`recipient_email`); null for a key the recipient has no field for.
 */
export function recipientKeyOfPayerKey(key: string): string | null {
  if (!key.startsWith("payer_")) return null;
  const field = key.slice("payer_".length);
  return recipientFieldOf(`recipient_${field}`) ? `recipient_${field}` : null;
}

/** Whether the invoice recipient of the request is a third party who pays (step 3). */
export function recipientIsPayer(request: Pick<LeadRequest, "billing">): boolean {
  const flow = flowOf(draftFromRecipient(request.billing));
  return flow.recipient === "third_party" && flow.isPayer === "yes";
}

/**
 * The keys a step's missing list marks at the fields: each key itself and,
 * when the recipient pays, the recipient's field for a payer key.
 */
export function missingFieldKeys(keys: readonly string[], recipientPays: boolean): Set<string> {
  const result = new Set<string>();
  for (const key of keys) {
    result.add(key);
    const twin = recipientPays ? recipientKeyOfPayerKey(key) : null;
    if (twin) result.add(twin);
  }
  return result;
}

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
  // Block R: a representative's answer, else the person's box.
  const representativeQuestion = representativeQuestionId(key);
  if (representativeQuestion) {
    return byId(scope, representativeQuestion.id) ?? byTestId(scope, `lead-request-representative-questions-${representativeQuestion.person}`);
  }
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
  // The recipient who pays answers the payer's e-mail, phone or residence in the recipient's fields.
  const recipientTwin = recipientKeyOfPayerKey(key);
  const twinElement = recipientTwin ? byId(scope, `lead-request-${recipientTwin}`) : null;
  if (twinElement) return twinElement;
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
    // Only the first colon separates the block: block R's keys carry colons of their own.
    const colon = target.field.indexOf(":");
    const [block, key] = colon >= 0 ? [target.field.slice(0, colon), target.field.slice(colon + 1)] : [null, target.field];
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
