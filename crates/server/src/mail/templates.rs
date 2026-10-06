//! GMED e-mail templates: branded HTML with a plain-text alternative.
//!
//! The HTML is table-based with inline styles for mail clients. The only
//! remote resource is the GMED logo from the console's own server
//! (`/gmed-logo.png`, the same URL for everyone, so it identifies no one); a
//! client that blocks images shows the styled alt text "GMED" instead. No
//! fonts, styles or tracking load from anywhere. Every value from the
//! database is escaped.

use chrono::NaiveDate;

/// Brand colours of the console and the PDF letterhead.
const BRAND: &str = "#f97316";
const BRAND_SOFT: &str = "#fff4ed";
const BRAND_BORDER: &str = "#fed7aa";
const INK: &str = "#111827";
const MUTED: &str = "#6b7280";
const PAGE: &str = "#f4f4f5";
const FONT: &str =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO: &str = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailLanguage {
    De,
    En,
    Ru,
    Uk,
}

impl MailLanguage {
    /// The language of a lead (`de`, `ru-RU`, `uk`, …); German otherwise.
    pub fn from_code(code: Option<&str>) -> Self {
        let base = code
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .split(['-', '_'])
            .next()
            .unwrap_or_default()
            .to_string();
        match base.as_str() {
            "en" => Self::En,
            "ru" => Self::Ru,
            "uk" | "ua" => Self::Uk,
            _ => Self::De,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::De => "de",
            Self::En => "en",
            Self::Ru => "ru",
            Self::Uk => "uk",
        }
    }
}

/// The agency identity for the footer, from the company settings. Every part
/// is optional: a missing setting leaves its line out.
#[derive(Debug, Clone, Default)]
pub struct AgencyIdentity {
    pub name: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
}

impl AgencyIdentity {
    fn lines(&self) -> Vec<String> {
        let mut lines = Vec::new();
        if let Some(name) = non_empty(self.name.as_deref()) {
            lines.push(name.to_string());
        }
        if let Some(address) = non_empty(self.address.as_deref()) {
            let address = address
                .replace('\r', "\n")
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            if !address.is_empty() {
                lines.push(address);
            }
        }
        let contacts = [
            self.phone.as_deref(),
            self.email.as_deref(),
            self.website.as_deref().map(|website| {
                website
                    .trim()
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
                    .trim_end_matches('/')
            }),
        ]
        .into_iter()
        .filter_map(non_empty)
        .collect::<Vec<_>>();
        if !contacts.is_empty() {
            lines.push(contacts.join(" · "));
        }
        lines
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// Whose login an e-mail describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginAudience {
    /// The lead fills in the request.
    Lead,
    /// A parent fills in a minor's request.
    Guardian,
    /// A patient uses the portal (appointments, documents, invoices).
    Patient,
}

/// Sign-in data of a lead's portal login (or of a parent filling in a minor's
/// request), sent on a staff member's click.
#[derive(Debug, Clone)]
pub struct PortalLoginEmail<'a> {
    pub language: MailLanguage,
    pub recipient_name: &'a str,
    pub login: &'a str,
    pub password: &'a str,
    /// Full sign-in address, e.g. `https://console.gmed-health.com/login`.
    pub login_url: &'a str,
    /// The request is deleted after this day unless it moves on.
    pub complete_by: Option<NaiveDate>,
    /// Who the login belongs to: the wording differs.
    pub audience: LoginAudience,
    pub agency: &'a AgencyIdentity,
    /// The GMED logo on the console ([`logo_url`]); without it the header
    /// shows the text wordmark.
    pub logo_url: Option<&'a str>,
}

/// Path of the logo the console serves (`frontend/public/gmed-logo.png`,
/// 726 × 286 px, black on transparent).
pub const LOGO_PATH: &str = "/gmed-logo.png";
/// Shown size in the e-mail header; the file has about 5× the pixels for
/// sharp rendering on high-density screens.
const LOGO_WIDTH: u32 = 132;
const LOGO_HEIGHT: u32 = 52;

