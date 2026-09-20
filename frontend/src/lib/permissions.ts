/**
 * Capabilities: the screen/button-level permission model shared with the
 * server (`crates/domain/src/access/capabilities.rs`).
 *
 * `GET /me` returns the signed-in user's capabilities; the table below is a
 * mirror of the server registry used when a caller only knows the role (route
 * rules evaluated in tests, sessions restored before `/me` answered). The test
 * `permissions.test.ts` pins it to `docs/backlog/02_rbac-capability-snapshot.md`.
 */

import { useAuth } from "@/lib/auth";

export type Capability = string;

export const ALL_CAPABILITIES = [
  "patients.view",
  "patients.edit",
  "patients.assign",
  "patients.medical.view",
  "patients.medical.edit",
  "leads.view",
  "leads.edit",
  "leads.convert",
  "orders.view",
  "orders.edit",
  "orders.economics",
  "contracts.view",
  "contracts.edit",
  "invoices.view",
  "invoices.create",
  "invoices.finance",
  "invoices.visibility",
  "accounting.view",
  "company_finance.view",
  "company_finance.edit",
  "documents.view",
  "documents.upload",
  "documents.manage",
  "documents.intake",
  "documents.translate",
  "appointments.view",
  "appointments.edit",
  "appointments.delete",
  "appointments.status",
  "appointments.assign_interpreter",
  "appointments.report.submit",
  "appointments.report.approve",
  "providers.view",
  "providers.edit",
  "providers.registry",
  "services.view",
  "services.edit",
  "hotels.view",
  "hotels.edit",
  "interpreters.view",
  "interpreters.manage",
  "interpreters.hours.submit",
  "interpreters.hours.approve",
  "sops.view",
  "sops.create",
  "sops.review",
  "feedback.view",
  "feedback.capture",
  "reports.view",
  "reports.finance",
  "reports.market",
  "tasks.use",
  "tasks.assign_any",
  "chat.use",
  "users.view",
  "users.manage",
  "users.manage_ceo",
  "admin.settings",
  "admin.security",
  "admin.sessions",
  "admin.signatures",
  "admin.notifications",
  "admin.announcements",
  "admin.custom_fields",
  "admin.compliance",
  "admin.health",
  "admin.activity",
  "datev.admin",
  "datev.read",
  "incidents.manage",
] as const;

export type KnownCapability = (typeof ALL_CAPABILITIES)[number];

const CEO_ASSISTANT: readonly KnownCapability[] = [
  "patients.view",
  "patients.medical.view",
  "leads.view",
  "orders.view",
  "contracts.view",
  "invoices.view",
  "accounting.view",
  "company_finance.view",
  "documents.view",
  "appointments.view",
  "providers.view",
  "services.view",
  "hotels.view",
  "sops.view",
  "feedback.view",
  "reports.view",
  "tasks.use",
  "chat.use",
];

const PATIENT_MANAGER: readonly KnownCapability[] = [
  "patients.view",
  "patients.edit",
  "patients.assign",
  "patients.medical.view",
  "patients.medical.edit",
  "leads.view",
  "leads.edit",
  "leads.convert",
  "orders.view",
  "orders.edit",
  "orders.economics",
  "contracts.view",
  "contracts.edit",
  "invoices.view",
  "invoices.create",
  "documents.view",
  "documents.upload",
  "documents.manage",
  "documents.intake",
  "documents.translate",
  "appointments.view",
  "appointments.edit",
  "appointments.delete",
  "appointments.status",
  "appointments.assign_interpreter",
  "appointments.report.approve",
  "providers.view",
  "providers.edit",
  "providers.registry",
  "services.view",
  "services.edit",
  "hotels.view",
  "hotels.edit",
  "interpreters.view",
  "sops.view",
  "sops.create",
  "sops.review",
  "feedback.view",
  "feedback.capture",
  "reports.view",
  "tasks.use",
  "chat.use",
];

const INTERPRETER: readonly KnownCapability[] = [
  "patients.view",
  "patients.medical.view",
  "documents.view",
  "documents.upload",
  "appointments.view",
  "appointments.report.submit",
  "providers.view",
  "interpreters.hours.submit",
  "sops.view",
  "tasks.use",
  "chat.use",
];

