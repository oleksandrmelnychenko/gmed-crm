import { describe, expect, it } from "vitest";

import { localizedNotificationCopy, type Notification } from "@/components/topbar-data";

import { notificationCopyFromFacts, type NotificationFacts } from "./notification-copy";

function notice(
  kind: string,
  title: string,
  body: string | null,
  params: Record<string, unknown> | null = null,
): NotificationFacts {
  return { kind, title, body, params };
}

const CYRILLIC = /[А-Яа-яЁё]/;
const ENGLISH_TEMPLATE = /\b(New lead|Risk review|Risk decision|Security incident|Assess the risk|Patient sent|manual)\b/;

describe("notifications in the viewer's language (QA A-23, E-16, E-33)", () => {
  it("words a new lead from its code and facts, with the source translated", () => {
    const item = notice("new_lead", "New lead: Anna Muster", "manual", {
      lead_name: "Anna Muster",
      source: "manual",
    });
    // The lead's channel, not the referral source (QA 2026-10-12).
    expect(notificationCopyFromFacts(item, "ru")).toEqual({
      title: "Новый лид: Anna Muster",
      body: "Канал: Вручную",
    });
    expect(notificationCopyFromFacts(item, "de")).toEqual({
      title: "Neuer Lead: Anna Muster",
      body: "Kanal: Manuell",
    });
  });

  it("reads the facts of rows written before params existed", () => {
    const legacy = notice("new_lead", "New lead: Ben Muster", "website");
    expect(notificationCopyFromFacts(legacy, "ru")).toEqual({
      title: "Новый лид: Ben Muster",
      body: "Канал: Сайт",
    });
    // An unknown source code is shown readable, never as "unknown value".
    expect(notificationCopyFromFacts(notice("new_lead", "New lead: Mia", "trade_fair"), "de")?.body)
      .toBe("Kanal: Trade fair");
    expect(notificationCopyFromFacts(notice("new_lead", "New lead: Mia", ""), "de")?.body).toBeNull();
  });

  it("translates the risk review notices without any reason", () => {
    const review = notice("risk_review_required", "Risk review required", null);
    const proposed = notice("risk_decision_proposed", "Risk decision waits for a second reviewer", null);
    expect(notificationCopyFromFacts(review, "ru")?.title).toBe("Требуется проверка риска");
    expect(notificationCopyFromFacts(review, "de")?.title).toBe("Risikoprüfung erforderlich");
    expect(notificationCopyFromFacts(proposed, "ru")?.title).toBe("Решение по риску ждёт второго проверяющего");
    expect(notificationCopyFromFacts(proposed, "de")?.body).toContain("Vier-Augen-Prinzip");
  });

  it("translates the follow-up submission of the lead cabinet", () => {
    const item = notice(
      "lead_portal_follow_up_submitted",
      "Patient sent the additional information",
      "The additional information of the request was sent.",
    );
    expect(notificationCopyFromFacts(item, "ru")).toEqual({
      title: "Пациент отправил дополнительные сведения",
      body: "Дополнительные сведения по заявке получены.",
    });
  });

  it("translates the custody and consent-choice notices of a lead", () => {
    for (const item of [
      notice(
        "lead_guardian_access_custody_ended",
        "Parent's access ended",
        "A custody change ended a parent's access to this request.",
      ),
      notice(
        "retention_reminder_email_undelivered",
        "Deletion reminder not delivered",
        "The reminder before the automatic deletion did not reach the patient.",
      ),
      notice(
        "lead_consent_choice_changed",
        "Consent choice changed",
        "The patient changed the consent choice. Create a new consent document and signature invitation.",
      ),
    ]) {
      const ru = notificationCopyFromFacts(item, "ru");
      const de = notificationCopyFromFacts(item, "de");
      expect(ru?.title).toMatch(CYRILLIC);
      expect(ru?.body).toMatch(CYRILLIC);
      expect(de?.title).not.toBe(item.title);
      expect(de?.body).not.toBe(item.body);
    }
  });

  it("words an undelivered sign-in or payer e-mail without the address", () => {
    const login = notice("login_email_undelivered", "Sign-in e-mail not delivered", "x", {
      email: "login",
      delivery_status: "bounced",
    });
    expect(notificationCopyFromFacts(login, "ru")).toEqual({
      title: "Письмо с доступом не доставлено",
      body: "Адрес не принял письмо. Проверьте адрес или передайте доступ другим способом.",
    });
    const code = notice("payer_link_email_undelivered", "E-mail to the payer not delivered", "x", {
      email: "code",
      delivery_status: "complained",
    });
    expect(notificationCopyFromFacts(code, "de")?.title).toBe("Bestätigungscode an den Zahler nicht zugestellt");
    expect(notificationCopyFromFacts(code, "de")?.body).toContain("Spam");
    const invitation = notice("payer_link_email_undelivered", "E-mail to the payer not delivered", "x", {
      email: "invitation",
      delivery_status: "unexpected",
    });
    expect(notificationCopyFromFacts(invitation, "ru")?.body).toBe(
      "Проверьте адрес плательщика и отправьте ссылку ещё раз.",
    );
  });

  it("words a security incident with the Berlin deadline", () => {
    const item = notice(
      "security_incident",
      "Security incident INC-2026-0002: Laptop lost",
      "Assess the risk. A report to the supervisory authority is due by 14.10.2026 20:59.",
      { reference: "INC-2026-0002", title: "Laptop lost", authority_deadline: "2026-10-14T18:59:00Z" },
    );
    expect(notificationCopyFromFacts(item, "ru")).toEqual({
      title: "Инцидент с данными INC-2026-0002: Laptop lost",
      body: "Оцените риск. Срок сообщения в надзорный орган — 14.10.2026 20:59.",
    });
    expect(notificationCopyFromFacts(item, "de")?.title).toBe("Datenpanne INC-2026-0002: Laptop lost");
    // The same row without params (written before the change).
    const legacy = { ...item, params: null };
    expect(notificationCopyFromFacts(legacy, "de")).toEqual({
      title: "Datenpanne INC-2026-0002: Laptop lost",
      body: "Risiko bewerten. Meldefrist bei der Aufsichtsbehörde: 14.10.2026 20:59.",
    });
  });

  it("words the patient's appointment request updates for the portal", () => {
    expect(
      notificationCopyFromFacts(
        notice("appointment_request_update", "Appointment request cancelled", "Your appointment request was cancelled. Reason: Doppelt"),
        "ru",
      ),
    ).toEqual({ title: "Запрос на приём отменён", body: "Ваш запрос отменён. Причина: Doppelt" });
    expect(
      notificationCopyFromFacts(
        notice("appointment_request_update", "Appointment request scheduled", "x", { status: "converted" }),
        "de",
      )?.title,
    ).toBe("Termin geplant");
    expect(
      notificationCopyFromFacts(notice("appointment_request_update", "Appointment request approved", "x"), "de")?.title,
    ).toBe("Terminanfrage angenommen");
  });

  it("words signature outcomes, also from the English title of old rows", () => {
    const untrackable = notice("signature_request_failed", "Signature request could not be tracked", "… for 1 days …", {
      outcome: "untrackable",
      days: 1,
    });
    expect(notificationCopyFromFacts(untrackable, "de")?.body).toContain("1 Tag beim Signaturdienst");
    expect(notificationCopyFromFacts(notice("signature_request_closed", "Signature declined", "x"), "ru")?.title)
      .toBe("Подпись отклонена");
    expect(notificationCopyFromFacts(notice("signature_completed", "Document signed", "x"), "de")?.title)
      .toBe("Dokument unterschrieben");
  });

  it("localizes partial client signatures and explicitly distinguishes DEMO", () => {
    for (const lang of ["ru", "de"] as const) {
      const result = notificationCopyFromFacts(notice("signature_client_signed", "Client signature received", "fallback", { outcome: "client_signed", signed: 1, total: 2 }), lang);
      expect(result?.title).toBe(lang === "ru" ? "Подпись клиента получена" : "Kundenunterschrift eingegangen");
      expect(result?.body).toContain("1/2");
      const demo = notificationCopyFromFacts(notice("signature_client_signed", "DEMO", "fallback", { outcome: "test_client_signed", signed: 1, total: 2 }), lang);
      expect(demo?.title).toMatch(/^DEMO · /);
      expect(demo?.body).toContain(lang === "ru" ? "не имеет юридической силы" : "keine Rechtswirkung");
    }
  });

  it("uses Russian plural forms for the retention notice", () => {
    const sweep = (count: number) =>
      notificationCopyFromFacts(
        notice("privacy_request", "Retention", "x", { origin: "retention_sweep", count, retention_days: 1095 }),
        "ru",
      )?.title;
    expect(sweep(1)).toBe("Срок хранения истёк: 1 карта пациента к удалению");
    expect(sweep(2)).toBe("Срок хранения истёк: 2 карты пациентов к удалению");
    expect(sweep(5)).toBe("Срок хранения истёк: 5 карт пациентов к удалению");
    const legacy = notice(
      "privacy_request",
      "Retention: 3 patient file(s) due for erasure",
      "Files inactive for more than 1095 days were added to the DSGVO queue. Review holds, then approve and execute.",
    );
    expect(notificationCopyFromFacts(legacy, "de")).toEqual({
      title: "Aufbewahrung abgelaufen: 3 Patientenakten zur Löschung",
      body: "Akten, die länger als 1095 Tage inaktiv sind, stehen in der DSGVO-Warteschlange. Sperren prüfen, dann freigeben und ausführen.",
    });
  });

  it("words a request that is back in the queue after its hold, with its type", () => {
    const item = notice("privacy_request", "Hold ended: erasure request of PT-1 · Anna Muster is due", "x", {
      origin: "retention_hold_ended",
      request_type: "erasure",
      patient_label: "PT-1 · Anna Muster",
      retention_until: "2026-10-12",
      due_date: "2026-11-11",
    });
    expect(notificationCopyFromFacts(item, "ru")).toEqual({
      title: "Отложенный запрос DSGVO снова в очереди: PT-1 · Anna Muster",
      body: "Удаление данных (ст. 17): запрос был отложен до 12.10.2026. Проверьте и исполните его. Срок: 11.11.2026",
    });
    expect(notificationCopyFromFacts(item, "de")?.body).toBe(
      "Löschung (Art. 17): Der Antrag war bis 12.10.2026 zurückgestellt. Prüfen und ausführen. Frist: 11.11.2026",
    );
    const restriction = notice("privacy_request", "Hold ended", "x", {
      origin: "retention_hold_ended",
      request_type: "restriction",
      patient_label: "PT-2",
      retention_until: null,
      due_date: "2026-11-11",
    });
    expect(notificationCopyFromFacts(restriction, "de")).toEqual({
      title: "Zurückgestellter DSGVO-Antrag wieder in der Warteschlange: PT-2",
      body: "Einschränkung der Verarbeitung (Art. 18): Den Antrag prüfen und ausführen. Frist: 11.11.2026",
    });
  });

  it("words a patient's DSGVO request with its type and due day", () => {
    const item = notice("privacy_request", "Patient GDPR request: PT-1 · Anna", "x", {
      origin: "patient_portal",
      request_type: "erasure",
      patient_label: "PT-1 · Anna",
      due_date: "2026-11-10",
    });
    expect(notificationCopyFromFacts(item, "ru")).toEqual({
      title: "Запрос пациента по DSGVO: PT-1 · Anna",
      body: "Удаление данных (ст. 17) · срок: 10.11.2026",
    });
  });

  it("names the chat sender, or the care team when unknown", () => {
    expect(notificationCopyFromFacts(notice("direct_message", "New message from Anna", "Open chat", { sender_name: "Anna" }), "ru"))
      .toEqual({ title: "Новое сообщение: Anna", body: "Откройте чат" });
    expect(notificationCopyFromFacts(notice("direct_message_attachment", "New file from Care team", "Open chat"), "de"))
      .toEqual({ title: "Neue Datei: Betreuungsteam", body: "Chat öffnen" });
  });

  it("words SOP review requests with the submitter's role", () => {
    const item = notice("sop_review_request", "SOP review requested: Hygiene", "x", {
      sop_title: "Hygiene",
      submitter_role: "patient_manager",
      resubmitted: false,
    });
    const ru = notificationCopyFromFacts(item, "ru");
    expect(ru?.title).toBe("SOP на проверку: Hygiene");
    expect(ru?.body).toMatch(/^Отправитель: .+\. SOP ждёт вашей проверки\.$/);
  });

  it("leaves unknown kinds to the caller", () => {
    expect(notificationCopyFromFacts(notice("something_new", "Title", "Body"), "ru")).toBeNull();
  });

  it("renders the bell entries of the QA findings without English text", () => {
    const rows: Notification[] = [
      { id: "1", kind: "new_lead", title: "New lead: Mia MusterA", body: "manual", is_read: false, created_at: "" },
      { id: "2", kind: "risk_review_required", title: "Risk review required", body: null, is_read: false, created_at: "" },
      {
        id: "3",
        kind: "security_incident",
        title: "Security incident INC-2026-0002: Test",
        body: "Assess the risk. A report to the supervisory authority is due by 14.10.2026 20:59.",
        is_read: false,
        created_at: "",
      },
      {
        id: "4",
        kind: "lead_portal_follow_up_submitted",
        title: "Patient sent the additional information",
        body: "The additional information of the request was sent.",
        is_read: false,
        created_at: "",
      },
    ];
    for (const row of rows) {
      const copy = localizedNotificationCopy(row, "ru");
      expect(copy.title).toMatch(CYRILLIC);
      expect(`${copy.title} ${copy.body ?? ""}`).not.toMatch(ENGLISH_TEMPLATE);
    }
  });

  it("adds the payer-link hint of a submitted lead request", () => {
    const row: Notification = {
      id: "5",
      kind: "lead_portal_submitted",
      title: "Patient sent the request data",
      body: "Personal data: 9 of 11 fields, 2 documents. The payer link can be sent now.",
      params: { filled: 9, total: 11, documents: 2, payer_link_ready: true },
      is_read: false,
      created_at: "",
    };
    expect(localizedNotificationCopy(row, "ru").body).toBe(
      "Личные данные: заполнено 9 из 11, документов: 2. Ссылку для плательщика уже можно отправить.",
    );
    expect(localizedNotificationCopy({ ...row, params: null }, "de").body).toBe(
      "Persönliche Daten: 9 von 11 Angaben, Unterlagen: 2. Der Link für den Zahler kann jetzt gesendet werden.",
    );
  });
});