/// The logo URL on `console_url` (an origin without a trailing slash).
pub fn logo_url(console_url: &str) -> String {
    format!("{}{LOGO_PATH}", console_url.trim_end_matches('/'))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedEmail {
    pub subject: String,
    pub text: String,
    pub html: String,
}

struct LoginCopy {
    subject: &'static str,
    preheader: &'static str,
    portal: &'static str,
    greeting_named: &'static str,
    greeting: &'static str,
    intro: &'static str,
    intro_guardian: &'static str,
    intro_patient: &'static str,
    credentials_heading: &'static str,
    login_label: &'static str,
    password_label: &'static str,
    button: &'static str,
    link_hint: &'static str,
    complete_by: &'static str,
    keep_safe: &'static str,
    not_you: &'static str,
    automatic: &'static str,
}

fn login_copy(language: MailLanguage) -> LoginCopy {
    match language {
        MailLanguage::De => LoginCopy {
            subject: "Ihr Zugang zum GMED-Patientenportal",
            preheader: "Ihre Anmeldedaten für das GMED-Patientenportal",
            portal: "Patientenportal",
            greeting_named: "Guten Tag {name},",
            greeting: "Guten Tag,",
            intro: "Ihr Zugang zum GMED-Patientenportal ist eingerichtet. Bitte tragen Sie dort Ihre persönlichen Daten ein und laden Sie Ihre Unterlagen hoch.",
            intro_guardian: "Ihr Zugang zum GMED-Patientenportal ist eingerichtet. Bitte tragen Sie dort die Angaben zur Anfrage für Ihr Kind ein und laden Sie die Unterlagen hoch.",
            intro_patient: "Ihr Zugang zum GMED-Patientenportal ist eingerichtet. Dort finden Sie Ihre Termine, Dokumente und Rechnungen und erreichen Ihr Betreuungsteam.",
            credentials_heading: "Ihre Anmeldedaten",
            login_label: "Benutzername",
            password_label: "Passwort",
            button: "Zum Portal anmelden",
            link_hint: "Falls die Schaltfläche nicht funktioniert, öffnen Sie diese Adresse:",
            complete_by: "Bitte vervollständigen Sie Ihre Angaben bis zum {date}. Danach werden die Anfrage und die hochgeladenen Unterlagen gelöscht.",
            keep_safe: "Bewahren Sie diese Zugangsdaten sorgfältig auf und geben Sie sie nicht weiter. GMED fragt Sie niemals per E-Mail oder Telefon nach Ihrem Passwort.",
            not_you: "Sie haben keine Anfrage bei GMED gestellt? Dann können Sie diese E-Mail ignorieren.",
            automatic: "Diese E-Mail wurde automatisch versendet.",
        },
        MailLanguage::En => LoginCopy {
            subject: "Your access to the GMED patient portal",
            preheader: "Your sign-in details for the GMED patient portal",
            portal: "Patient portal",
            greeting_named: "Hello {name},",
            greeting: "Hello,",
            intro: "Your access to the GMED patient portal is ready. Please enter your personal details there and upload your documents.",
            intro_guardian: "Your access to the GMED patient portal is ready. Please enter the details of the request for your child there and upload the documents.",
            intro_patient: "Your access to the GMED patient portal is ready. There you find your appointments, documents and invoices and reach your care team.",
            credentials_heading: "Your sign-in details",
            login_label: "Login",
            password_label: "Password",
            button: "Sign in to the portal",
            link_hint: "If the button does not work, open this address:",
            complete_by: "Please complete your details by {date}. After that, the request and the uploaded documents are deleted.",
            keep_safe: "Keep these sign-in details safe and do not share them. GMED never asks for your password by e-mail or phone.",
            not_you: "You have not sent a request to GMED? Then you can ignore this e-mail.",
            automatic: "This e-mail was sent automatically.",
        },
        MailLanguage::Ru => LoginCopy {
            subject: "Ваш доступ в портал пациента GMED",
            preheader: "Данные для входа в портал пациента GMED",
            portal: "Портал пациента",
            greeting_named: "Здравствуйте, {name}!",
            greeting: "Здравствуйте!",
            intro: "Ваш доступ в портал пациента GMED готов. Пожалуйста, заполните там свои данные и загрузите документы.",
            intro_guardian: "Ваш доступ в портал пациента GMED готов. Пожалуйста, заполните там данные заявки для вашего ребёнка и загрузите документы.",
            intro_patient: "Ваш доступ в портал пациента GMED готов. Там вы найдёте свои записи, документы и счета и сможете связаться со своей командой сопровождения.",
            credentials_heading: "Данные для входа",
            login_label: "Логин",
            password_label: "Пароль",
            button: "Войти в портал",
            link_hint: "Если кнопка не работает, откройте этот адрес:",
            complete_by: "Пожалуйста, заполните данные до {date}. После этого заявка и загруженные документы будут удалены.",
            keep_safe: "Храните эти данные в надёжном месте и никому их не передавайте. GMED никогда не спрашивает пароль по электронной почте или по телефону.",
            not_you: "Вы не обращались в GMED? Тогда просто не обращайте внимания на это письмо.",
            automatic: "Это письмо отправлено автоматически.",
        },
        MailLanguage::Uk => LoginCopy {
            subject: "Ваш доступ до порталу пацієнта GMED",
            preheader: "Дані для входу до порталу пацієнта GMED",
            portal: "Портал пацієнта",
            greeting_named: "Вітаємо, {name}!",
            greeting: "Вітаємо!",
            intro: "Ваш доступ до порталу пацієнта GMED готовий. Будь ласка, заповніть там свої дані та завантажте документи.",
            intro_guardian: "Ваш доступ до порталу пацієнта GMED готовий. Будь ласка, заповніть там дані заявки для вашої дитини та завантажте документи.",
            intro_patient: "Ваш доступ до порталу пацієнта GMED готовий. Там ви знайдете свої записи, документи й рахунки та зможете зв'язатися зі своєю командою супроводу.",
            credentials_heading: "Дані для входу",
            login_label: "Логін",
            password_label: "Пароль",
            button: "Увійти до порталу",
            link_hint: "Якщо кнопка не працює, відкрийте цю адресу:",
            complete_by: "Будь ласка, заповніть дані до {date}. Після цього заявку та завантажені документи буде видалено.",
            keep_safe: "Зберігайте ці дані в надійному місці й нікому їх не передавайте. GMED ніколи не запитує пароль електронною поштою чи телефоном.",
            not_you: "Ви не зверталися до GMED? Тоді просто не зважайте на цей лист.",
            automatic: "Цей лист надіслано автоматично.",
        },
    }
}

/// Escapes text for HTML element content and quoted attribute values.
pub fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

pub fn portal_login(email: &PortalLoginEmail<'_>) -> RenderedEmail {
    let copy = login_copy(email.language);
    let name = email.recipient_name.trim();
    let greeting = if name.is_empty() {
        copy.greeting.to_string()
    } else {
        copy.greeting_named.replace("{name}", name)
    };
    let intro = match email.audience {
        LoginAudience::Lead => copy.intro,
        LoginAudience::Guardian => copy.intro_guardian,
        LoginAudience::Patient => copy.intro_patient,
    };
    let complete_by = email.complete_by.map(|date| {
        copy.complete_by
            .replace("{date}", &date.format("%d.%m.%Y").to_string())
    });
    let footer = email.agency.lines();

    let mut text = vec![
        greeting.clone(),
        String::new(),
        intro.to_string(),
        String::new(),
        format!("{}: {}", copy.login_label, email.login),
        format!("{}: {}", copy.password_label, email.password),
        format!("{}: {}", copy.button, email.login_url),
        String::new(),
    ];
    if let Some(complete_by) = &complete_by {
        text.push(complete_by.clone());
        text.push(String::new());
    }
    text.push(copy.keep_safe.to_string());
    text.push(copy.not_you.to_string());
    text.push(String::new());
    // "-- " is the standard signature delimiter of plain-text mail.
    text.push("-- ".to_string());
    text.extend(footer.iter().cloned());
    text.push(copy.automatic.to_string());

    let html = login_html(
        email,
        &copy,
        &greeting,
        intro,
        complete_by.as_deref(),
        &footer,
    );
    RenderedEmail {
        subject: copy.subject.to_string(),
        text: text.join("\n"),
        html,
    }
}

fn paragraph(content: &str) -> String {
    format!(
        r#"<p style="margin:0 0 16px;font:15px/1.6 {FONT};color:{INK};">{}</p>"#,
        escape_html(content)
    )
}

fn note(content: &str) -> String {
    format!(
        r#"<p style="margin:0 0 16px;padding:12px 14px;border-left:3px solid {BRAND};background:{BRAND_SOFT};font:14px/1.55 {FONT};color:{INK};">{}</p>"#,
        escape_html(content)
    )
}

fn small(content: &str, margin_bottom: u32) -> String {
    format!(
        r#"<p style="margin:0 0 {margin_bottom}px;font:13px/1.55 {FONT};color:{MUTED};">{}</p>"#,
        escape_html(content)
    )
}

/// The branded frame every GMED e-mail shares: orange rule, logo with a label,
/// the white card with `body` (already HTML) and the agency footer.
struct Shell<'a> {
    language: MailLanguage,
    subject: &'a str,
    preheader: &'a str,
    /// Next to the logo, e.g. "Patientenportal".
    label: &'a str,
    logo_url: Option<&'a str>,
    footer: &'a [String],
    automatic: &'a str,
}

