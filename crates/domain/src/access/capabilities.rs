//! Capability registry: the screen/button-level permission model.
//!
//! A capability answers "may this role open this module or press this
//! button". Row-level questions ("may this role see *this* record") stay with
//! [`crate::access::policy`], assignments and share status.
//!
//! The role → capability table below is the code form of the product matrix
//! in `docs/backlog/02_rbac-matrix_ua.md` and the target cabinets in
//! `docs/role-cabinets-plan-2026-09-20_ua.md` (section 2). A rendered snapshot
//! lives in `docs/backlog/02_rbac-capability-snapshot.md` and is pinned by a
//! test so the code and the documentation cannot drift apart silently.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::role::Role;

macro_rules! capabilities {
    ($( $variant:ident => $name:literal ),+ $(,)?) => {
        /// A screen- or action-level permission with a stable wire name.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        #[non_exhaustive]
        pub enum Capability {
            $( $variant, )+
        }

        impl Capability {
            /// Every capability, in registry order.
            pub const ALL: &'static [Capability] = &[ $( Capability::$variant, )+ ];

            /// Stable snake_case wire name (`module.action`).
            pub const fn as_str(self) -> &'static str {
                match self {
                    $( Capability::$variant => $name, )+
                }
            }
        }

        impl FromStr for Capability {
            type Err = UnknownCapability;

            fn from_str(value: &str) -> Result<Self, Self::Err> {
                match value {
                    $( $name => Ok(Capability::$variant), )+
                    _ => Err(UnknownCapability(value.to_string())),
                }
            }
        }
    };
}

capabilities! {
    // Patients
    PatientsView => "patients.view",
    PatientsEdit => "patients.edit",
    PatientsAssign => "patients.assign",
    PatientsMedicalView => "patients.medical.view",
    PatientsMedicalEdit => "patients.medical.edit",
    // Leads
    LeadsView => "leads.view",
    LeadsEdit => "leads.edit",
    LeadsConvert => "leads.convert",
    // Orders
    OrdersView => "orders.view",
    OrdersEdit => "orders.edit",
    OrdersEconomics => "orders.economics",
    // Contracts and quotes
    ContractsView => "contracts.view",
    ContractsEdit => "contracts.edit",
    ContractsTerminate => "contracts.terminate",
    // Invoices and payments
    InvoicesView => "invoices.view",
    InvoicesCreate => "invoices.create",
    InvoicesFinance => "invoices.finance",
    InvoicesVisibility => "invoices.visibility",
    AccountingView => "accounting.view",
    // Company finance and price catalog
    CompanyFinanceView => "company_finance.view",
    CompanyFinanceEdit => "company_finance.edit",
    // Documents
    DocumentsView => "documents.view",
    DocumentsUpload => "documents.upload",
    DocumentsManage => "documents.manage",
    DocumentsIntake => "documents.intake",
    DocumentsTranslate => "documents.translate",
    // Appointments
    AppointmentsView => "appointments.view",
    AppointmentsEdit => "appointments.edit",
    AppointmentsDelete => "appointments.delete",
    AppointmentsStatus => "appointments.status",
    AppointmentsAssignInterpreter => "appointments.assign_interpreter",
    AppointmentsReportSubmit => "appointments.report.submit",
    AppointmentsReportApprove => "appointments.report.approve",
    // Providers and clinics
    ProvidersView => "providers.view",
    ProvidersEdit => "providers.edit",
    ProvidersRegistry => "providers.registry",
    // Concierge services and hotels
    ServicesView => "services.view",
    ServicesEdit => "services.edit",
    HotelsView => "hotels.view",
    HotelsEdit => "hotels.edit",
    // Interpreters: profiles, reports and hours
    InterpretersView => "interpreters.view",
    InterpretersManage => "interpreters.manage",
    InterpretersHoursSubmit => "interpreters.hours.submit",
    InterpretersHoursApprove => "interpreters.hours.approve",
    // SOP / learning
    SopsView => "sops.view",
    SopsCreate => "sops.create",
    SopsReview => "sops.review",
    // Feedback and risk
    FeedbackView => "feedback.view",
    FeedbackCapture => "feedback.capture",
    // Reports and KPI
    ReportsView => "reports.view",
    ReportsFinance => "reports.finance",
    ReportsMarket => "reports.market",
    // Task manager and chat
    TasksUse => "tasks.use",
    TasksAssignAny => "tasks.assign_any",
    ChatUse => "chat.use",
    // Users and roles
    UsersView => "users.view",
    UsersManage => "users.manage",
    UsersManageCeo => "users.manage_ceo",
    // Technical administration
    AdminSettings => "admin.settings",
    AdminSecurity => "admin.security",
    AdminSessions => "admin.sessions",
    AdminSignatures => "admin.signatures",
    AdminNotifications => "admin.notifications",
    AdminAnnouncements => "admin.announcements",
    AdminCustomFields => "admin.custom_fields",
    AdminCompliance => "admin.compliance",
    AdminHealth => "admin.health",
    AdminActivity => "admin.activity",
    // DATEV
    DatevAdmin => "datev.admin",
    DatevRead => "datev.read",
    // Security incidents
    IncidentsManage => "incidents.manage",
}

