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
    /// A parent filling in a minor's request.
    pub for_guardian: bool,
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
    let intro = if email.for_guardian {
        copy.intro_guardian
    } else {
        copy.intro
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

fn login_html(
    email: &PortalLoginEmail<'_>,
    copy: &LoginCopy,
    greeting: &str,
    intro: &str,
    complete_by: Option<&str>,
    footer: &[String],
) -> String {
    let url = escape_html(email.login_url);
    let paragraph = |content: &str| {
        format!(
            r#"<p style="margin:0 0 16px;font:15px/1.6 {FONT};color:{INK};">{}</p>"#,
            escape_html(content)
        )
    };
    let complete_by = complete_by
        .map(|value| {
            format!(
                r#"<p style="margin:0 0 16px;padding:12px 14px;border-left:3px solid {BRAND};background:{BRAND_SOFT};font:14px/1.55 {FONT};color:{INK};">{}</p>"#,
                escape_html(value)
            )
        })
        .unwrap_or_default();
    let footer = footer
        .iter()
        .map(|line| escape_html(line))
        .collect::<Vec<_>>()
        .join("<br>");
    // The alt text carries the wordmark's look when a client blocks images.
    let wordmark_style = format!("font:800 26px/1 {FONT};letter-spacing:3px;color:{INK};");
    let brand_mark = match email.logo_url {
        Some(logo) => format!(
            r#"<img src="{}" width="{LOGO_WIDTH}" height="{LOGO_HEIGHT}" alt="GMED" style="display:block;border:0;outline:none;text-decoration:none;width:{LOGO_WIDTH}px;height:auto;{wordmark_style}">"#,
            escape_html(logo)
        ),
        None => "GMED".to_string(),
    };
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
<td style="vertical-align:middle;padding-left:14px;border-left:1px solid #e4e4e7;font:13px/1.2 {FONT};color:{MUTED};">{portal}</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px 32px 8px;">
<p style="margin:0 0 16px;font:600 17px/1.5 {FONT};color:{INK};">{greeting}</p>
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
<p style="margin:0 0 12px;font:13px/1.55 {FONT};color:{MUTED};">{keep_safe}</p>
<p style="margin:0 0 24px;font:13px/1.55 {FONT};color:{MUTED};">{not_you}</p>
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
        lang = email.language.code(),
        subject = escape_html(copy.subject),
        preheader = escape_html(copy.preheader),
        portal = escape_html(copy.portal),
        greeting = escape_html(greeting),
        intro = paragraph(intro),
        credentials_heading = escape_html(copy.credentials_heading),
        login_row = credential_row(copy.login_label, email.login, false),
        password_row = credential_row(copy.password_label, email.password, true),
        button = escape_html(copy.button),
        link_hint = escape_html(copy.link_hint),
        keep_safe = escape_html(copy.keep_safe),
        not_you = escape_html(copy.not_you),
        footer_break = if footer.is_empty() { "" } else { "<br><br>" },
        automatic = escape_html(copy.automatic),
    )
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
            for_guardian: false,
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
            for_guardian: false,
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
            for_guardian: false,
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
            for_guardian: true,
            agency: &agency,
            logo_url: None,
        });
        assert!(email.text.starts_with("Вітаємо!\n"));
        assert!(email.text.contains("для вашої дитини"));
        assert!(!email.text.contains("заповніть дані до"));
    }
}