fn shell(frame: &Shell<'_>, body: &str) -> String {
    let footer = frame
        .footer
        .iter()
        .map(|line| escape_html(line))
        .collect::<Vec<_>>()
        .join("<br>");
    // The alt text carries the wordmark's look when a client blocks images.
    let wordmark_style = format!("font:800 26px/1 {FONT};letter-spacing:3px;color:{INK};");
    let brand_mark = match frame.logo_url {
        Some(logo) => format!(
            r#"<img src="{}" width="{LOGO_WIDTH}" height="{LOGO_HEIGHT}" alt="GMED" style="display:block;border:0;outline:none;text-decoration:none;width:{LOGO_WIDTH}px;height:auto;{wordmark_style}">"#,
            escape_html(logo)
        ),
        None => "GMED".to_string(),
    };
    format!(
        r#"<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background:{PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAGE};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
<tr><td style="height:4px;line-height:4px;font-size:0;background:{BRAND};">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:16px;{wordmark_style}">{brand_mark}</td>
<td style="vertical-align:middle;padding-left:14px;border-left:1px solid #e4e4e7;font:13px/1.2 {FONT};color:{MUTED};">{label}</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 32px 8px;">
{body}
</td></tr>
<tr><td style="padding:18px 32px 24px;border-top:1px solid #e4e4e7;font:12px/1.6 {FONT};color:{MUTED};">
{footer}{footer_break}{automatic}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
"#,
        lang = frame.language.code(),
        subject = escape_html(frame.subject),
        preheader = escape_html(frame.preheader),
        label = escape_html(frame.label),
        footer_break = if frame.footer.is_empty() {
            ""
        } else {
            "<br><br>"
        },
        automatic = escape_html(frame.automatic),
    )
}

fn login_html(
    email: &PortalLoginEmail<'_>,
    copy: &LoginCopy,
    greeting: &str,
    intro: &str,
    complete_by: Option<&str>,
    footer: &[String],
) -> String {
    let url = escape_html(email.login_url);
    // Label above the value: fits a phone without squeezing the value, and
    // the password never wraps, so it is copied in one piece.
    let credential_row = |label: &str, value: &str, mono: bool| {
        let value_style = if mono {
            format!("font:600 18px/1.4 {MONO};letter-spacing:1px;white-space:nowrap;")
        } else {
            format!("font:600 15px/1.4 {FONT};overflow-wrap:anywhere;word-break:break-word;")
        };
        format!(
            r#"<tr><td style="padding:8px 0 0;font:12px/1.4 {FONT};color:{MUTED};">{}</td></tr><tr><td style="padding:2px 0 6px;{value_style}color:{INK};">{}</td></tr>"#,
            escape_html(label),
            escape_html(value)
        )
    };
    let body = format!(
        r#"<p style="margin:0 0 16px;font:600 17px/1.5 {FONT};color:{INK};">{greeting}</p>
{intro}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:{BRAND_SOFT};border:1px solid {BRAND_BORDER};border-radius:10px;">
<tr><td style="padding:16px 20px;">
<p style="margin:0 0 8px;font:600 12px/1.4 {FONT};letter-spacing:.06em;text-transform:uppercase;color:{MUTED};">{credentials_heading}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
{login_row}
{password_row}
</table>
</td></tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
<td style="border-radius:8px;background:{BRAND};">
<a href="{url}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 24px;font:600 15px/1.2 {FONT};color:#ffffff;text-decoration:none;border-radius:8px;">{button}</a>
</td>
</tr></table>
<p style="margin:0 0 20px;font:13px/1.5 {FONT};color:{MUTED};">{link_hint}<br><a href="{url}" target="_blank" rel="noopener" style="color:{BRAND};word-break:break-all;">{url}</a></p>
{complete_by}
{keep_safe}
{not_you}"#,
        greeting = escape_html(greeting),
        intro = paragraph(intro),
        credentials_heading = escape_html(copy.credentials_heading),
        login_row = credential_row(copy.login_label, email.login, false),
        password_row = credential_row(copy.password_label, email.password, true),
        button = escape_html(copy.button),
        link_hint = escape_html(copy.link_hint),
        complete_by = complete_by.map(note).unwrap_or_default(),
        keep_safe = small(copy.keep_safe, 12),
        not_you = small(copy.not_you, 24),
    );
    shell(
        &Shell {
            language: email.language,
            subject: copy.subject,
            preheader: copy.preheader,
            label: copy.portal,
            logo_url: email.logo_url,
            footer,
            automatic: copy.automatic,
        },
        &body,
    )
}

/// The test letter of the API connections page: proves that the saved Mittaro
/// key and sender work, without any personal data of patients.
#[derive(Debug, Clone)]
pub struct ConnectionTestEmail<'a> {
    pub language: MailLanguage,
    /// Who pressed "send test letter".
    pub requested_by: &'a str,
    /// When, already formatted (`DD.MM.YYYY HH:MM`, Berlin).
    pub requested_at: &'a str,
    pub sender: &'a str,
    pub agency: &'a AgencyIdentity,
    pub logo_url: Option<&'a str>,
}

struct TestCopy {
    subject: &'static str,
    label: &'static str,
    heading: &'static str,
    body: &'static str,
    requested: &'static str,
    sender: &'static str,
    automatic: &'static str,
}

