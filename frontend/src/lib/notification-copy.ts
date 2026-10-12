/**
 * Notifications in the viewer's language (QA 2026-10-11, A-23/E-16/E-33).
 *
 * The server stores a stable code (`kind`) and the facts of a notification
 * (`params`: names, dates, counts, status codes); this module words them in
 * RU or DE. Rows written before `params` existed carry only an English
 * `title`/`body`: their facts are read back from the known English
 * templates, and a text that matches no template is shown as it is.
 *
 * Kinds handled elsewhere (`components/topbar-data.ts`) keep their own
 * renderers; this module covers every other kind the server writes.
 */
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, t as translationsFor, type Lang, type Translations } from "@/lib/i18n";
import { humanizeAuditCode } from "@/lib/i18n/catalogs/audit-activity";
import { pluralWord } from "@/lib/i18n/plural";
import { leadSourceLabel } from "@/pages/leads/model/leads-model";

export interface NotificationFacts {
  kind: string;
  title: string;
  body: string | null;
  params?: Record<string, unknown> | null;
}

export interface NotificationCopy {
  title: string;
  body: string | null;
}

type Texts = { ru: string; de: string };

function pick(texts: Texts, lang: Lang): string {
  return lang === "de" ? texts.de : texts.ru;
}

function fill(texts: Texts, lang: Lang, values: Record<string, string | number>): string {
  return formatUiText(pick(texts, lang), values);
}

