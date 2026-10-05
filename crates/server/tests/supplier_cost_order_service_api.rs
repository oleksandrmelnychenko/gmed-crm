//! A supplier invoice attributed to an order service that is billed to the
//! patient is GMED's cost of that service. It is never a patient receivable on
//! its own, with or without a manual link to a patient invoice; the patient's
//! figures come from the patient's own invoices. A GMED-paid supplier cost no
//! billed service covers is still re-billed at cost.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap())
        }))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn auth_header(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn money(value: &Value) -> Decimal {
    match value {
        Value::String(text) => text
            .parse::<Decimal>()
            .unwrap_or_else(|_| panic!("money value expected, got {value:?}")),
        Value::Number(number) => number.to_string().parse::<Decimal>().unwrap(),
        other => panic!("money value expected, got {other:?}"),
    }
}

fn euros(value: i64) -> Decimal {
    Decimal::new(value, 0)
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("supplier-cost-{tag}-{role}@example.test"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, name: &str, medical: bool) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, CASE WHEN $2 THEN 'medical' ELSE 'non_medical' END, 'Berlin',
                   CASE WHEN $2 THEN 'Innere Medizin' END, 'Germany')
           RETURNING id"#,
    )
    .bind(name)
    .bind(medical)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[allow(clippy::too_many_arguments)]
async fn seed_service(
    pool: &PgPool,
    order_id: Uuid,
    patient_id: Uuid,
    description: &str,
    unit_price: Decimal,
    is_cost_passthrough: bool,
    status: &str,
) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO order_leistungen (
               order_id, patient_id, description, quantity, unit_price, currency,
               vat_rate, is_cost_passthrough, status, delivered_at
           ) VALUES ($1, $2, $3, 1, $4, 'EUR', 0, $5, $6,
                     CASE WHEN $6 = 'planned' THEN NULL ELSE now() END)
           RETURNING id"#,
    )
    .bind(order_id)
    .bind(patient_id)
    .bind(description)
    .bind(unit_price)
    .bind(is_cost_passthrough)
    .bind(status)
    .fetch_one(pool)
    .await
    .unwrap()
}

struct Fixture {
    app: axum::Router,
    pool: PgPool,
    tag: String,
    patient_id: Uuid,
    contract_id: String,
    order_id: Uuid,
    account_id: Uuid,
    manager: String,
    billing: String,
    ceo: String,
}