fn test_copy(language: MailLanguage) -> TestCopy {
    match language {
        MailLanguage::De => TestCopy {
            subject: "GMED: Testnachricht des E-Mail-Versands",
            label: "E-Mail-Versand",
            heading: "Der E-Mail-Versand funktioniert.",
            body: "Diese Testnachricht wurde über Mittaro mit dem in der GMED-Konsole gespeicherten Zugang versendet. So sehen auch die Nachrichten an Patientinnen und Patienten aus.",
            requested: "Angefordert von {name} am {at}.",
            sender: "Absender: {sender}",
            automatic: "Diese E-Mail wurde automatisch versendet.",
        },
        MailLanguage::En => TestCopy {
            subject: "GMED: e-mail delivery test",
            label: "E-mail delivery",
            heading: "E-mail delivery works.",
            body: "This test message was sent through Mittaro with the access saved in the GMED console. Messages to patients look the same.",
            requested: "Requested by {name} on {at}.",
            sender: "Sender: {sender}",
            automatic: "This e-mail was sent automatically.",
        },
        MailLanguage::Ru => TestCopy {
            subject: "GMED: тестовое письмо",
            label: "Отправка e-mail",
            heading: "Отправка e-mail работает.",
            body: "Это тестовое письмо отправлено через Mittaro с доступом, сохранённым в консоли GMED. Так же выглядят письма пациентам.",
            requested: "Запросил(а) {name}, {at}.",
            sender: "Отправитель: {sender}",
            automatic: "Это письмо отправлено автоматически.",
        },
        MailLanguage::Uk => TestCopy {
            subject: "GMED: тестовий лист",
            label: "Надсилання e-mail",
            heading: "Надсилання e-mail працює.",
            body: "Цей тестовий лист надіслано через Mittaro з доступом, збереженим у консолі GMED. Так само виглядають листи пацієнтам.",
            requested: "Запит від {name}, {at}.",
            sender: "Відправник: {sender}",
            automatic: "Цей лист надіслано автоматично.",
        },
    }
}

/// The invitation of a third-party payer to the payer's own link (owner spec
/// "Patientenformular", section 10, phase 3a): who named the payer, the link,
/// until when it works, the short Art. 14 DSGVO notice (the data come from the
/// patient side) and that a confirmation code follows when the link is
/// opened. No medical word: the payer learns only the patient's name.
#[derive(Debug, Clone)]
pub struct PayerInvitationEmail<'a> {
    pub language: MailLanguage,
    /// The payer's name as the lead entered it (a person or an organisation).
    pub payer_name: &'a str,
    /// A company, an organisation or an insurer pays (QA 2026-10-06, C7-b):
    /// a neutral greeting without the organisation's name, and the patient
    /// named "your organisation" as the paying party.
    pub organisation: bool,
    /// "First Last" of the patient (the lead).
    pub patient_name: &'a str,
    /// `{console_url}/payer#<token>`; the token is in the fragment only.
    pub link_url: &'a str,
    pub expires_on: NaiveDate,
    /// The full privacy notice, `{console_url}/legal#privacy`.
    pub privacy_url: &'a str,
    pub agency: &'a AgencyIdentity,
    pub logo_url: Option<&'a str>,
}

/// The confirmation code of the payer's link, mailed to the link's address.
#[derive(Debug, Clone)]
pub struct PayerCodeEmail<'a> {
    pub language: MailLanguage,
    /// Six digits.
    pub code: &'a str,
    pub agency: &'a AgencyIdentity,
    pub logo_url: Option<&'a str>,
}

struct PayerInvitationCopy {
    subject: &'static str,
    preheader: &'static str,
    preheader_organisation: &'static str,
    label: &'static str,
    greeting_named: &'static str,
    greeting: &'static str,
    intro: &'static str,
    intro_organisation: &'static str,
    button: &'static str,
    link_hint: &'static str,
    code_hint: &'static str,
    privacy_heading: &'static str,
    privacy: &'static str,
    not_you: &'static str,
    automatic: &'static str,
}