/** A text fact of `params`, or null. */
function text(item: NotificationFacts, key: string): string | null {
  const value = item.params?.[key];
  if (typeof value === "string") return value.trim() ? value.trim() : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(item: NotificationFacts, key: string): number | null {
  const value = item.params?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function flag(item: NotificationFacts, key: string): boolean | null {
  const value = item.params?.[key];
  return typeof value === "boolean" ? value : null;
}

function hasParams(item: NotificationFacts): boolean {
  return Boolean(item.params && typeof item.params === "object");
}

function legacy(value: string | null | undefined, pattern: RegExp): RegExpMatchArray | null {
  return value ? pattern.exec(value) : null;
}

/** "2026-10-14" or an RFC 3339 instant → "14.10.2026"; other text as is. */
function day(value: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatAppDate(`${value}T12:00:00Z`) || value;
  return formatAppDate(value) || value;
}

/** An RFC 3339 instant → "14.10.2026 20:59" (Berlin); other text as is. */
function moment(value: string | null): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? formatAppDateTime(value) || value : value;
}

function sourceLabel(code: string, tr: Translations): string {
  const label = leadSourceLabel(code, tr);
  return label === tr.common_unknown_value || label === tr.common_unknown
    ? humanizeAuditCode(code)
    : label;
}

// ---------------------------------------------------------------------------
// Leads, risk review, lead cabinet
// ---------------------------------------------------------------------------

function newLead(item: NotificationFacts, lang: Lang): NotificationCopy {
  const tr = translationsFor(lang);
  const name = text(item, "lead_name") ?? legacy(item.title, /^New lead:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
  const source = hasParams(item) ? text(item, "source") : item.body?.trim() || null;
  return {
    title: name
      ? fill({ ru: "Новый лид: {name}", de: "Neuer Lead: {name}" }, lang, { name })
      : pick({ ru: "Новый лид", de: "Neuer Lead" }, lang),
    body: source
      ? fill({ ru: "Источник: {source}", de: "Quelle: {source}" }, lang, { source: sourceLabel(source, tr) })
      : null,
  };
}

const FIXED_COPY: Record<string, { title: Texts; body: Texts | null }> = {
  // Risk review (reviewers only; never a reason or a trigger).
  risk_review_required: {
    title: { ru: "Требуется проверка риска", de: "Risikoprüfung erforderlich" },
    body: { ru: "Откройте лид и проверьте оценку риска.", de: "Lead öffnen und die Risikobewertung prüfen." },
  },
  risk_decision_proposed: {
    title: {
      ru: "Решение по риску ждёт второго проверяющего",
      de: "Risikoentscheidung wartet auf die zweite Prüfung",
    },
    body: {
      ru: "Подтвердите или отклоните предложенное решение (принцип четырёх глаз).",
      de: "Den Vorschlag bestätigen oder ablehnen (Vier-Augen-Prinzip).",
    },
  },
  lead_portal_follow_up_submitted: {
    title: { ru: "Пациент отправил дополнительные сведения", de: "Patient hat die zusätzlichen Angaben gesendet" },
    body: {
      ru: "Дополнительные сведения по заявке получены.",
      de: "Die zusätzlichen Angaben zur Anfrage sind eingegangen.",
    },
  },
  translation_request: {
    title: { ru: "Пациент запросил перевод документа", de: "Patient hat eine Übersetzung angefragt" },
    body: {
      ru: "Пациент отправил запрос на перевод через портал.",
      de: "Ein Patient hat über das Portal eine Übersetzung angefragt.",
    },
  },
};

function leadPayerSubmitted(item: NotificationFacts, lang: Lang): NotificationCopy {
  const level = text(item, "level") ?? legacy(item.body, /check level (\d+)/)?.[1] ?? null;
  return {
    title: pick({
      ru: "Плательщик отправил данные о покрытии расходов",
      de: "Zahler hat die Angaben zur Kostenübernahme gesendet",
    }, lang),
    body: level
      ? fill({
          ru: "Данные — в мастере лида, раздел «Анкета плательщика» (уровень проверки {level}).",
          de: "Die Angaben stehen im Lead-Assistenten unter „Angaben des Zahlers“ (Prüfstufe {level}).",
        }, lang, { level })
      : pick({
          ru: "Данные — в мастере лида, раздел «Анкета плательщика».",
          de: "Die Angaben stehen im Lead-Assistenten unter „Angaben des Zahlers“.",
        }, lang),
  };
}

// ---------------------------------------------------------------------------
// Incidents and DSGVO
// ---------------------------------------------------------------------------

function securityIncident(item: NotificationFacts, lang: Lang): NotificationCopy {
  const legacyTitle = legacy(item.title, /^Security incident (\S+):\s*([\s\S]*)$/);
  const reference = text(item, "reference") ?? legacyTitle?.[1] ?? "";
  const title = text(item, "title") ?? legacyTitle?.[2]?.trim() ?? "";
  const deadline = moment(text(item, "authority_deadline"))
    || legacy(item.body, /due by (.+?)\.?$/)?.[1]
    || "";
  const heading = reference
    ? fill({ ru: "Инцидент с данными {reference}", de: "Datenpanne {reference}" }, lang, { reference })
    : pick({ ru: "Инцидент с данными", de: "Datenpanne" }, lang);
  return {
    title: title ? `${heading}: ${title}` : heading,
    body: deadline
      ? fill({
          ru: "Оцените риск. Срок сообщения в надзорный орган — {deadline}.",
          de: "Risiko bewerten. Meldefrist bei der Aufsichtsbehörde: {deadline}.",
        }, lang, { deadline })
      : pick({ ru: "Оцените риск.", de: "Risiko bewerten." }, lang),
  };
}

function privacyRequestTypeLabel(type: string, tr: Translations): string {
  const key = `compliance_request_type_${type}` as keyof Translations;
  const label = tr[key];
  return typeof label === "string" ? label : humanizeAuditCode(type);
}

/** The request type of a row written before `params` (English body). */
function legacyPrivacyRequestType(body: string | null): string | null {
  if (!body) return null;
  if (/processing restriction request/.test(body)) return "restriction";
  if (/revocation of third-party sharing/.test(body)) return "third_party_revoke";
  if (/erasure request/.test(body)) return "erasure";
  return /data subject request \(([a-z_]+)\)/.exec(body)?.[1] ?? null;
}

function privacyRequest(item: NotificationFacts, lang: Lang): NotificationCopy | null {
  const tr = translationsFor(lang);
  // A request held until a date (for an erasure: the retention of the data) is back in
  // the queue on that date (crates/server/src/routes/retention.rs, requeue_expired_retention_holds).
  if (text(item, "origin") === "retention_hold_ended") {
    const patient = text(item, "patient_label") ?? "";
    const type = text(item, "request_type");
    const until = day(text(item, "retention_until"));
    const due = day(text(item, "due_date"));
    const heading = pick({
      ru: "Отложенный запрос DSGVO снова в очереди",
      de: "Zurückgestellter DSGVO-Antrag wieder in der Warteschlange",
    }, lang);
    const parts = [
      type ? `${privacyRequestTypeLabel(type, tr)}:` : null,
      until
        ? fill({
            ru: "запрос был отложен до {until}. Проверьте и исполните его.",
            de: "Der Antrag war bis {until} zurückgestellt. Prüfen und ausführen.",
          }, lang, { until })
        : pick({
            ru: "Проверьте и исполните запрос.",
            de: "Den Antrag prüfen und ausführen.",
          }, lang),
      due ? fill({ ru: "Срок: {due}", de: "Frist: {due}" }, lang, { due }) : null,
    ].filter(Boolean);
    return {
      title: patient ? `${heading}: ${patient}` : heading,
      body: parts.join(" "),
    };
  }
  const retentionTitle = legacy(item.title, /^Retention: (\d+) patient file\(s\) due for erasure$/);
  if (text(item, "origin") === "retention_sweep" || retentionTitle) {
    const count = num(item, "count") ?? Number(retentionTitle?.[1] ?? 0);
    const days = num(item, "retention_days") ?? Number(legacy(item.body, /more than (\d+) days/)?.[1] ?? 0);
    const files = pluralWord(lang, count, {
      ru: ["карта пациента", "карты пациентов", "карт пациентов"],
      de: ["Patientenakte", "Patientenakten"],
    });
    return {
      title: fill({
        ru: "Срок хранения истёк: {count} {files} к удалению",
        de: "Aufbewahrung abgelaufen: {count} {files} zur Löschung",
      }, lang, { count, files }),
      body: days
        ? fill({
            ru: "Карты без активности дольше {days} дн. добавлены в очередь DSGVO. Проверьте блокировки, затем одобрите и выполните удаление.",
            de: "Akten, die länger als {days} Tage inaktiv sind, stehen in der DSGVO-Warteschlange. Sperren prüfen, dann freigeben und ausführen.",
          }, lang, { days })
        : null,
    };
  }
  const legacyTitle = legacy(
    item.title,
    /^Patient (?:restriction request|third-party revoke request|GDPR request):\s*([\s\S]*)$/,
  );
  if (!hasParams(item) && !legacyTitle) return null;
  const patient = text(item, "patient_label") ?? legacyTitle?.[1]?.trim() ?? "";
  const type = text(item, "request_type") ?? legacyPrivacyRequestType(item.body);
  const due = day(text(item, "due_date") ?? legacy(item.body, /Due by (\d{4}-\d{2}-\d{2})/)?.[1] ?? null);
  const heading = pick({ ru: "Запрос пациента по DSGVO", de: "Datenschutzantrag des Patienten" }, lang);
  const parts = [
    type ? privacyRequestTypeLabel(type, tr) : null,
    due ? fill({ ru: "срок: {due}", de: "Frist: {due}" }, lang, { due }) : null,
  ].filter(Boolean);
  return {
    title: patient ? `${heading}: ${patient}` : heading,
    body: parts.length ? `${parts.join(" · ")}` : null,
  };
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

function appointmentRequest(item: NotificationFacts, lang: Lang): NotificationCopy {
  const patient = text(item, "patient_label")
    ?? legacy(item.title, /^New appointment request:\s*([\s\S]*)$/)?.[1]?.trim()
    ?? "";
  return {
    title: patient
      ? fill({ ru: "Новый запрос на приём: {patient}", de: "Neue Terminanfrage: {patient}" }, lang, { patient })
      : pick({ ru: "Новый запрос на приём", de: "Neue Terminanfrage" }, lang),
    body: pick({
      ru: "Пациент запросил планирование приёма через портал.",
      de: "Der Patient hat über das Portal eine Terminplanung angefragt.",
    }, lang),
  };
}

const APPOINTMENT_REQUEST_UPDATES: Record<string, { title: Texts; body: Texts }> = {
  approved: {
    title: { ru: "Запрос на приём одобрен", de: "Terminanfrage angenommen" },
    body: {
      ru: "Ваш запрос одобрен и ждёт планирования.",
      de: "Ihre Anfrage wurde angenommen und wird jetzt geplant.",
    },
  },
  rejected: {
    title: { ru: "Запрос на приём отклонён", de: "Terminanfrage abgelehnt" },
    body: { ru: "Ваш запрос рассмотрен и отклонён.", de: "Ihre Anfrage wurde geprüft und abgelehnt." },
  },
  cancelled: {
    title: { ru: "Запрос на приём отменён", de: "Terminanfrage storniert" },
    body: { ru: "Ваш запрос отменён.", de: "Ihre Anfrage wurde storniert." },
  },
  converted: {
    title: { ru: "Приём запланирован", de: "Termin geplant" },
    body: { ru: "По вашему запросу назначен приём.", de: "Zu Ihrer Anfrage wurde ein Termin geplant." },
  },
};

function appointmentRequestUpdate(item: NotificationFacts, lang: Lang): NotificationCopy | null {
  const legacyStatus = legacy(item.title, /^Appointment request (\w+)$/)?.[1];
  const status = text(item, "status") ?? (legacyStatus === "scheduled" ? "converted" : legacyStatus) ?? "";
  const copy = APPOINTMENT_REQUEST_UPDATES[status];
  if (!copy) return null;
  const reason = hasParams(item)
    ? text(item, "reason")
    : legacy(item.body, /Reason:\s*([\s\S]*)$/)?.[1]?.trim() ?? null;
  return {
    title: pick(copy.title, lang),
    body: reason
      ? `${pick(copy.body, lang)} ${fill({ ru: "Причина: {reason}", de: "Grund: {reason}" }, lang, { reason })}`
      : pick(copy.body, lang),
  };
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const SIGNATURE_OUTCOMES: Record<string, { title: Texts; body: Texts }> = {
  declined: {
    title: { ru: "Подпись отклонена", de: "Signatur abgelehnt" },
    body: {
      ru: "Подписант отклонил запрос. Документы не подписаны: свяжитесь с подписантом или отправьте новый запрос.",
      de: "Ein Unterzeichner hat die Anfrage abgelehnt. Die Dokumente sind nicht unterschrieben; Unterzeichner kontaktieren oder eine neue Anfrage senden.",
    },
  },
  withdrawn: {
    title: { ru: "Запрос на подпись отозван", de: "Signaturanfrage zurückgezogen" },
    body: { ru: "Запрос отозван. Документы не подписаны.", de: "Die Anfrage wurde zurückgezogen. Die Dokumente sind nicht unterschrieben." },
  },
  expired: {
    title: { ru: "Срок запроса на подпись истёк", de: "Signaturanfrage abgelaufen" },
    body: {
      ru: "Срок истёк до того, как все подписали. Если документы ещё нужны, отправьте новый запрос.",
      de: "Die Anfrage ist abgelaufen, bevor alle unterschrieben haben. Bei Bedarf eine neue Anfrage senden.",
    },
  },
  error: {
    title: { ru: "Ошибка запроса на подпись", de: "Signaturanfrage fehlgeschlagen" },
    body: {
      ru: "Сервис подписи сообщил об ошибке. Документы не подписаны; проверьте запрос и при необходимости отправьте его снова.",
      de: "Der Signaturdienst hat einen Fehler gemeldet. Die Dokumente sind nicht unterschrieben; Anfrage prüfen und bei Bedarf erneut senden.",
    },
  },
  untrackable: {
    title: { ru: "Запрос на подпись не отслеживается", de: "Signaturanfrage nicht nachverfolgbar" },
    body: {
      ru: "Запрос {days} дн. оставался неподтверждённым у сервиса подписи и закрыт как неудачный. Проверьте документ и при необходимости отправьте новый запрос.",
      de: "Die Anfrage blieb {days} {daysWord} beim Signaturdienst unbestätigt und wurde als fehlgeschlagen geschlossen. Dokument prüfen und bei Bedarf neu senden.",
    },
  },
  abandoned: {
    title: { ru: "Запрос на подпись прекращён", de: "Signaturanfrage aufgegeben" },
    body: { ru: "Запрос на подпись прекращён: {reason}", de: "Die Signaturanfrage wurde aufgegeben: {reason}" },
  },
  needs_review: {
    title: { ru: "Подписанный документ требует проверки", de: "Unterschriebenes Dokument prüfen" },
    body: {
      ru: "Документ подписан, но его исходник изменился во время подписания. Примите или отклоните подпись в панели подписи документа.",
      de: "Das Dokument wurde unterschrieben, aber seine Quelle hat sich währenddessen geändert. Signatur im Signaturbereich des Dokuments annehmen oder ablehnen.",
    },
  },
  test_completed: {
    title: { ru: "Тестовая подпись завершена", de: "Testsignatur abgeschlossen" },
    body: {
      ru: "Тестовая (DEMO) подпись сохранена как внутреннее подтверждение и не имеет юридической силы.",
      de: "Die Test-Signatur (DEMO) ist als interner Nachweis archiviert und hat keine Rechtswirkung.",
    },
  },
  completed: {
    title: { ru: "Документ подписан", de: "Dokument unterschrieben" },
    body: {
      ru: "Все подписали. Подписанный PDF и протокол подписи сохранены; выдайте подписантам их экземпляр.",
      de: "Alle haben unterschrieben. Das signierte PDF und der Signaturbericht sind archiviert; den Unterzeichnern ihre Kopie geben.",
    },
  },
};

const LEGACY_SIGNATURE_TITLES: Record<string, string> = {
  "Signature declined": "declined",
  "Signature request withdrawn": "withdrawn",
  "Signature request expired": "expired",
  "Signature request failed": "error",
  "Signature request could not be tracked": "untrackable",
  "Signature request abandoned": "abandoned",
  "Signed document needs review": "needs_review",
  "Test signature completed": "test_completed",
  "Document signed": "completed",
};

function signature(item: NotificationFacts, lang: Lang): NotificationCopy | null {
  const outcome = text(item, "outcome") ?? LEGACY_SIGNATURE_TITLES[item.title] ?? "";
  const copy = SIGNATURE_OUTCOMES[outcome];
  if (!copy) return null;
  const days = num(item, "days") ?? Number(legacy(item.body, /for (\d+) days/)?.[1] ?? 0);
  const reason = text(item, "reason") ?? legacy(item.body, /given up:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
  return {
    title: pick(copy.title, lang),
    body: fill(copy.body, lang, {
      days,
      daysWord: pluralWord(lang, days, { ru: ["день", "дня", "дней"], de: ["Tag", "Tage"] }),
      reason,
    }),
  };
}

// ---------------------------------------------------------------------------
// Patients, documents, chat
// ---------------------------------------------------------------------------

function medicationExpiry(item: NotificationFacts, lang: Lang): NotificationCopy {
  const facts = legacy(
    item.body,
    /^([\s\S]+) \(([^()]*)\) reached its intake end date (\d{4}-\d{2}-\d{2}) and now requires confirmation\. Patient: ([\s\S]*)\.$/,
  );
  const code = text(item, "patient_code")
    ?? legacy(item.title, /^Medication review required for (.+)$/)?.[1]
    ?? facts?.[2]
    ?? "";
  const medication = text(item, "medication_name") ?? facts?.[1] ?? "";
  const name = text(item, "patient_name") ?? facts?.[4] ?? "";
  const date = day(text(item, "expiry_date") ?? facts?.[3] ?? null);
  return {
    title: code
      ? fill({ ru: "Проверка медикамента: {code}", de: "Medikation prüfen: {code}" }, lang, { code })
      : pick({ ru: "Проверка медикамента", de: "Medikation prüfen" }, lang),
    body: medication && date
      ? fill({
          ru: "{medication}: приём закончился {date}, нужно подтверждение. Пациент: {patient}.",
          de: "{medication}: Einnahmeende am {date} erreicht, Bestätigung erforderlich. Patient: {patient}.",
        }, lang, { medication, date, patient: [name, code ? `(${code})` : ""].filter(Boolean).join(" ") })
      : item.body,
  };
}

function patientFeedback(item: NotificationFacts, lang: Lang): NotificationCopy {
  const patient = text(item, "patient_label")
    ?? legacy(item.title, /^New patient feedback:\s*([\s\S]*)$/)?.[1]?.trim()
    ?? "";
  return {
    title: patient
      ? fill({ ru: "Новый отзыв пациента: {patient}", de: "Neues Patientenfeedback: {patient}" }, lang, { patient })
      : pick({ ru: "Новый отзыв пациента", de: "Neues Patientenfeedback" }, lang),
    body: pick({
      ru: "Пациент заполнил анкету удовлетворённости в портале.",
      de: "Ein Patient hat im Portal den Zufriedenheitsfragebogen ausgefüllt.",
    }, lang),
  };
}

function patientUpload(item: NotificationFacts, lang: Lang): NotificationCopy {
  const facts = legacy(item.body, /^([\s\S]*) uploaded a (payment proof|portal document):\s*([\s\S]*?)\.?$/);
  const paymentProof = flag(item, "payment_proof")
    ?? (facts ? facts[2] === "payment proof" : item.title === "Patient payment proof uploaded");
  const patient = text(item, "patient_label") ?? facts?.[1]?.trim() ?? "";
  const document = text(item, "document_name") ?? facts?.[3]?.trim() ?? "";
  return {
    title: paymentProof
      ? pick({ ru: "Пациент загрузил подтверждение оплаты", de: "Zahlungsnachweis vom Patienten hochgeladen" }, lang)
      : pick({ ru: "Пациент загрузил документ в портал", de: "Patient hat ein Dokument im Portal hochgeladen" }, lang),
    body: [patient, document].filter(Boolean).join(": ") || null,
  };
}

function interpreterUpload(item: NotificationFacts, lang: Lang): NotificationCopy {
  const facts = legacy(item.body, /^([\s\S]*) has a new interpreter document awaiting review:\s*([\s\S]*?)\.?$/);
  const patient = text(item, "patient_label") ?? facts?.[1]?.trim() ?? "";
  const document = text(item, "document_name") ?? facts?.[2]?.trim() ?? "";
  return {
    title: pick({ ru: "Переводчик загрузил документ", de: "Dolmetscher hat ein Dokument hochgeladen" }, lang),
    body: patient || document
      ? fill({
          ru: "{subject} — ждёт проверки.",
          de: "{subject} – wartet auf Prüfung.",
        }, lang, { subject: [patient, document].filter(Boolean).join(": ") })
      : null,
  };
}

function documentRelease(item: NotificationFacts, lang: Lang): NotificationCopy {
  const name = text(item, "document_name")
    ?? legacy(item.title, /^New document released:\s*([\s\S]*)$/)?.[1]?.trim()
    ?? "";
  return {
    title: name
      ? fill({ ru: "Новый документ: {name}", de: "Neues Dokument: {name}" }, lang, { name })
      : pick({ ru: "Новый документ в портале", de: "Neues Dokument im Portal" }, lang),
    body: pick({
      ru: "В вашем портале доступен новый документ.",
      de: "In Ihrem Patientenportal ist ein neues Dokument verfügbar.",
    }, lang),
  };
}

function directMessage(item: NotificationFacts, lang: Lang): NotificationCopy {
  const legacyTitle = legacy(item.title, /^New (?:message|file) from\s*([\s\S]*)$/)?.[1]?.trim();
  const known = hasParams(item) ? text(item, "sender_name") : legacyTitle && legacyTitle !== "Care team" ? legacyTitle : null;
  const sender = known ?? pick({ ru: "команда сопровождения", de: "Betreuungsteam" }, lang);
  const attachment = item.kind === "direct_message_attachment";
  return {
    title: attachment
      ? fill({ ru: "Новый файл: {sender}", de: "Neue Datei: {sender}" }, lang, { sender })
      : fill({ ru: "Новое сообщение: {sender}", de: "Neue Nachricht: {sender}" }, lang, { sender }),
    body: pick({ ru: "Откройте чат", de: "Chat öffnen" }, lang),
  };
}

function patientAssignment(item: NotificationFacts, lang: Lang): NotificationCopy {
  const revoked = item.kind === "patient_assignment_revoked";
  const legacyName = legacy(
    item.title,
    revoked ? /^Patient assignment revoked:\s*([\s\S]*)$/ : /^New patient assignment:\s*([\s\S]*)$/,
  )?.[1]?.trim();
  const name = text(item, "patient_name") ?? legacyName ?? "";
  const code = text(item, "patient_code") ?? legacy(item.body, /\(([^()]*)\)\.?$/)?.[1] ?? "";
  const patient = code ? `${name} (${code})` : name;
  return revoked
    ? {
        title: fill({ ru: "Доступ к пациенту отозван: {name}", de: "Patientenzuweisung aufgehoben: {name}" }, lang, { name }),
        body: fill({
          ru: "Ваш доступ к пациенту {patient} отозван.",
          de: "Ihr Zugriff auf den Patienten {patient} wurde entzogen.",
        }, lang, { patient }),
      }
    : {
        title: fill({ ru: "Вам назначен пациент: {name}", de: "Neuer Patient zugewiesen: {name}" }, lang, { name }),
        body: fill({
          ru: "Вы назначены к пациенту {patient}.",
          de: "Sie wurden dem Patienten {patient} zugewiesen.",
        }, lang, { patient }),
      };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

const RECOMMENDATION_DECISIONS: Record<string, Texts> = {
  schedule: { ru: "записаться на приём", de: "Termin vereinbaren" },
  already_done: { ru: "уже сделано", de: "bereits erledigt" },
  need_consultation: { ru: "нужна консультация", de: "Beratung gewünscht" },
  declined: { ru: "отказ", de: "abgelehnt" },
};

function recommendation(item: NotificationFacts, lang: Lang): NotificationCopy | null {
  switch (item.kind) {
    case "recommendation":
      return {
        title: pick({ ru: "Новая рекомендация", de: "Neue Empfehlung" }, lang),
        body: text(item, "title") ?? item.body,
      };
    case "recommendation_decision": {
      const decision = text(item, "decision") ?? legacy(item.body, /^Patient selected ([a-z_]+)\.?$/)?.[1] ?? "";
      const label = RECOMMENDATION_DECISIONS[decision];
      return {
        title: pick({ ru: "Решение пациента по рекомендации", de: "Entscheidung des Patienten zur Empfehlung" }, lang),
        body: label
          ? fill({ ru: "Пациент выбрал: {decision}", de: "Der Patient hat gewählt: {decision}" }, lang, {
              decision: pick(label, lang),
            })
          : item.body,
      };
    }
    case "recommendation_appointment_request": {
      const title = text(item, "title")
        ?? legacy(item.body, /^Appointment requested for recommendation:\s*([\s\S]*)$/)?.[1]?.trim()
        ?? "";
      return {
        title: pick({ ru: "Пациент запросил приём", de: "Patient hat einen Termin angefragt" }, lang),
        body: title
          ? fill({ ru: "Приём по рекомендации: {title}", de: "Termin zur Empfehlung: {title}" }, lang, { title })
          : null,
      };
    }
    case "recommendation_reminder": {
      const title = text(item, "title") ?? legacy(item.body, /^Erinnerung:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
      return {
        title: pick({ ru: "Напоминание о рекомендации", de: "Erinnerung an Empfehlung" }, lang),
        body: title ? fill({ ru: "Напоминание: {title}", de: "Erinnerung: {title}" }, lang, { title }) : null,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// SOP
// ---------------------------------------------------------------------------

function sop(item: NotificationFacts, lang: Lang): NotificationCopy | null {
  const tr = translationsFor(lang);
  if (item.kind === "sop_ack_request") {
    const title = text(item, "sop_title") ?? legacy(item.title, /^Acknowledge SOP:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
    return {
      title: fill({ ru: "Подтвердите ознакомление с SOP: {title}", de: "SOP zur Kenntnis nehmen: {title}" }, lang, { title }),
      body: pick({
        ru: "В разделе SOP вас ждёт запрос на подтверждение.",
        de: "Im SOP-Bereich wartet eine Bestätigungsanfrage.",
      }, lang),
    };
  }
  if (item.kind === "sop_review_update") {
    const legacyTitle = legacy(item.title, /^SOP (approved|changes requested):\s*([\s\S]*)$/);
    const approved = (text(item, "decision") ?? (legacyTitle?.[1] === "approved" ? "approve" : "reject")) === "approve";
    const title = text(item, "sop_title") ?? legacyTitle?.[2]?.trim() ?? "";
    return approved
      ? {
          title: fill({ ru: "SOP утверждён: {title}", de: "SOP freigegeben: {title}" }, lang, { title }),
          body: pick({
            ru: "SOP виден утверждённому кругу получателей.",
            de: "Die SOP ist jetzt für den freigegebenen Empfängerkreis sichtbar.",
          }, lang),
        }
      : {
          title: fill({ ru: "По SOP запрошены правки: {title}", de: "SOP-Änderungen angefordert: {title}" }, lang, { title }),
          body: pick({
            ru: "SOP возвращён: перед утверждением нужны правки.",
            de: "Die SOP wurde zurückgegeben und muss vor der Freigabe angepasst werden.",
          }, lang),
        };
  }
  if (item.kind === "sop_review_request") {
    const legacyTitle = legacy(item.title, /^SOP review (requested|updated):\s*([\s\S]*)$/);
    const title = text(item, "sop_title") ?? legacyTitle?.[2]?.trim() ?? "";
    const resubmitted = flag(item, "resubmitted") ?? (legacyTitle?.[1] === "updated");
    const role = text(item, "submitter_role")
      ?? (/patient manager/.test(item.body ?? "") ? "patient_manager" : /teamlead interpreter/.test(item.body ?? "") ? "teamlead_interpreter" : null);
    const roleLabel = role ? (tr[`role_${role}` as keyof Translations] as string | undefined) ?? humanizeAuditCode(role) : null;
    const status = resubmitted
      ? pick({ ru: "SOP снова ждёт вашей проверки.", de: "Die SOP wartet erneut auf Ihre Prüfung." }, lang)
      : pick({ ru: "SOP ждёт вашей проверки.", de: "Die SOP wartet auf Ihre Prüfung." }, lang);
    return {
      title: resubmitted
        ? fill({ ru: "SOP обновлён и ждёт проверки: {title}", de: "SOP aktualisiert, Prüfung nötig: {title}" }, lang, { title })
        : fill({ ru: "SOP на проверку: {title}", de: "SOP zur Prüfung: {title}" }, lang, { title }),
      body: roleLabel
        ? `${fill({ ru: "Отправитель: {role}.", de: "Eingereicht von: {role}." }, lang, { role: roleLabel })} ${status}`
        : status,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------

/**
 * The RU/DE wording of a notification of the kinds above, or null for a kind
 * this module does not know (the caller then shows the stored text).
 */
export function notificationCopyFromFacts(
  item: NotificationFacts,
  lang: Lang,
): NotificationCopy | null {
  const fixed = FIXED_COPY[item.kind];
  if (fixed) {
    return { title: pick(fixed.title, lang), body: fixed.body ? pick(fixed.body, lang) : null };
  }
  switch (item.kind) {
    case "new_lead":
      return newLead(item, lang);
    case "lead_payer_submitted":
      return leadPayerSubmitted(item, lang);
    case "security_incident":
      return securityIncident(item, lang);
    case "privacy_request":
      return privacyRequest(item, lang);
    case "appointment_request":
      return appointmentRequest(item, lang);
    case "appointment_request_update":
      return appointmentRequestUpdate(item, lang);
    case "signature_request_closed":
    case "signature_request_failed":
    case "signature_review_required":
    case "signature_completed":
      return signature(item, lang);
    case "medication_expiry_confirmation":
      return medicationExpiry(item, lang);
    case "feedback":
      return patientFeedback(item, lang);
    case "patient_upload":
      return patientUpload(item, lang);
    case "interpreter_upload":
      return interpreterUpload(item, lang);
    case "document_release":
      return documentRelease(item, lang);
    case "direct_message":
    case "direct_message_attachment":
      return directMessage(item, lang);
    case "patient_assignment":
    case "patient_assignment_revoked":
      return patientAssignment(item, lang);
    case "recommendation":
    case "recommendation_decision":
    case "recommendation_appointment_request":
    case "recommendation_reminder":
      return recommendation(item, lang);
    case "sop_ack_request":
    case "sop_review_update":
    case "sop_review_request":
      return sop(item, lang);
    default:
      return null;
  }
}
