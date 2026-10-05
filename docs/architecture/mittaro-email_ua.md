# Листи через Mittaro

Рішення власника 2026-10-05: вихідні листи консолі йдуть через [Mittaro](https://mittaro.de/dokumentation), сервіс транзакційних листів із серверами в Німеччині (Falkenstein, Nürnberg). Перший і поки єдиний лист — дані для входу ліда в портал ([кабінет ліда](lead-patient-portal_ua.md#вхід-на-e-mail-mittaro)).

## Чому Mittaro

- Сервери в Німеччині, обробка за DSGVO; вміст листа видаляється після передачі поштовому серверу отримувача, лишаються метадані.
- Без пікселів відстеження й без підміни посилань.
- REST API з `Idempotency-Key`: повторний запит із тим самим ключем не відправляє лист удруге.
- Обмеження: без вкладень (422), без вбудованих зображень (`cid:`). Тому логотип у листі — текстовий словесний знак, а не картинка.

## Як працює в коді

- `crates/server/src/mail/mod.rs` — клієнт: `POST https://api.mittaro.de/v1/emails`, `Authorization: Bearer tx_live_…`, `Idempotency-Key`, тіло `{from, to, subject, text, html, reply_to}`. До 3 спроб при 5xx, недоступності мережі та 429 з `Retry-After` ≤ 5 с; 401/403 (ключ або домен) і 400/409/413/422 (лист) не повторюються.
- `crates/server/src/mail/templates.rs` — шаблони GMED: HTML (таблична верстка, inline-стилі, `#f97316`, реквізити агентства з налаштувань компанії) і текстова версія, мови DE/EN/UA/RU. Усі значення екрануються; HTML нічого не завантажує ззовні.
- Коди помилок для інтерфейсу: `mail_not_configured`, `mail_rejected`, `mail_invalid_message`, `mail_quota_reached`, `mail_unavailable`.

## Змінні середовища (бекенд)

| Змінна | Приклад | Примітка |
|---|---|---|
| `GMED_MITTARO_API_KEY` | `tx_live_…` | Секрет, лише в `release.env` сервера / SOPS. Без нього листи не відправляються. |
| `GMED_MAIL_FROM` | `zugang@gmed-health.com` | Адреса на домені, підтвердженому в Mittaro. |
| `GMED_MAIL_REPLY_TO` | `info@gmed-health.com` | Необов'язково: куди потрапляє відповідь ліда. |
| `GMED_CONSOLE_URL` | `https://console.gmed-health.com` | Необов'язково: за замовчуванням перше `https://` з `CORS_ORIGIN` (DEV — `console-dev…`, PROD — `console…`). |
| `GMED_MITTARO_API_URL` | — | Лише для тестів; за замовчуванням `https://api.mittaro.de/v1/emails`. |

`docker-compose.release.yml` передає всі п'ять змінних бекенду; порожнє значення = не задано.

## Що зробити власнику (один раз на акаунт)

1. Зареєструвати акаунт Mittaro (`app.mittaro.de/registrieren`), вибрати тариф (від безкоштовного, 2 000 листів на місяць) і підписати AVV (Auftragsverarbeitungsvertrag, ст. 28 DSGVO).
2. Додати домен `gmed-health.com` і внести записи DNS, які покаже Mittaro (DNS домену — у Vercel):
   - SPF: в домені вже є `v=spf1 include:_spf.protonmail.ch ~all`. Запис SPF має бути один, тож include Mittaro дописується в той самий запис, а не окремим TXT.
   - DKIM і Return-Path — нові записи з панелі Mittaro.
   - DMARC — за наявності не змінювати; Mittaro перевіряє всі записи постійно.
3. Створити API-ключ (показується один раз) і внести на сервері в `release.env`: `GMED_MITTARO_API_KEY`, `GMED_MAIL_FROM` і за бажанням `GMED_MAIL_REPLY_TO`. Спершу на DEV, перевірити лист на власну адресу, потім на PROD.
4. Додати Mittaro до переліку обробників у Verzeichnis von Verarbeitungstätigkeiten (вид даних: ім'я, e-mail, дані для входу; мета: доступ до порталу заявки).

## Що лишається в GMED

- Таблиця `portal_login_emails`: кому, коли, мова, хто відправив, статус, id повідомлення Mittaro або код помилки. Вміст листа й пароль не зберігаються. Рядки видаляються разом із лідом ([Löschkonzept](../compliance/04_loeschkonzept.md)).
- Аудит: `send_lead_portal_login_email` / `send_lead_portal_login_email_failed` з id входу, мовою, id повідомлення — без адреси й пароля.

## Відкрите

- Вебхуки Mittaro (доставлено / bounce / скарга) поки не підключені: статус «sent» означає, що Mittaro прийняв лист, а не що він доставлений.
- Чи приймає Mittaro `from` у вигляді `GMED <zugang@…>` — у документації не сказано; поки використовуємо лише адресу.