fn payer_invitation_copy(language: MailLanguage) -> PayerInvitationCopy {
    match language {
        MailLanguage::De => PayerInvitationCopy {
            subject: "Angaben zur Kostenübernahme – GMED",
            preheader: "Bitte machen Sie Ihre Angaben als zahlende Person",
            preheader_organisation: "Bitte machen Sie die Angaben zur zahlenden Organisation",
            label: "Kostenübernahme",
            greeting_named: "Guten Tag {name},",
            greeting: "Guten Tag,",
            intro: "{patient} hat Sie als zahlende Person für eine Anfrage bei GMED benannt. Bitte machen Sie Ihre Angaben über den folgenden Link (gültig bis {date}).",
            intro_organisation: "{patient} hat Ihre Organisation als zahlende Partei für eine Anfrage bei GMED benannt. Bitte machen Sie die Angaben zu Ihrer Organisation über den folgenden Link (gültig bis {date}).",
            button: "Angaben machen",
            link_hint: "Falls die Schaltfläche nicht funktioniert, öffnen Sie diese Adresse:",
            code_hint: "Beim Öffnen senden wir einen Bestätigungscode an diese Adresse.",
            privacy_heading: "Datenschutzhinweis (Art. 14 DSGVO)",
            privacy: "Verantwortlich für die Verarbeitung Ihrer Daten ist {controller}. Ihren Namen und Ihre Kontaktdaten haben wir von {patient} erhalten. Wir verarbeiten sie, um Sie nach §§ 10–12 GwG zu identifizieren, die Kostenübernahme zu klären und Rechnungen zu stellen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b und c DSGVO. Wir speichern die Angaben fünf Jahre nach dem Ende der Geschäftsbeziehung (§ 8 Abs. 4 GwG). Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Widerspruch sowie auf Beschwerde bei einer Aufsichtsbehörde. Vollständige Datenschutzhinweise: {url}",
            not_you: "Sind Sie nicht gemeint, können Sie diese E-Mail ignorieren; der Link verfällt dann von selbst.",
            automatic: "Diese E-Mail wurde automatisch versendet.",
        },
        MailLanguage::En => PayerInvitationCopy {
            subject: "Details for the cost coverage – GMED",
            preheader: "Please enter your details as the paying person",
            preheader_organisation: "Please enter the details of the paying organisation",
            label: "Cost coverage",
            greeting_named: "Hello {name},",
            greeting: "Hello,",
            intro: "{patient} has named you as the paying person for a request to GMED. Please enter your details using the following link (valid until {date}).",
            intro_organisation: "{patient} has named your organisation as the paying party for a request to GMED. Please enter your organisation's details using the following link (valid until {date}).",
            button: "Enter my details",
            link_hint: "If the button does not work, open this address:",
            code_hint: "When you open the link, we send a confirmation code to this address.",
            privacy_heading: "Privacy notice (Art. 14 GDPR)",
            privacy: "The controller of your data is {controller}. We received your name and contact details from {patient}. We process them to identify you under Sections 10–12 of the German Money Laundering Act (GwG), to settle the cost coverage and to issue invoices. The legal basis is Art. 6(1)(b) and (c) GDPR. We keep the data for five years after the end of the business relationship (Section 8(4) GwG). You have the right of access, rectification, erasure, restriction of processing and objection, and the right to lodge a complaint with a supervisory authority. Full privacy notice: {url}",
            not_you: "If you are not the person meant, you can ignore this e-mail; the link then expires by itself.",
            automatic: "This e-mail was sent automatically.",
        },
        MailLanguage::Ru => PayerInvitationCopy {
            subject: "Данные для оплаты расходов – GMED",
            preheader: "Пожалуйста, укажите свои данные как плательщик",
            preheader_organisation: "Пожалуйста, укажите данные организации-плательщика",
            label: "Оплата расходов",
            greeting_named: "Здравствуйте, {name}!",
            greeting: "Здравствуйте!",
            intro: "{patient} указал(а) вас как плательщика по обращению в GMED. Пожалуйста, укажите свои данные по ссылке ниже (действует до {date}).",
            intro_organisation: "{patient} указал(а) вашу организацию как плательщика по обращению в GMED. Пожалуйста, укажите данные вашей организации по ссылке ниже (действует до {date}).",
            button: "Указать данные",
            link_hint: "Если кнопка не работает, откройте этот адрес:",
            code_hint: "При открытии ссылки мы отправим код подтверждения на этот адрес.",
            privacy_heading: "Информация о защите данных (ст. 14 DSGVO)",
            privacy: "Ответственный за обработку ваших данных — {controller}. Ваше имя и контактные данные мы получили от {patient}. Мы обрабатываем их, чтобы идентифицировать вас согласно §§ 10–12 GwG (закон Германии о противодействии отмыванию денег), урегулировать оплату расходов и выставлять счета. Правовое основание — ст. 6 п. 1 лит. b и c DSGVO. Мы храним данные пять лет после окончания деловых отношений (§ 8 абз. 4 GwG). Вы имеете право на информацию, исправление, удаление, ограничение обработки и возражение, а также право подать жалобу в надзорный орган. Полная информация о защите данных: {url}",
            not_you: "Если письмо адресовано не вам, просто не обращайте на него внимания — ссылка перестанет действовать сама.",
            automatic: "Это письмо отправлено автоматически.",
        },
        MailLanguage::Uk => PayerInvitationCopy {
            subject: "Дані для оплати витрат – GMED",
            preheader: "Будь ласка, вкажіть свої дані як платник",
            preheader_organisation: "Будь ласка, вкажіть дані організації-платника",
            label: "Оплата витрат",
            greeting_named: "Вітаємо, {name}!",
            greeting: "Вітаємо!",
            intro: "{patient} вказав(ла) вас як платника за зверненням до GMED. Будь ласка, вкажіть свої дані за посиланням нижче (діє до {date}).",
            intro_organisation: "{patient} вказав(ла) вашу організацію як платника за зверненням до GMED. Будь ласка, вкажіть дані вашої організації за посиланням нижче (діє до {date}).",
            button: "Вказати дані",
            link_hint: "Якщо кнопка не працює, відкрийте цю адресу:",
            code_hint: "Під час відкриття посилання ми надішлемо код підтвердження на цю адресу.",
            privacy_heading: "Інформація про захист даних (ст. 14 DSGVO)",
            privacy: "Відповідальний за обробку ваших даних — {controller}. Ваше ім'я та контактні дані ми отримали від {patient}. Ми обробляємо їх, щоб ідентифікувати вас відповідно до §§ 10–12 GwG (закон Німеччини про запобігання відмиванню грошей), урегулювати оплату витрат і виставляти рахунки. Правова підстава — ст. 6 п. 1 літ. b і c DSGVO. Ми зберігаємо дані п'ять років після завершення ділових відносин (§ 8 абз. 4 GwG). Ви маєте право на доступ, виправлення, видалення, обмеження обробки та заперечення, а також право подати скаргу до наглядового органу. Повна інформація про захист даних: {url}",
            not_you: "Якщо лист адресовано не вам, просто не зважайте на нього — посилання перестане діяти саме.",
            automatic: "Цей лист надіслано автоматично.",
        },
    }
}

pub fn payer_invitation(email: &PayerInvitationEmail<'_>) -> RenderedEmail {
    let copy = payer_invitation_copy(email.language);
    let name = email.payer_name.trim();
    // An organisation is not greeted by its name.
    let greeting = if name.is_empty() || email.organisation {
        copy.greeting.to_string()
    } else {
        copy.greeting_named.replace("{name}", name)
    };
    let (intro, preheader) = if email.organisation {
        (copy.intro_organisation, copy.preheader_organisation)
    } else {
        (copy.intro, copy.preheader)
    };
    let patient = email.patient_name.trim();
    let intro = intro
        .replace("{patient}", patient)
        .replace("{date}", &email.expires_on.format("%d.%m.%Y").to_string());
    let controller = non_empty(email.agency.name.as_deref()).unwrap_or("GMED");
    let privacy = copy
        .privacy
        .replace("{controller}", controller)
        .replace("{patient}", patient)
        .replace("{url}", email.privacy_url);
    let footer = email.agency.lines();

    let mut text = vec![
        greeting.clone(),
        String::new(),
        intro.clone(),
        String::new(),
        format!("{}: {}", copy.button, email.link_url),
        String::new(),
        copy.code_hint.to_string(),
        String::new(),
        copy.privacy_heading.to_string(),
        privacy.clone(),
        String::new(),
        copy.not_you.to_string(),
        String::new(),
        "-- ".to_string(),
    ];
    text.extend(footer.iter().cloned());
    text.push(copy.automatic.to_string());

    let url = escape_html(email.link_url);
    let body = format!(
        r#"<p style="margin:0 0 16px;font:600 17px/1.5 {FONT};color:{INK};">{greeting}</p>
{intro}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
<td style="border-radius:8px;background:{BRAND};">
<a href="{url}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 24px;font:600 15px/1.2 {FONT};color:#ffffff;text-decoration:none;border-radius:8px;">{button}</a>
</td>
</tr></table>
<p style="margin:0 0 20px;font:13px/1.5 {FONT};color:{MUTED};">{link_hint}<br><a href="{url}" target="_blank" rel="noopener" style="color:{BRAND};word-break:break-all;">{url}</a></p>
{code_hint}
<p style="margin:0 0 6px;font:600 13px/1.4 {FONT};color:{INK};">{privacy_heading}</p>
{privacy}
{not_you}"#,
        greeting = escape_html(&greeting),
        intro = paragraph(&intro),
        button = escape_html(copy.button),
        link_hint = escape_html(copy.link_hint),
        code_hint = note(copy.code_hint),
        privacy_heading = escape_html(copy.privacy_heading),
        privacy = small(&privacy, 16),
        not_you = small(copy.not_you, 24),
    );
    let html = shell(
        &Shell {
            language: email.language,
            subject: copy.subject,
            preheader,
            label: copy.label,
            logo_url: email.logo_url,
            footer: &footer,
            automatic: copy.automatic,
        },
        &body,
    );
    RenderedEmail {
        subject: copy.subject.to_string(),
        text: text.join("\n"),
        html,
    }
}