/// Returned when a wire name does not match any registered capability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownCapability(pub String);

impl fmt::Display for UnknownCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown capability `{}`", self.0)
    }
}

impl std::error::Error for UnknownCapability {}

impl fmt::Display for Capability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for Capability {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Capability {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

impl Capability {
    /// Module prefix of the wire name (`patients` for `patients.medical.view`).
    pub fn module(self) -> &'static str {
        self.as_str().split('.').next().unwrap_or_default()
    }

    /// Whether the capability grants a change rather than a view.
    pub fn is_write(self) -> bool {
        matches!(
            self.as_str().rsplit('.').next().unwrap_or_default(),
            "edit"
                | "create"
                | "manage"
                | "manage_ceo"
                | "finance"
                | "visibility"
                | "upload"
                | "intake"
                | "translate"
                | "delete"
                | "status"
                | "assign"
                | "assign_interpreter"
                | "assign_any"
                | "submit"
                | "approve"
                | "review"
                | "capture"
                | "registry"
                | "convert"
                | "admin"
        )
    }
}

use Capability as C;

const CEO_ASSISTANT: &[Capability] = &[
    C::PatientsView,
    C::PatientsMedicalView,
    C::LeadsView,
    C::OrdersView,
    C::ContractsView,
    C::InvoicesView,
    C::AccountingView,
    C::CompanyFinanceView,
    C::DocumentsView,
    C::AppointmentsView,
    C::ProvidersView,
    C::ServicesView,
    C::HotelsView,
    C::SopsView,
    C::FeedbackView,
    C::ReportsView,
    C::TasksUse,
    C::ChatUse,
];

const PATIENT_MANAGER: &[Capability] = &[
    C::PatientsView,
    C::PatientsEdit,
    C::PatientsAssign,
    C::PatientsMedicalView,
    C::PatientsMedicalEdit,
    C::LeadsView,
    C::LeadsEdit,
    C::LeadsConvert,
    C::OrdersView,
    C::OrdersEdit,
    C::OrdersEconomics,
    C::ContractsView,
    C::ContractsEdit,
    C::ContractsTerminate,
    C::InvoicesView,
    C::InvoicesCreate,
    C::DocumentsView,
    C::DocumentsUpload,
    C::DocumentsManage,
    C::DocumentsIntake,
    C::DocumentsTranslate,
    C::AppointmentsView,
    C::AppointmentsEdit,
    C::AppointmentsDelete,
    C::AppointmentsStatus,
    C::AppointmentsAssignInterpreter,
    C::AppointmentsReportApprove,
    C::ProvidersView,
    C::ProvidersEdit,
    C::ProvidersRegistry,
    C::ServicesView,
    C::ServicesEdit,
    C::HotelsView,
    C::HotelsEdit,
    C::InterpretersView,
    C::SopsView,
    C::SopsCreate,
    C::SopsReview,
    C::FeedbackView,
    C::FeedbackCapture,
    C::ReportsView,
    C::TasksUse,
    C::ChatUse,
];

const INTERPRETER: &[Capability] = &[
    C::PatientsView,
    C::PatientsMedicalView,
    C::DocumentsView,
    C::DocumentsUpload,
    C::AppointmentsView,
    C::AppointmentsReportSubmit,
    C::ProvidersView,
    C::InterpretersHoursSubmit,
    C::SopsView,
    C::TasksUse,
    C::ChatUse,
];

const TEAMLEAD_INTERPRETER: &[Capability] = &[
    C::PatientsView,
    C::PatientsMedicalView,
    C::DocumentsView,
    C::DocumentsUpload,
    C::AppointmentsView,
    C::AppointmentsEdit,
    C::AppointmentsAssignInterpreter,
    C::AppointmentsReportSubmit,
    C::AppointmentsReportApprove,
    C::ProvidersView,
    C::InterpretersView,
    C::InterpretersManage,
    C::InterpretersHoursSubmit,
    C::InterpretersHoursApprove,
    C::SopsView,
    C::SopsCreate,
    C::FeedbackView,
    C::TasksUse,
    C::ChatUse,
];

const CONCIERGE: &[Capability] = &[
    C::PatientsView,
    C::LeadsView,
    C::DocumentsView,
    C::DocumentsUpload,
    C::AppointmentsView,
    C::AppointmentsEdit,
    C::ProvidersView,
    C::ProvidersEdit,
    C::ServicesView,
    C::ServicesEdit,
    C::HotelsView,
    C::HotelsEdit,
    C::SopsView,
    C::FeedbackView,
    C::TasksUse,
    C::ChatUse,
];

const BILLING: &[Capability] = &[
    C::PatientsView,
    C::OrdersView,
    C::OrdersEconomics,
    C::ContractsView,
    C::ContractsEdit,
    C::InvoicesView,
    C::InvoicesCreate,
    C::InvoicesFinance,
    C::InvoicesVisibility,
    C::AccountingView,
    C::CompanyFinanceView,
    C::CompanyFinanceEdit,
    C::DocumentsView,
    C::ProvidersView,
    C::ServicesView,
    C::HotelsView,
    C::SopsView,
    C::ReportsView,
    C::ReportsFinance,
    C::DatevRead,
    C::TasksUse,
    C::ChatUse,
];

const SALES: &[Capability] = &[
    C::LeadsView,
    C::LeadsEdit,
    C::ProvidersView,
    C::SopsView,
    C::ReportsView,
    C::ReportsMarket,
    C::TasksUse,
    C::ChatUse,
];

const IT_ADMIN: &[Capability] = &[
    C::SopsView,
    C::UsersView,
    C::UsersManage,
    C::AdminSettings,
    C::AdminSecurity,
    C::AdminSessions,
    C::AdminSignatures,
    C::AdminNotifications,
    C::AdminAnnouncements,
    C::AdminCustomFields,
    C::AdminCompliance,
    C::AdminHealth,
    C::AdminActivity,
    C::DatevAdmin,
    C::IncidentsManage,
];

impl Role {
    /// Capabilities granted to the role by the product matrix.
    ///
    /// The CEO holds every capability; the patient portal holds none (its
    /// access is modelled through share status and ownership instead).
    pub fn capabilities(self) -> &'static [Capability] {
        match self {
            Role::Ceo => Capability::ALL,
            Role::CeoAssistant => CEO_ASSISTANT,
            Role::PatientManager => PATIENT_MANAGER,
            Role::TeamleadInterpreter => TEAMLEAD_INTERPRETER,
            Role::Interpreter => INTERPRETER,
            Role::Concierge => CONCIERGE,
            Role::Billing => BILLING,
            Role::Sales => SALES,
            Role::ItAdmin => IT_ADMIN,
            Role::Patient => &[],
        }
    }