const TEAMLEAD_INTERPRETER: readonly KnownCapability[] = [
  "patients.view",
  "patients.medical.view",
  "documents.view",
  "documents.upload",
  "appointments.view",
  "appointments.edit",
  "appointments.assign_interpreter",
  "appointments.report.submit",
  "appointments.report.approve",
  "providers.view",
  "interpreters.view",
  "interpreters.manage",
  "interpreters.hours.submit",
  "interpreters.hours.approve",
  "sops.view",
  "sops.create",
  "feedback.view",
  "tasks.use",
  "chat.use",
];

const CONCIERGE: readonly KnownCapability[] = [
  "patients.view",
  "leads.view",
  "documents.view",
  "documents.upload",
  "appointments.view",
  "appointments.edit",
  "providers.view",
  "providers.edit",
  "services.view",
  "services.edit",
  "hotels.view",
  "hotels.edit",
  "sops.view",
  "feedback.view",
  "tasks.use",
  "chat.use",
];

const BILLING: readonly KnownCapability[] = [
  "patients.view",
  "orders.view",
  "orders.economics",
  "contracts.view",
  "contracts.edit",
  "invoices.view",
  "invoices.create",
  "invoices.finance",
  "invoices.visibility",
  "accounting.view",
  "company_finance.view",
  "company_finance.edit",
  "documents.view",
  "providers.view",
  "services.view",
  "hotels.view",
  "sops.view",
  "reports.view",
  "reports.finance",
  "datev.read",
  "tasks.use",
  "chat.use",
];

const SALES: readonly KnownCapability[] = [
  "leads.view",
  "leads.edit",
  "providers.view",
  "sops.view",
  "reports.view",
  "reports.market",
  "tasks.use",
  "chat.use",
];

const IT_ADMIN: readonly KnownCapability[] = [
  "sops.view",
  "users.view",
  "users.manage",
  "admin.settings",
  "admin.security",
  "admin.sessions",
  "admin.signatures",
  "admin.notifications",
  "admin.announcements",
  "admin.custom_fields",
  "admin.compliance",
  "admin.health",
  "admin.activity",
  "datev.admin",
  "incidents.manage",
];

/** Mirror of `Role::capabilities()` on the server, by role code. */
export const ROLE_CAPABILITIES: Readonly<Record<string, readonly KnownCapability[]>> = {
  ceo: ALL_CAPABILITIES,
  ceo_assistant: CEO_ASSISTANT,
  patient_manager: PATIENT_MANAGER,
  teamlead_interpreter: TEAMLEAD_INTERPRETER,
  interpreter: INTERPRETER,
  concierge: CONCIERGE,
  billing: BILLING,
  sales: SALES,
  it_admin: IT_ADMIN,
  patient: [],
};

export type CapabilityHolder = {
  role: string;
  capabilities?: readonly string[] | null;
};

/**
 * The capabilities to evaluate for a user: what `/me` reported, or the role
 * mirror when the session has no capability list yet.
 */
export function capabilitiesFor(
  role: string,
  provided?: readonly string[] | null,
): readonly string[] {
  if (provided) {
    return provided;
  }
  return ROLE_CAPABILITIES[role] ?? [];
}

/**
 * Who a permission check is about: the signed-in user (with the `/me`
 * capability list) or a bare role code, which resolves through the mirror.
 */
export type Actor = CapabilityHolder | string | null | undefined;

/** The role code behind `actor` (for assignment hierarchies that stay role-based). */
export function actorRole(actor: Actor): string | undefined {
  if (!actor) {
    return undefined;
  }
  return typeof actor === "string" ? actor : actor.role;
}

function actorCapabilities(actor: Actor): readonly string[] {
  if (!actor) {
    return [];
  }
  if (typeof actor === "string") {
    return capabilitiesFor(actor);
  }
  return capabilitiesFor(actor.role, actor.capabilities);
}

/** Whether `actor` holds `capability`. */
export function hasCapability(actor: Actor, capability: Capability): boolean {
  return actorCapabilities(actor).includes(capability);
}

/** Whether `actor` holds at least one of `capabilities`. */
export function hasAnyCapability(
  actor: Actor,
  capabilities: readonly Capability[],
): boolean {
  const held = actorCapabilities(actor);
  return capabilities.some((capability) => held.includes(capability));
}

/** `true` when the signed-in user holds `capability`. */
export function useCan(capability: Capability): boolean {
  const { user } = useAuth();
  return hasCapability(user, capability);
}