struct PayerCodeCopy {
    subject: &'static str,
    label: &'static str,
    heading: &'static str,
    intro: &'static str,
    code_label: &'static str,
    valid: &'static str,
    not_you: &'static str,
    automatic: &'static str,
}

fn payer_code_copy(language: MailLanguage) -> PayerCodeCopy {
    match language {
        MailLanguage::De => PayerCodeCopy {
            subject: "Ihr Bestätigungscode – GMED",
            label: "Kostenübernahme",
            heading: "Ihr Bestätigungscode",
            intro: "Mit diesem Code bestätigen Sie Ihre E-Mail-Adresse für die Angaben zur Kostenübernahme.",
            code_label: "Ihr Bestätigungscode",
            valid: "Der Code ist 15 Minuten gültig. Geben Sie ihn nicht weiter; GMED fragt Sie niemals telefonisch danach.",
            not_you: "Sie haben keinen Code angefordert? Dann können Sie diese E-Mail ignorieren.",
            automatic: "Diese E-Mail wurde automatisch versendet.",
        },
        MailLanguage::En => PayerCodeCopy {
            subject: "Your confirmation code – GMED",
            label: "Cost coverage",
            heading: "Your confirmation code",
            intro: "With this code you confirm your e-mail address for the cost coverage details.",
            code_label: "Your confirmation code",
            valid: "The code is valid for 15 minutes. Do not share it; GMED never asks for it by phone.",
            not_you: "You did not request a code? Then you can ignore this e-mail.",
            automatic: "This e-mail was sent automatically.",
        },
        MailLanguage::Ru => PayerCodeCopy {
            subject: "Ваш код подтверждения – GMED",
            label: "Оплата расходов",
            heading: "Ваш код подтверждения",
            intro: "Этим кодом вы подтверждаете свой адрес электронной почты для данных об оплате расходов.",
            code_label: "Ваш код подтверждения",
            valid: "Код действует 15 минут. Никому его не сообщайте; GMED никогда не спрашивает его по телефону.",
            not_you: "Вы не запрашивали код? Тогда просто не обращайте внимания на это письмо.",
            automatic: "Это письмо отправлено автоматически.",
        },
        MailLanguage::Uk => PayerCodeCopy {
            subject: "Ваш код підтвердження – GMED",
            label: "Оплата витрат",
            heading: "Ваш код підтвердження",
            intro: "Цим кодом ви підтверджуєте свою адресу електронної пошти для даних про оплату витрат.",
            code_label: "Ваш код підтвердження",
            valid: "Код дійсний 15 хвилин. Нікому його не повідомляйте; GMED ніколи не запитує його телефоном.",
            not_you: "Ви не запитували код? Тоді просто не зважайте на цей лист.",
            automatic: "Цей лист надіслано автоматично.",
        },
    }
}

pub fn payer_code(email: &PayerCodeEmail<'_>) -> RenderedEmail {
    let copy = payer_code_copy(email.language);
    let footer = email.agency.lines();
    let mut text = vec![
        copy.intro.to_string(),
        String::new(),
        format!("{}: {}", copy.code_label, email.code),
        String::new(),
        copy.valid.to_string(),
        copy.not_you.to_string(),
        String::new(),
        "-- ".to_string(),
    ];
    text.extend(footer.iter().cloned());
    text.push(copy.automatic.to_string());
    let body = format!(
        r#"<p style="margin:0 0 16px;font:600 17px/1.5 {FONT};color:{INK};">{heading}</p>
{intro}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;background:{BRAND_SOFT};border:1px solid {BRAND_BORDER};border-radius:10px;">
<tr><td style="padding:16px 20px;font:700 28px/1.3 {MONO};letter-spacing:6px;white-space:nowrap;color:{INK};">{code}</td></tr>
</table>
{valid}
{not_you}"#,
        heading = escape_html(copy.heading),
        intro = paragraph(copy.intro),
        code = escape_html(email.code),
        valid = small(copy.valid, 12),
        not_you = small(copy.not_you, 24),
    );
    let html = shell(
        &Shell {
            language: email.language,
            subject: copy.subject,
            preheader: copy.heading,
            label: copy.label,
            logo_url: email.logo_url,
            footer: &footer,
            automatic: copy.automatic,
        },
        &body,
    );
    RenderedEmail {
        subject: copy.subject.to_string(),
        text: text.join("\n"),
        html,
    }
}