/// Patient with a signed framework contract and one running order under it.
async fn fixture(tag_prefix: &str) -> Option<Fixture> {
    let context = support::suite_context(TEST_SECRET).await?;
    let pool = context.pool;
    let admin_id = context.admin_id;
    let tag = format!("{tag_prefix}-{}", Uuid::new_v4().simple());
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Supplier', 'Cost', '1975-03-04', 'diverse', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let manager_id = seed_user(&pool, &tag, "patient_manager").await;
    let billing_id = seed_user(&pool, &tag, "billing").await;
    for user_id in [manager_id, billing_id] {
        sqlx::query(
            "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
        )
        .bind(patient_id)
        .bind(user_id)
        .bind(admin_id)
        .execute(&pool)
        .await
        .unwrap();
    }
    let manager = auth_header(manager_id, "patient_manager");
    let billing = auth_header(billing_id, "billing");
    let ceo = auth_header(admin_id, "ceo");

    let (status, contract) = json_request(
        &context.app,
        "POST",
        "/api/v1/framework-contracts",
        &manager,
        Some(json!({
            "patient_id": patient_id,
            "status": "signed",
            "valid_from": gmed_server::app_time::today().to_string(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "contract: {contract:?}");
    let contract_id = contract["id"].as_str().unwrap().to_string();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
               order_number, patient_id, contract_id, phase, status, currency, created_by,
               package_coverage_status, package_coverage_decided_by, package_coverage_decided_at
           ) VALUES ($1, $2, $3::uuid, 'execution', 'active', 'EUR', $4,
                     'not_covered', $4, now())
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(&contract_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let account_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM company_financial_accounts WHERE currency = 'EUR' AND is_default",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    Some(Fixture {
        app: context.app,
        pool,
        tag,
        patient_id,
        contract_id,
        order_id,
        account_id,
        manager,
        billing,
        ceo,
    })
}

impl Fixture {
    /// A supplier invoice filed on the order and paid by GMED.
    async fn gmed_paid_supplier_invoice(
        &self,
        provider_id: Uuid,
        service_id: Option<Uuid>,
        number: &str,
        net: Decimal,
        vat: Decimal,
    ) -> Uuid {
        let gross = net + vat;
        let (status, created) = json_request(
            &self.app,
            "POST",
            &format!("/api/v1/orders/{}/external-invoices", self.order_id),
            &self.billing,
            Some(json!({
                "provider_id": provider_id,
                "order_leistung_id": service_id,
                "external_invoice_number": format!("{number}-{}", self.tag),
                "invoice_date": gmed_server::app_time::today().to_string(),
                "amount_net": net.to_string().parse::<f64>().unwrap(),
                "amount_vat": vat.to_string().parse::<f64>().unwrap(),
                "amount_gross": gross.to_string().parse::<f64>().unwrap(),
                "currency": "EUR",
                "status": "approved",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "supplier invoice: {created}");
        let external_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
        let (status, payment) = json_request(
            &self.app,
            "POST",
            &format!("/api/v1/company-provider-liabilities/{external_id}/settlements"),
            &self.billing,
            Some(json!({
                "request_id": Uuid::new_v4(),
                "financial_account_id": self.account_id,
                "amount_gross": gross.to_string(),
                "paid_on": gmed_server::app_time::today().to_string(),
                "payment_method": "bank_transfer",
            })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "GMED pays the supplier: {payment}");
        external_id
    }

    async fn statement(&self) -> Value {
        let (status, statement) = json_request(
            &self.app,
            "GET",
            &format!(
                "/api/v1/patients/{}/account-statement?currency=EUR",
                self.patient_id
            ),
            &self.ceo,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "statement: {statement:?}");
        statement
    }

    async fn termination_preview(&self) -> Value {
        let (status, preview) = json_request(
            &self.app,
            "GET",
            &format!(
                "/api/v1/framework-contracts/{}/termination-preview",
                self.contract_id
            ),
            &self.manager,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "preview: {preview:?}");
        let open_orders = preview["open_orders"].as_array().unwrap();
        assert_eq!(open_orders.len(), 1, "preview: {preview:?}");
        open_orders[0].clone()
    }

    async fn order_external_invoice(&self, external_id: Uuid) -> Value {
        let (status, order) = json_request(
            &self.app,
            "GET",
            &format!("/api/v1/orders/{}", self.order_id),
            &self.billing,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "order: {order:?}");
        order["external_invoices"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == external_id.to_string())
            .cloned()
            .unwrap_or_else(|| panic!("supplier invoice {external_id} on the order: {order:?}"))
    }

    async fn billing_expense(&self, external_id: Uuid) -> Value {
        let (status, workspace) = json_request(
            &self.app,
            "GET",
            &format!("/api/v1/patients/{}/billing-workspace", self.patient_id),
            &self.billing,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "workspace: {workspace:?}");
        workspace["expenses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == external_id.to_string())
            .cloned()
            .unwrap_or_else(|| panic!("expense {external_id} in workspace: {workspace:?}"))
    }

    async fn unbilled_patient_receivable(&self) -> Decimal {
        let (status, economics) = json_request(
            &self.app,
            "GET",
            &format!("/api/v1/orders/{}/economics", self.order_id),
            &self.ceo,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "economics: {economics:?}");
        money(&economics["actual"]["unbilled_patient_receivable_gross"])
    }

    async fn company_external_receivable(&self) -> Decimal {
        let (status, position) = json_request(
            &self.app,
            "GET",
            "/api/v1/company-financial-position?currency=EUR&from=2020-01-01&to=2099-12-31",
            &self.billing,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "position: {position:?}");
        position["patient_positions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["patient_id"] == self.patient_id.to_string())
            .map(|row| money(&row["external_receivable"]))
            .unwrap_or(Decimal::ZERO)
    }

    /// Provider expense booked per supplier invoice (accounting ledger, the
    /// basis of the DATEV export).
    async fn provider_expenses(&self) -> Vec<(String, Decimal, Decimal, Decimal)> {
        let (status, ledger) = json_request(
            &self.app,
            "GET",
            &format!(
                "/api/v1/invoices/accounting-ledger?patient_id={}",
                self.patient_id
            ),
            &self.ceo,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "ledger: {ledger:?}");
        let mut entries = ledger["entries"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["category"] == "provider_expense")
            .map(|entry| {
                (
                    entry["external_invoice_id"].as_str().unwrap().to_string(),
                    money(&entry["amount_net"]),
                    money(&entry["amount_vat"]),
                    money(&entry["amount_gross"]),
                )
            })
            .collect::<Vec<_>>();
        entries.sort();
        entries
    }
}

fn external_receivable_movements(statement: &Value) -> Vec<Decimal> {
    statement["movements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|movement| movement["kind"] == "external_receivable")
        .map(|movement| money(&movement["debit"]))
        .collect()
}

fn third_party_lines(preview_order: &Value) -> Vec<Value> {
    preview_order["lines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|line| line["source"] == "third_party_cost")
        .cloned()
        .collect()
}

#[tokio::test]
async fn supplier_invoice_of_a_billed_service_is_a_gmed_cost_not_a_patient_receivable() {
    let Some(fx) = fixture("billed-service-cost").await else {
        return;
    };
    let clinic_id = seed_provider(&fx.pool, &format!("Klinik {}", fx.tag), true).await;
    let hotel_id = seed_provider(&fx.pool, &format!("Hotel {}", fx.tag), false).await;
    let taxi_id = seed_provider(&fx.pool, &format!("Taxi {}", fx.tag), false).await;

    // The walkthrough: the patient is billed 1,000 € for the treatment and the
    // 321 € hotel at cost (pass-through); GMED pays the clinic 800 € and the
    // hotel 321 € itself.
    let treatment = seed_service(
        &fx.pool,
        fx.order_id,
        fx.patient_id,
        "Ambulante Behandlung",
        euros(1000),
        false,
        "invoiced",
    )
    .await;
    let hotel = seed_service(
        &fx.pool,
        fx.order_id,
        fx.patient_id,
        "Hotel (Durchlaufposten)",
        euros(321),
        true,
        "invoiced",
    )
    .await;
    let patient_invoice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO invoices (
               order_id, patient_id, invoice_number, invoice_type, status, due_date,
               total_net, total_vat, total_gross, paid_amount, line_items, created_by
           ) SELECT $1, $2, $3, 'interim', 'sent', CURRENT_DATE + 14,
                    1321, 0, 1321, 0,
                    jsonb_build_array(
                        jsonb_build_object(
                            'description', 'Ambulante Behandlung', 'quantity', '1',
                            'unit_price', '1000', 'vat_rate', '0', 'is_cost_passthrough', false,
                            'line_net', '1000', 'line_vat', '0', 'line_gross', '1000',
                            'source_order_leistung_id', $4::uuid),
                        jsonb_build_object(
                            'description', 'Hotel (Durchlaufposten)', 'quantity', '1',
                            'unit_price', '321', 'vat_rate', '0', 'is_cost_passthrough', true,
                            'line_net', '321', 'line_vat', '0', 'line_gross', '321',
                            'source_order_leistung_id', $5::uuid)),
                    created_by
             FROM orders WHERE id = $1
           RETURNING id"#,
    )
    .bind(fx.order_id)
    .bind(fx.patient_id)
    .bind(format!("INV-{}", fx.tag))
    .bind(treatment)
    .bind(hotel)
    .fetch_one(&fx.pool)
    .await
    .unwrap();

    let clinic_invoice = fx
        .gmed_paid_supplier_invoice(clinic_id, Some(treatment), "KLINIK", euros(800), euros(0))
        .await;
    let hotel_invoice = fx
        .gmed_paid_supplier_invoice(hotel_id, Some(hotel), "HOTEL", euros(300), euros(21))
        .await;

    // DATEV/accounting basis: both supplier invoices are booked as provider
    // expenses in full.
    let expenses_before = fx.provider_expenses().await;
    let mut expected_expenses = vec![
        (clinic_invoice.to_string(), euros(800), euros(0), euros(800)),
        (hotel_invoice.to_string(), euros(300), euros(21), euros(321)),
    ];
    expected_expenses.sort();
    assert_eq!(expenses_before, expected_expenses);

    // Account statement: the patient owes the open patient invoice, 1,321 €
    // (the walkthrough showed 1,121 € more: both supplier invoices on top).
    let statement = fx.statement().await;
    assert_eq!(
        money(&statement["summary"]["calculated_balance"]),
        euros(1321),
        "{statement:?}"
    );
    assert_eq!(
        money(&statement["summary"]["external_receivable"]),
        Decimal::ZERO
    );
    assert_eq!(money(&statement["summary"]["total_due"]), euros(1321));
    assert_eq!(statement["summary"]["reconciliation_required"], false);
    assert!(
        external_receivable_movements(&statement).is_empty(),
        "{statement:?}"
    );
    for external_id in [clinic_invoice, hotel_invoice] {
        let item = statement["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == external_id.to_string())
            .unwrap_or_else(|| panic!("supplier invoice listed: {statement:?}"));
        assert_eq!(item["payment_state"], "order_service_cost");
        assert_eq!(money(&item["amount_due"]), Decimal::ZERO);
    }
    let (status, summary) = json_request(
        &fx.app,
        "GET",
        &format!("/api/v1/patients/{}/financial-summary", fx.patient_id),
        &fx.ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "summary: {summary:?}");
    assert_eq!(money(&summary["external_receivable_gross"]), Decimal::ZERO);
    assert_eq!(fx.company_external_receivable().await, Decimal::ZERO);

    // Order: the supplier invoices are costs of their services.
    for external_id in [clinic_invoice, hotel_invoice] {
        let item = fx.order_external_invoice(external_id).await;
        assert_eq!(item["order_service_billed"], true, "{item:?}");
        assert_eq!(money(&item["patient_receivable_gross"]), Decimal::ZERO);
        assert_eq!(money(&item["remaining_receivable_gross"]), Decimal::ZERO);
    }
    assert_eq!(fx.unbilled_patient_receivable().await, Decimal::ZERO);

    // Billing constructor: nothing to re-bill.
    let clinic_expense = fx.billing_expense(clinic_invoice).await;
    assert_eq!(clinic_expense["billable"], false);
    assert_eq!(clinic_expense["order_service_billed"], true);
    let (status, refused) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/patients/{}/billing-invoices", fx.patient_id),
        &fx.billing,
        Some(json!({
            "request_id": Uuid::new_v4(),
            "order_id": fx.order_id,
            "invoice_type": "interim",
            "external_invoice_ids": [clinic_invoice],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(
        refused["message"],
        "Incoming invoice is the cost of an order service that is billed to the patient"
    );

    // Termination preview: the clinic cost is not billed on top of the
    // treatment (the walkthrough showed "not invoiced 800 €, owes 2,121 €").
    let preview = fx.termination_preview().await;
    assert!(third_party_lines(&preview).is_empty(), "{preview:?}");
    assert_eq!(money(&preview["accrued_gross"]), euros(1321));
    assert_eq!(money(&preview["invoiced_gross"]), euros(1321));
    assert_eq!(money(&preview["uninvoiced_gross"]), Decimal::ZERO);
    assert_eq!(money(&preview["billable_gross"]), Decimal::ZERO);
    assert_eq!(money(&preview["balance_gross"]), euros(1321));

    // The manual "link to patient invoice" still works and changes nothing.
    for (external_id, amount) in [(clinic_invoice, "800"), (hotel_invoice, "321")] {
        let (status, allocation) = json_request(
            &fx.app,
            "POST",
            &format!(
                "/api/v1/orders/{}/external-invoices/{external_id}/allocations",
                fx.order_id
            ),
            &fx.manager,
            Some(json!({
                "request_id": Uuid::new_v4(),
                "patient_invoice_id": patient_invoice_id,
                "amount_gross": amount,
            })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "manual link: {allocation:?}");
    }
    let statement = fx.statement().await;
    assert_eq!(
        money(&statement["summary"]["calculated_balance"]),
        euros(1321)
    );
    assert_eq!(
        money(&statement["summary"]["external_receivable"]),
        Decimal::ZERO
    );
    assert!(
        !statement["movements"]
            .as_array()
            .unwrap()
            .iter()
            .any(|movement| movement["kind"]
                .as_str()
                .is_some_and(|kind| kind.starts_with("external_"))),
        "{statement:?}"
    );
    let preview = fx.termination_preview().await;
    assert_eq!(money(&preview["uninvoiced_gross"]), Decimal::ZERO);
    assert_eq!(money(&preview["balance_gross"]), euros(1321));
    let item = fx.order_external_invoice(clinic_invoice).await;
    assert_eq!(money(&item["allocated_receivable_gross"]), euros(800));
    assert_eq!(money(&item["remaining_receivable_gross"]), Decimal::ZERO);
    assert_eq!(fx.company_external_receivable().await, Decimal::ZERO);
    assert_eq!(fx.provider_expenses().await, expenses_before);

    // A GMED-paid cost no billed service covers is re-billed at cost, as
    // before: a taxi GMED paid, not attributed to any service.
    let taxi_invoice = fx
        .gmed_paid_supplier_invoice(
            taxi_id,
            None,
            "TAXI",
            Decimal::new(5140, 2),
            Decimal::new(360, 2),
        )
        .await;
    let taxi_item = fx.order_external_invoice(taxi_invoice).await;
    assert_eq!(taxi_item["order_service_billed"], false);
    assert_eq!(money(&taxi_item["patient_receivable_gross"]), euros(55));
    let statement = fx.statement().await;
    assert_eq!(
        money(&statement["summary"]["calculated_balance"]),
        euros(1376)
    );
    assert_eq!(
        money(&statement["summary"]["external_receivable"]),
        euros(55)
    );
    assert_eq!(external_receivable_movements(&statement), vec![euros(55)]);
    assert_eq!(fx.unbilled_patient_receivable().await, euros(55));
    assert_eq!(fx.company_external_receivable().await, euros(55));
    let taxi_expense = fx.billing_expense(taxi_invoice).await;
    assert_eq!(taxi_expense["billable"], true);
    assert_eq!(taxi_expense["order_service_billed"], false);

    let preview = fx.termination_preview().await;
    let third_party = third_party_lines(&preview);
    assert_eq!(third_party.len(), 1, "{preview:?}");
    assert_eq!(
        third_party[0]["external_invoice_id"],
        taxi_invoice.to_string()
    );
    assert_eq!(money(&preview["uninvoiced_gross"]), euros(55));
    assert_eq!(money(&preview["billable_gross"]), euros(55));
    assert_eq!(money(&preview["balance_gross"]), euros(1376));

    // Terminated: the final invoice bills the taxi only.
    let (status, terminated) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/framework-contracts/{}/terminate", fx.contract_id),
        &fx.manager,
        Some(json!({ "reason": "Patient terminated the contract" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    assert_eq!(
        money(&terminated["settlements"][0]["uninvoiced_gross"]),
        euros(55)
    );
    let (status, final_invoice) = json_request(
        &fx.app,
        "POST",
        &format!(
            "/api/v1/orders/{}/termination-settlement/final-invoice",
            fx.order_id
        ),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "final invoice: {final_invoice:?}"
    );
    assert_eq!(money(&final_invoice["total_gross"]), euros(55));
    let lines = final_invoice["line_items"].as_array().unwrap();
    assert_eq!(lines.len(), 1, "{final_invoice:?}");
    assert_eq!(
        lines[0]["source_external_invoice_id"],
        taxi_invoice.to_string()
    );

    // Bookkeeping of the supplier invoices never changed.
    let mut expected_expenses = expenses_before.clone();
    expected_expenses.push((
        taxi_invoice.to_string(),
        Decimal::new(5140, 2),
        Decimal::new(360, 2),
        euros(55),
    ));
    expected_expenses.sort();
    assert_eq!(fx.provider_expenses().await, expected_expenses);
}

#[tokio::test]
async fn supplier_cost_of_a_service_the_termination_cancels_is_billed_at_cost() {
    let Some(fx) = fixture("cancelled-service-cost").await else {
        return;
    };
    let clinic_id = seed_provider(&fx.pool, &format!("Klinik {}", fx.tag), true).await;
    // A follow-up examination the patient would be billed 200 € for; GMED
    // already paid the clinic 150 € in advance.
    let follow_up = seed_service(
        &fx.pool,
        fx.order_id,
        fx.patient_id,
        "Kontrolluntersuchung",
        euros(200),
        false,
        "planned",
    )
    .await;
    let clinic_invoice = fx
        .gmed_paid_supplier_invoice(clinic_id, Some(follow_up), "VORAUS", euros(150), euros(0))
        .await;

    // While the service is billable the cost is GMED's, not a patient debt.
    let statement = fx.statement().await;
    assert_eq!(
        money(&statement["summary"]["calculated_balance"]),
        Decimal::ZERO
    );
    assert_eq!(
        fx.order_external_invoice(clinic_invoice).await["order_service_billed"],
        true
    );
    // Termination cancels the planned service, so the settlement bills the
    // cost GMED paid for it.
    let preview = fx.termination_preview().await;
    let third_party = third_party_lines(&preview);
    assert_eq!(third_party.len(), 1, "{preview:?}");
    assert_eq!(
        third_party[0]["external_invoice_id"],
        clinic_invoice.to_string()
    );
    assert_eq!(money(&preview["uninvoiced_gross"]), euros(150));
    assert_eq!(
        preview["cancelled_lines"][0]["order_leistung_id"],
        follow_up.to_string()
    );

    let (status, terminated) = json_request(
        &fx.app,
        "POST",
        &format!("/api/v1/framework-contracts/{}/terminate", fx.contract_id),
        &fx.manager,
        Some(json!({ "reason": "Patient terminated the contract" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "terminate: {terminated:?}");
    assert_eq!(
        money(&terminated["settlements"][0]["uninvoiced_gross"]),
        euros(150)
    );

    // Cancelled service: the paid cost is now the patient's receivable, the
    // statement and the settlement agree.
    let item = fx.order_external_invoice(clinic_invoice).await;
    assert_eq!(item["order_service_billed"], false);
    assert_eq!(money(&item["remaining_receivable_gross"]), euros(150));
    let statement = fx.statement().await;
    assert_eq!(
        money(&statement["summary"]["calculated_balance"]),
        euros(150)
    );
    assert_eq!(external_receivable_movements(&statement), vec![euros(150)]);
    let (status, final_invoice) = json_request(
        &fx.app,
        "POST",
        &format!(
            "/api/v1/orders/{}/termination-settlement/final-invoice",
            fx.order_id
        ),
        &fx.billing,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "final invoice: {final_invoice:?}"
    );
    assert_eq!(money(&final_invoice["total_gross"]), euros(150));
    assert_eq!(
        final_invoice["line_items"][0]["source_external_invoice_id"],
        clinic_invoice.to_string()
    );
}
