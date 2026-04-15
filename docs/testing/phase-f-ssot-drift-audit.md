# Phase F — SSOT Drift Audit (frontend route guard ↔ backend role gates)

> Status: **post-tightening snapshot** (2026-04-15). Cross-references `frontend/src/lib/staff-route-access.ts` against `crates/server/src/routes/*.rs` `require_any_role(&[...])` calls in the canonical "list/index" handler each page hits on mount.
>
> Sources: see [ui-rbac-route-guard-plan_ua.md](ui-rbac-route-guard-plan_ua.md) Phase F.

## Drift table

| FE path | FE roles | BE handler | BE roles | Drift | Action |
|---|---|---|---|---|---|
| `/` | ALL_STAFF_ROLES (9) | (no canonical call) | — | Skip | — |
| `/admin` | ROLES_ADMIN (3) | (admin hub) | — | Skip | — |
| `/admin/access` | it_admin | `access_policies::list_policies` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/activity` | it_admin | `admin_settings::list_activity` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/announcements` | it_admin | `announcements::list_all` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/compliance` | ceo, patient_manager | `admin_compliance::consent_dashboard` | ceo, patient_manager | OK | ✅ closed: dropped it_admin from `ROLES_COMPLIANCE` |
| `/admin/custom-fields` | it_admin, patient_manager, sales | `custom_fields::list_fields` | it_admin, patient_manager, sales | OK | ✅ closed: aligned FE to canonical list_fields scope |
| `/admin/health` | it_admin | `admin_security::system_health` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/notifications` | it_admin | `notifications::list_channels` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/security` | it_admin | `admin_security::list_ips` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/settings` | it_admin | `admin_settings::list_settings` | it_admin | OK | ✅ closed: tightened FE fallback/admin rule set |
| `/admin/users` | ceo, it_admin | `users::list_users` | ceo, it_admin | OK | ✅ closed: added `/admin/users` rule with `ROLES_ADMIN_USERS` (drops ceo_assistant) |
| `/appointments` | ROLES_APPOINTMENTS (5) | `appointments::list_appointments` | ceo, patient_manager, teamlead_interpreter, interpreter, concierge | OK | — |
| `/cases` | ceo, patient_manager | `cases::list_cases` | ceo, patient_manager | OK | ✅ closed: FE now uses `ROLES_CASES = {ceo, patient_manager}` |
| `/chat` | ROLES_CHAT (8) | `messages::list_conversations` | ceo, ceo_assistant, patient_manager, teamlead_interpreter, interpreter, concierge, billing, it_admin | OK | — |
| `/contracts` | ROLES_CONTRACTS_INVOICES (4) | `contracts::list_framework_contracts` | ceo, ceo_assistant, patient_manager, billing | OK | — |
| `/documents` | ROLES_DOCUMENTS (7) | `documents::list_documents` | ceo, ceo_assistant, patient_manager, teamlead_interpreter, interpreter, concierge, billing | OK | — |
| `/feedback` | ROLES_FEEDBACK (5) | `feedback::list_feedback` | ceo, ceo_assistant, patient_manager, teamlead_interpreter, concierge | OK | — |
| `/invoices` | ROLES_CONTRACTS_INVOICES (4) | `invoices::list_invoices` | ceo, ceo_assistant, patient_manager, billing | OK | — |
| `/leads` | patient_manager, sales | `leads::list_leads` | patient_manager, sales | OK | ✅ closed: FE now uses `ROLES_LEADS = {patient_manager, sales}` |
| `/orders` | patient_manager, billing | `orders::list_orders` | patient_manager, billing | OK | ✅ closed: FE now uses `ROLES_ORDERS = {patient_manager, billing}` |
| `/patients` | ceo, ceo_assistant, patient_manager, billing, teamlead_interpreter, interpreter, concierge | `patients::list_patients` | ceo, ceo_assistant, patient_manager, billing, teamlead_interpreter, interpreter, concierge | OK | ✅ closed: FE now uses `ROLES_PATIENTS` matching BE allow list |
| `/privacy` | ALL_STAFF_ROLES (9) | `me::create_my_privacy_request` (patient-scoped) | — | Skip | Patient-only endpoint; staff page is informational |
| `/providers` | ceo, patient_manager, concierge, billing, sales | `providers::list_providers` | ceo, patient_manager, concierge, billing, sales | OK | ✅ closed: FE now uses `ROLES_PROVIDERS` matching BE allow list |
| `/reports` | ROLES_REPORTS (5) | `stats::reports_workspace` | ceo, ceo_assistant, patient_manager, billing, sales | OK | — |
| `/services` | ceo, patient_manager, concierge, billing | `concierge_services::list_concierge_services` | ceo, patient_manager, concierge, billing | OK | ✅ closed: FE now uses `ROLES_SERVICES = {ceo, patient_manager, concierge, billing}` |
| `/sops` | ALL_STAFF_ROLES (9) | `sops::list_sops` | ALL_STAFF_ROLES | OK | — |

## Legend

- **A** = FE allows roles that BE rejects (UI lets users navigate to a page they cannot use → 403 on first call)
- **B** = BE allows roles that FE blocks (UI redirects users away from a page they could use)
- **OK** = sets match exactly
- **Skip** = no canonical backend list call (pure local UI or patient-scoped endpoint)

## Closed in the route-guard tightening pass

The original six high-impact Drift A entries are now closed in frontend route access:

1. `/leads` — `ROLES_LEADS = {patient_manager, sales}`
2. `/cases` — `ROLES_CASES = {ceo, patient_manager}`
3. `/services` — `ROLES_SERVICES = {ceo, patient_manager, concierge, billing}`
4. `/providers` — `ROLES_PROVIDERS = {ceo, patient_manager, concierge, billing, sales}`
5. `/orders` — `ROLES_ORDERS = {patient_manager, billing}`
6. `/patients` — `ROLES_PATIENTS = {ceo, ceo_assistant, patient_manager, billing, teamlead_interpreter, interpreter, concierge}`

## Deferred (separate product calls)

- `/admin` hub/root — still treated as generic `it_admin`-only fallback in FE route rules because there is no dedicated mounted hub page. If a real admin landing page is added later, its canonical backend scope should be documented explicitly.

## Closed in earlier passes

- `/admin/compliance` — closed: tightened to `{ceo, patient_manager}` matching `admin_compliance::consent_dashboard` allow list.
- `/admin/users` — closed: added specific rule with `ROLES_ADMIN_USERS = {ceo, it_admin}` matching `users::list_users` allow list.
- `/admin/access`, `/admin/activity`, `/admin/announcements`, `/admin/health`, `/admin/notifications`, `/admin/security`, `/admin/settings` — closed: FE now matches `it_admin`-only canonical handlers.
- `/admin/custom-fields` — closed: FE now matches `{it_admin, patient_manager, sales}` canonical handler scope.

## Regression status after tightening

- `frontend/src/lib/staff-route-access.test.ts` covers the tightened route constants and `canAccessStaffRoute` / `peekStaffRouteRule` behavior.
- `frontend/src/lib/staff-navigation-guard.integration.test.ts` and `frontend/src/lib/staff-spa-navigation-script.unit.test.ts` keep the route-guard contract and navigation restrictions from drifting.
- Live/browser RBAC coverage is tracked in [04_rbac-e2e-test-plan_ua.md](04_rbac-e2e-test-plan_ua.md); the route-guard pass is no longer waiting on the six staff workspace tightenings above.
- Browser verification for this route-guard layer is green on the current freeze slice, including denied-route live Playwright coverage and full browser suite passes.