pub fn connection_test(email: &ConnectionTestEmail<'_>) -> RenderedEmail {
    let copy = test_copy(email.language);
    let requested = copy
        .requested
        .replace("{name}", email.requested_by.trim())
        .replace("{at}", email.requested_at);
    let sender = copy.sender.replace("{sender}", email.sender);
    let footer = email.agency.lines();
    let mut text = vec![
        copy.heading.to_string(),
        String::new(),
        copy.body.to_string(),
        String::new(),
        requested.clone(),
        sender.clone(),
        String::new(),
        "-- ".to_string(),
    ];
    text.extend(footer.iter().cloned());
    text.push(copy.automatic.to_string());
    let body = format!(
        r#"<p style="margin:0 0 16px;font:600 17px/1.5 {FONT};color:{INK};">{heading}</p>
{body}
{requested}
{sender}"#,
        heading = escape_html(copy.heading),
        body = paragraph(copy.body),
        requested = note(&requested),
        sender = small(&sender, 24),
    );
    let html = shell(
        &Shell {
            language: email.language,
            subject: copy.subject,
            preheader: copy.heading,
            label: copy.label,
            logo_url: email.logo_url,
            footer: &footer,
            automatic: copy.automatic,
        },
        &body,
    );
    RenderedEmail {
        subject: copy.subject.to_string(),
        text: text.join("\n"),
        html,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agency() -> AgencyIdentity {
        AgencyIdentity {
            name: Some("GMED - Agentur für Patientenbetreuung".into()),
            address: Some("Musterstraße 1\n80331 München\nDeutschland".into()),
            phone: Some("+49 89 000000".into()),
            email: Some("info@example.test".into()),
            website: Some("https://gmed-health.com/".into()),
        }
    }

    fn render(language: MailLanguage, name: &str) -> RenderedEmail {
        let agency = agency();
        portal_login(&PortalLoginEmail {
            language,
            recipient_name: name,
            login: "anna@example.test",
            password: "Kq7-mP2x-Rw9t",
            login_url: "https://console.gmed-health.com/login",
            complete_by: NaiveDate::from_ymd_opt(2026, 10, 19),
            audience: LoginAudience::Lead,
            agency: &agency,
            logo_url: Some("https://console.gmed-health.com/gmed-logo.png"),
        })
    }

    #[test]
    fn language_codes_fall_back_to_german() {
        assert_eq!(MailLanguage::from_code(Some("ru-RU")), MailLanguage::Ru);
        assert_eq!(MailLanguage::from_code(Some("UK")), MailLanguage::Uk);
        assert_eq!(MailLanguage::from_code(Some("en_GB")), MailLanguage::En);
        assert_eq!(MailLanguage::from_code(Some("tr")), MailLanguage::De);
        assert_eq!(MailLanguage::from_code(None), MailLanguage::De);
    }

    #[test]
    fn every_language_carries_the_sign_in_data_in_html_and_text() {
        for language in [
            MailLanguage::De,
            MailLanguage::En,
            MailLanguage::Ru,
            MailLanguage::Uk,
        ] {
            let email = render(language, "Anna Muster");
            for part in [&email.text, &email.html] {
                assert!(part.contains("anna@example.test"), "{language:?}");
                assert!(part.contains("Kq7-mP2x-Rw9t"), "{language:?}");
                assert!(part.contains("https://console.gmed-health.com/login"));
                assert!(part.contains("19.10.2026"), "{language:?}");
                assert!(part.contains("Anna Muster"));
                assert!(part.contains("80331 München"));
            }
            assert!(email.subject.contains("GMED"));
            assert!(
                email
                    .html
                    .contains(&format!("<html lang=\"{}\">", language.code()))
            );
        }
    }

    #[test]
    fn the_logo_on_the_console_is_the_only_remote_resource() {
        assert_eq!(
            logo_url("https://console.gmed-health.com/"),
            "https://console.gmed-health.com/gmed-logo.png"
        );
        let html = render(MailLanguage::De, "Anna").html;
        let sources = html.split("src=\"").skip(1).collect::<Vec<_>>();
        assert_eq!(sources.len(), 1);
        assert!(sources[0].starts_with("https://console.gmed-health.com/gmed-logo.png\""));
        assert!(html.contains(r#"alt="GMED""#));
        assert!(!html.contains("url("));
        assert!(!html.contains("<link"));
        assert!(!html.contains("<script"));
        // The only links point to the console.
        for href in html.split("href=\"").skip(1) {
            assert!(href.starts_with("https://console.gmed-health.com/login\""));
        }
    }

    #[test]
    fn without_a_logo_url_the_header_shows_the_text_wordmark() {
        let agency = AgencyIdentity::default();
        let html = portal_login(&PortalLoginEmail {
            language: MailLanguage::En,
            recipient_name: "Anna",
            login: "anna@example.test",
            password: "Kq7-mP2x-Rw9t",
            login_url: "https://console.gmed-health.com/login",
            complete_by: None,
            audience: LoginAudience::Lead,
            agency: &agency,
            logo_url: None,
        })
        .html;
        assert!(!html.contains("<img"));
        assert!(html.contains(">GMED</td>"));
    }

    #[test]
    fn values_are_escaped() {
        let agency = AgencyIdentity::default();
        let email = portal_login(&PortalLoginEmail {
            language: MailLanguage::De,
            recipient_name: "<b>Anna</b> & \"Co\"",
            login: "anna@example.test",
            password: "a<b>&'\"",
            login_url: "https://console.gmed-health.com/login?x=\"><script>",
            complete_by: None,
            audience: LoginAudience::Lead,
            agency: &agency,
            logo_url: Some("https://console.gmed-health.com/gmed-logo.png?\"><script>"),
        });
        assert!(!email.html.contains("<b>Anna</b>"));
        assert!(
            email
                .html
                .contains("&lt;b&gt;Anna&lt;/b&gt; &amp; &quot;Co&quot;")
        );
        assert!(email.html.contains("a&lt;b&gt;&amp;&#39;&quot;"));
        assert!(!email.html.contains("<script>"));
        // The plain-text part keeps the password exactly as issued.
        assert!(email.text.contains("Passwort: a<b>&'\""));
    }

    #[test]
    fn without_a_name_or_deadline_the_greeting_and_note_stay_neutral() {
        let agency = AgencyIdentity::default();
        let email = portal_login(&PortalLoginEmail {
            language: MailLanguage::Uk,
            recipient_name: "  ",
            login: "anna@example.test",
            password: "Kq7-mP2x-Rw9t",
            login_url: "https://console.gmed-health.com/login",
            complete_by: None,
            audience: LoginAudience::Guardian,
            agency: &agency,
            logo_url: None,
        });
        assert!(email.text.starts_with("Вітаємо!\n"));
        assert!(email.text.contains("для вашої дитини"));
        assert!(!email.text.contains("заповніть дані до"));
    }

    #[test]
    fn the_connection_test_letter_names_sender_and_requester_in_every_language() {
        let agency = agency();
        for language in [
            MailLanguage::De,
            MailLanguage::En,
            MailLanguage::Ru,
            MailLanguage::Uk,
        ] {
            let email = connection_test(&ConnectionTestEmail {
                language,
                requested_by: "Max <Admin>",
                requested_at: "05.10.2026 17:30",
                sender: "zugang@gmed-health.com",
                agency: &agency,
                logo_url: Some("https://console.gmed-health.com/gmed-logo.png"),
            });
            assert!(email.subject.starts_with("GMED"));
            for part in [&email.text, &email.html] {
                assert!(part.contains("zugang@gmed-health.com"), "{language:?}");
                assert!(part.contains("05.10.2026 17:30"), "{language:?}");
                assert!(part.contains("80331 München"));
            }
            assert!(email.text.contains("Max <Admin>"));
            assert!(email.html.contains("Max &lt;Admin&gt;"));
            assert!(email.html.contains("gmed-logo.png"));
        }
    }

    #[test]
    fn the_payer_invitation_names_the_patient_the_deadline_and_the_privacy_notice() {
        let agency = agency();
        for language in [
            MailLanguage::De,
            MailLanguage::En,
            MailLanguage::Ru,
            MailLanguage::Uk,
        ] {
            let email = payer_invitation(&PayerInvitationEmail {
                language,
                payer_name: "Viktor Zahler",
                organisation: false,
                patient_name: "Mia Muster",
                link_url: "https://console.gmed-health.com/payer#abc123",
                expires_on: NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(),
                privacy_url: "https://console.gmed-health.com/legal#privacy",
                agency: &agency,
                logo_url: Some("https://console.gmed-health.com/gmed-logo.png"),
            });
            assert!(email.subject.contains("GMED"), "{language:?}");
            for part in [&email.text, &email.html] {
                assert!(part.contains("Mia Muster"), "{language:?}");
                assert!(part.contains("Viktor Zahler"), "{language:?}");
                assert!(part.contains("05.11.2026"), "{language:?}");
                assert!(part.contains("https://console.gmed-health.com/payer#abc123"));
                assert!(part.contains("https://console.gmed-health.com/legal#privacy"));
                assert!(part.contains("GwG"), "{language:?}");
                assert!(part.contains("80331 München"));
            }
            // The agency named in the settings is the controller.
            assert!(email.text.contains("GMED - Agentur für Patientenbetreuung"));
        }
        let german = payer_invitation(&PayerInvitationEmail {
            language: MailLanguage::De,
            payer_name: "",
            organisation: false,
            patient_name: "Mia Muster",
            link_url: "https://console.gmed-health.com/payer#abc123",
            expires_on: NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(),
            privacy_url: "https://console.gmed-health.com/legal#privacy",
            agency: &AgencyIdentity::default(),
            logo_url: None,
        });
        assert_eq!(german.subject, "Angaben zur Kostenübernahme – GMED");
        assert!(german.text.starts_with("Guten Tag,\n"));
        assert!(
            german.text.contains(
                "Mia Muster hat Sie als zahlende Person für eine Anfrage bei GMED benannt."
            )
        );
        assert!(
            german
                .text
                .contains("Beim Öffnen senden wir einen Bestätigungscode an diese Adresse.")
        );
        assert!(
            german
                .text
                .contains("Verantwortlich für die Verarbeitung Ihrer Daten ist GMED.")
        );
        for word in ["Diagnose", "Behandlung", "medizin", "Klinik"] {
            assert!(!german.text.contains(word), "{word}");
        }
    }

    /// A company, an organisation or an insurer is greeted neutrally, never
    /// with its name, and the patient named "your organisation" as the paying
    /// party (QA 2026-10-06, C7-b).
    #[test]
    fn an_organisation_payer_is_greeted_neutrally_and_named_as_your_organisation() {
        let agency = agency();
        let expected = [
            (
                MailLanguage::De,
                "Guten Tag,\n",
                "Mia Muster hat Ihre Organisation als zahlende Partei für eine Anfrage bei GMED benannt.",
                "zahlende Person",
            ),
            (
                MailLanguage::En,
                "Hello,\n",
                "Mia Muster has named your organisation as the paying party",
                "paying person",
            ),
            (
                MailLanguage::Ru,
                "Здравствуйте!\n",
                "Mia Muster указал(а) вашу организацию как плательщика",
                "указал(а) вас как",
            ),
            (
                MailLanguage::Uk,
                "Вітаємо!\n",
                "Mia Muster вказав(ла) вашу організацію як платника",
                "вказав(ла) вас як",
            ),
        ];
        for (language, greeting, intro, person_wording) in expected {
            let email = payer_invitation(&PayerInvitationEmail {
                language,
                payer_name: "Beispiel GmbH",
                organisation: true,
                patient_name: "Mia Muster",
                link_url: "https://console.gmed-health.com/payer#abc123",
                expires_on: NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(),
                privacy_url: "https://console.gmed-health.com/legal#privacy",
                agency: &agency,
                logo_url: None,
            });
            assert!(email.text.starts_with(greeting), "{language:?}");
            for part in [&email.text, &email.html] {
                assert!(!part.contains("Beispiel GmbH"), "{language:?}");
                assert!(!part.contains(person_wording), "{language:?}");
                assert!(part.contains("05.11.2026"), "{language:?}");
                assert!(part.contains("https://console.gmed-health.com/payer#abc123"));
                assert!(part.contains("GwG"), "{language:?}");
            }
            assert!(email.text.contains(intro), "{language:?}");
        }
        // A person keeps the greeting with the name.
        let person = payer_invitation(&PayerInvitationEmail {
            language: MailLanguage::De,
            payer_name: "Viktor Zahler",
            organisation: false,
            patient_name: "Mia Muster",
            link_url: "https://console.gmed-health.com/payer#abc123",
            expires_on: NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(),
            privacy_url: "https://console.gmed-health.com/legal#privacy",
            agency: &agency,
            logo_url: None,
        });
        assert!(person.text.starts_with("Guten Tag Viktor Zahler,\n"));
        assert!(person.text.contains("hat Sie als zahlende Person"));
    }

    /// The code e-mail greets nobody and speaks of no person: it fits a
    /// person and an organisation alike.
    #[test]
    fn the_payer_code_e_mail_names_neither_a_person_nor_an_organisation() {
        let agency = AgencyIdentity::default();
        for language in [
            MailLanguage::De,
            MailLanguage::En,
            MailLanguage::Ru,
            MailLanguage::Uk,
        ] {
            let email = payer_code(&PayerCodeEmail {
                language,
                code: "042917",
                agency: &agency,
                logo_url: None,
            });
            for word in [
                "Guten Tag",
                "zahlende Person",
                "Hello",
                "paying person",
                "Здравствуйте",
                "Вітаємо",
            ] {
                assert!(!email.text.contains(word), "{language:?} {word}");
            }
        }
    }

    #[test]
    fn the_payer_code_e_mail_carries_the_code_on_a_line_of_its_own() {
        let agency = AgencyIdentity::default();
        for language in [
            MailLanguage::De,
            MailLanguage::En,
            MailLanguage::Ru,
            MailLanguage::Uk,
        ] {
            let email = payer_code(&PayerCodeEmail {
                language,
                code: "042917",
                agency: &agency,
                logo_url: None,
            });
            assert!(email.subject.contains("GMED"));
            assert!(!email.subject.contains("042917"), "never in the subject");
            assert!(email.html.contains("042917"));
            assert!(
                email.text.lines().any(|line| line.ends_with(": 042917")),
                "{language:?}"
            );
        }
    }

    #[test]
    fn a_patient_e_mail_names_the_portal_instead_of_a_request() {
        let agency = AgencyIdentity::default();
        let email = portal_login(&PortalLoginEmail {
            language: MailLanguage::De,
            recipient_name: "Anna Muster",
            login: "anna@example.test",
            password: "Kq7-mP2x-Rw9t",
            login_url: "https://console.gmed-health.com/login",
            complete_by: None,
            audience: LoginAudience::Patient,
            agency: &agency,
            logo_url: None,
        });
        assert!(email.text.contains("Termine, Dokumente und Rechnungen"));
        assert!(!email.text.contains("laden Sie Ihre Unterlagen hoch"));
        assert!(email.text.contains("Kq7-mP2x-Rw9t"));
    }
}