    /// Whether the role holds `capability`.
    pub fn can(self, capability: Capability) -> bool {
        self.capabilities().contains(&capability)
    }

    /// Whether the role holds at least one of `capabilities`.
    pub fn can_any(self, capabilities: &[Capability]) -> bool {
        capabilities.iter().any(|capability| self.can(*capability))
    }
}

/// Staff roles in matrix order (the patient portal is not a cabinet).
pub const STAFF_ROLES: &[Role] = &[
    Role::Ceo,
    Role::CeoAssistant,
    Role::PatientManager,
    Role::TeamleadInterpreter,
    Role::Interpreter,
    Role::Concierge,
    Role::Billing,
    Role::Sales,
    Role::ItAdmin,
];

fn role_code(role: Role) -> &'static str {
    match role {
        Role::Ceo => "ceo",
        Role::CeoAssistant => "ceo_assistant",
        Role::PatientManager => "patient_manager",
        Role::TeamleadInterpreter => "teamlead_interpreter",
        Role::Interpreter => "interpreter",
        Role::Concierge => "concierge",
        Role::Billing => "billing",
        Role::Sales => "sales",
        Role::ItAdmin => "it_admin",
        Role::Patient => "patient",
    }
}

/// Renders the role × capability table as Markdown. This is the exact content
/// of `docs/backlog/02_rbac-capability-snapshot.md`.
pub fn render_snapshot() -> String {
    let mut out = String::new();
    out.push_str("# RBAC capability snapshot\n\n");
    out.push_str(
        "> Generated from `crates/domain/src/access/capabilities.rs`. Do not edit by hand:\n",
    );
    out.push_str(
        "> run `cargo test -p gmed-domain regenerate_rbac_capability_snapshot -- --ignored`\n",
    );
    out.push_str("> after changing the registry. The test `rbac_capability_snapshot_is_current`\n");
    out.push_str("> fails when this file and the code disagree.\n\n");
    out.push_str("| Capability |");
    for role in STAFF_ROLES {
        out.push(' ');
        out.push_str(role_code(*role));
        out.push_str(" |");
    }
    out.push_str("\n|---|");
    for _ in STAFF_ROLES {
        out.push_str(":---:|");
    }
    out.push('\n');
    for capability in Capability::ALL {
        out.push_str("| `");
        out.push_str(capability.as_str());
        out.push_str("` |");
        for role in STAFF_ROLES {
            out.push_str(if role.can(*capability) {
                " x |"
            } else {
                "   |"
            });
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const SNAPSHOT_PATH: &str = "docs/backlog/02_rbac-capability-snapshot.md";
    const SNAPSHOT: &str = include_str!("../../../../docs/backlog/02_rbac-capability-snapshot.md");

    fn set(role: Role) -> BTreeSet<Capability> {
        role.capabilities().iter().copied().collect()
    }

    fn names(role: Role) -> Vec<&'static str> {
        role.capabilities().iter().map(|c| c.as_str()).collect()
    }

    #[test]
    fn wire_names_are_unique_snake_case_and_roundtrip() {
        let mut seen = BTreeSet::new();
        for capability in Capability::ALL {
            let name = capability.as_str();
            assert!(seen.insert(name), "duplicate capability name {name}");
            assert!(
                name.chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch == '.' || ch == '_'),
                "{name} is not snake_case"
            );
            assert!(name.contains('.'), "{name} needs a module prefix");
            assert_eq!(name.parse::<Capability>().unwrap(), *capability);
            let json = serde_json::to_string(capability).unwrap();
            assert_eq!(json, format!("\"{name}\""));
            let back: Capability = serde_json::from_str(&json).unwrap();
            assert_eq!(back, *capability);
        }
        assert!("patients.fly".parse::<Capability>().is_err());
    }

    #[test]
    fn role_sets_have_no_duplicates() {
        for role in STAFF_ROLES {
            assert_eq!(
                set(*role).len(),
                role.capabilities().len(),
                "{role:?} lists a capability twice"
            );
        }
        assert!(Role::Patient.capabilities().is_empty());
    }

    #[test]
    fn ceo_holds_every_capability() {
        let ceo = set(Role::Ceo);
        assert_eq!(ceo.len(), Capability::ALL.len());
        for role in STAFF_ROLES {
            assert!(
                set(*role).is_subset(&ceo),
                "{role:?} holds a capability the CEO lacks"
            );
        }
    }

    #[test]
    fn it_admin_has_no_patient_medical_or_financial_capability() {
        for capability in Role::ItAdmin.capabilities() {
            let module = capability.module();
            assert!(
                matches!(module, "users" | "admin" | "datev" | "incidents" | "sops"),
                "it_admin must stay technical, found {capability}"
            );
            assert_ne!(*capability, C::DatevRead);
            assert_ne!(*capability, C::UsersManageCeo);
        }
        assert!(!Role::ItAdmin.can(C::PatientsView));
        assert!(!Role::ItAdmin.can(C::ChatUse));
        assert!(!Role::ItAdmin.can(C::TasksUse));
        assert!(!Role::ItAdmin.can(C::AppointmentsView));
        assert!(!Role::ItAdmin.can(C::DocumentsView));
        assert!(Role::ItAdmin.can(C::UsersManage));
        assert!(Role::ItAdmin.can(C::AdminSecurity));
    }

    #[test]
    fn ceo_assistant_is_read_only() {
        for capability in Role::CeoAssistant.capabilities() {
            assert!(
                !capability.is_write(),
                "ceo_assistant must be read-only, found {capability}"
            );
        }
        assert!(Role::CeoAssistant.can(C::TasksUse));
        assert!(Role::CeoAssistant.can(C::ChatUse));
        assert!(Role::CeoAssistant.can(C::AppointmentsView));
        assert!(!Role::CeoAssistant.can(C::UsersView));
    }

    #[test]
    fn only_ceo_manages_ceo_accounts_and_assigns_any_task() {
        for role in STAFF_ROLES {
            assert_eq!(role.can(C::UsersManageCeo), *role == Role::Ceo, "{role:?}");
            assert_eq!(role.can(C::TasksAssignAny), *role == Role::Ceo, "{role:?}");
            assert_eq!(
                role.can(C::PatientsAssign),
                matches!(role, Role::Ceo | Role::PatientManager),
                "{role:?}"
            );
        }
    }

    #[test]
    fn role_sets_match_the_product_matrix() {
        let expected: &[(Role, &[&str])] = &[
            (
                Role::CeoAssistant,
                &[
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
                ],
            ),
            (
                Role::Sales,
                &[
                    "leads.view",
                    "leads.edit",
                    "providers.view",
                    "sops.view",
                    "reports.view",
                    "reports.market",
                    "tasks.use",
                    "chat.use",
                ],
            ),
            (
                Role::ItAdmin,
                &[
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
                ],
            ),
            (
                Role::Interpreter,
                &[
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
                ],
            ),
            (
                Role::TeamleadInterpreter,
                &[
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
                ],
            ),
            (
                Role::Concierge,
                &[
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
                ],
            ),
            (
                Role::Billing,
                &[
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
                ],
            ),
            (
                Role::PatientManager,
                &[
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
                    "contracts.terminate",
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
                ],
            ),
            (Role::Patient, &[]),
        ];
        for (role, expected_names) in expected {
            assert_eq!(&names(*role), expected_names, "{role:?}");
        }
    }

    #[test]
    fn legacy_role_predicates_agree_with_capabilities() {
        for role in STAFF_ROLES {
            assert_eq!(role.has_full_access(), *role == Role::Ceo);
            assert_eq!(
                role.can_see_financial_data(),
                role.can_any(&[C::InvoicesView, C::AccountingView, C::CompanyFinanceView]),
                "{role:?} financial predicate drifted from capabilities"
            );
            assert_eq!(
                role.can_see_medical_data(),
                role.can(C::PatientsMedicalView),
                "{role:?} medical predicate drifted from capabilities"
            );
        }
    }

    #[test]
    fn rbac_capability_snapshot_is_current() {
        let rendered = render_snapshot();
        if SNAPSHOT.replace("\r\n", "\n") == rendered {
            return;
        }
        let mut report = format!("{SNAPSHOT_PATH} is out of date with the capability registry.\n");
        report.push_str(
            "Regenerate it with: cargo test -p gmed-domain regenerate_rbac_capability_snapshot -- --ignored\n\n",
        );
        for (line_no, (expected, actual)) in rendered
            .lines()
            .zip(SNAPSHOT.lines())
            .enumerate()
            .filter(|(_, (expected, actual))| expected != actual)
            .take(20)
        {
            report.push_str(&format!(
                "line {}:\n- {actual}\n+ {expected}\n",
                line_no + 1
            ));
        }
        panic!("{report}");
    }

    /// Rewrites the Markdown snapshot from the registry. Ignored by default so
    /// the ordinary test run never touches the working tree.
    #[test]
    #[ignore]
    fn regenerate_rbac_capability_snapshot() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(SNAPSHOT_PATH);
        std::fs::write(&path, render_snapshot()).expect("write snapshot");
    }
}
