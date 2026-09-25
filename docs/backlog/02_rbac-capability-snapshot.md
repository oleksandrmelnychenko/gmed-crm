# RBAC capability snapshot

> Generated from `crates/domain/src/access/capabilities.rs`. Do not edit by hand:
> run `cargo test -p gmed-domain regenerate_rbac_capability_snapshot -- --ignored`
> after changing the registry. The test `rbac_capability_snapshot_is_current`
> fails when this file and the code disagree.

| Capability | ceo | ceo_assistant | patient_manager | teamlead_interpreter | interpreter | concierge | billing | sales | it_admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `patients.view` | x | x | x | x | x | x | x |   |   |
| `patients.edit` | x |   | x |   |   |   |   |   |   |
| `patients.assign` | x |   | x |   |   |   |   |   |   |
| `patients.medical.view` | x | x | x | x | x |   |   |   |   |
| `patients.medical.edit` | x |   | x |   |   |   |   |   |   |
| `leads.view` | x | x | x |   |   | x |   | x |   |
| `leads.edit` | x |   | x |   |   |   |   | x |   |
| `leads.convert` | x |   | x |   |   |   |   |   |   |
| `orders.view` | x | x | x |   |   |   | x |   |   |
| `orders.edit` | x |   | x |   |   |   |   |   |   |
| `orders.economics` | x |   | x |   |   |   | x |   |   |
| `contracts.view` | x | x | x |   |   |   | x |   |   |
| `contracts.edit` | x |   | x |   |   |   | x |   |   |
| `contracts.terminate` | x |   | x |   |   |   |   |   |   |
| `invoices.view` | x | x | x |   |   |   | x |   |   |
| `invoices.create` | x |   | x |   |   |   | x |   |   |
| `invoices.finance` | x |   |   |   |   |   | x |   |   |
| `invoices.visibility` | x |   |   |   |   |   | x |   |   |
| `accounting.view` | x | x |   |   |   |   | x |   |   |
| `company_finance.view` | x | x |   |   |   |   | x |   |   |
| `company_finance.edit` | x |   |   |   |   |   | x |   |   |
| `documents.view` | x | x | x | x | x | x | x |   |   |
| `documents.upload` | x |   | x | x | x | x |   |   |   |
| `documents.manage` | x |   | x |   |   |   |   |   |   |
| `documents.intake` | x |   | x |   |   |   |   |   |   |
| `documents.translate` | x |   | x |   |   |   |   |   |   |
| `documents.shares.view` | x |   | x | x |   |   |   |   |   |
| `appointments.view` | x | x | x | x | x | x |   |   |   |
| `appointments.edit` | x |   | x | x |   | x |   |   |   |
| `appointments.delete` | x |   | x |   |   |   |   |   |   |
| `appointments.status` | x |   | x |   |   |   |   |   |   |
| `appointments.assign_interpreter` | x |   | x | x |   |   |   |   |   |
| `appointments.report.submit` | x |   |   | x | x |   |   |   |   |
| `appointments.report.approve` | x |   | x | x |   |   |   |   |   |
| `providers.view` | x | x | x | x | x | x | x | x |   |
| `providers.edit` | x |   | x |   |   | x |   |   |   |
| `providers.registry` | x |   | x |   |   |   |   |   |   |
| `services.view` | x | x | x |   |   | x | x |   |   |
| `services.edit` | x |   | x |   |   | x |   |   |   |
| `hotels.view` | x | x | x |   |   | x | x |   |   |
| `hotels.edit` | x |   | x |   |   | x |   |   |   |
| `interpreters.view` | x |   | x | x |   |   |   |   |   |
| `interpreters.manage` | x |   |   | x |   |   |   |   |   |
| `interpreters.hours.submit` | x |   |   | x | x |   |   |   |   |
| `interpreters.hours.approve` | x |   |   | x |   |   |   |   |   |
| `sops.view` | x | x | x | x | x | x | x | x | x |
| `sops.create` | x |   | x | x |   |   |   |   |   |
| `sops.review` | x |   | x |   |   |   |   |   |   |
| `feedback.view` | x | x | x | x |   | x |   |   |   |
| `feedback.capture` | x |   | x |   |   |   |   |   |   |
| `reports.view` | x | x | x |   |   |   | x | x |   |
| `reports.finance` | x |   |   |   |   |   | x |   |   |
| `reports.market` | x |   |   |   |   |   |   | x |   |
| `tasks.use` | x | x | x | x | x | x | x | x |   |
| `tasks.assign_any` | x |   |   |   |   |   |   |   |   |
| `chat.use` | x | x | x | x | x | x | x | x |   |
| `users.view` | x |   |   |   |   |   |   |   | x |
| `users.manage` | x |   |   |   |   |   |   |   | x |
| `users.manage_ceo` | x |   |   |   |   |   |   |   |   |
| `admin.settings` | x |   |   |   |   |   |   |   | x |
| `admin.security` | x |   |   |   |   |   |   |   | x |
| `admin.sessions` | x |   |   |   |   |   |   |   | x |
| `admin.signatures` | x |   |   |   |   |   |   |   | x |
| `admin.notifications` | x |   |   |   |   |   |   |   | x |
| `admin.announcements` | x |   |   |   |   |   |   |   | x |
| `admin.custom_fields` | x |   |   |   |   |   |   |   | x |
| `admin.compliance` | x |   |   |   |   |   |   |   | x |
| `admin.health` | x |   |   |   |   |   |   |   | x |
| `admin.activity` | x |   |   |   |   |   |   |   | x |
| `datev.admin` | x |   |   |   |   |   |   |   | x |
| `datev.read` | x |   |   |   |   |   | x |   |   |
| `incidents.manage` | x |   |   |   |   |   |   |   | x |
