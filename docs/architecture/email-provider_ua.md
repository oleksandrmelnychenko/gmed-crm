# Вихідні листи: eusend (Resend-сумісний API)

Рішення власника 2026-11-16: попереднього провайдера повністю прибрано, вихідні листи консолі йдуть через [eusend](https://eusend.dev/docs) — сервіс транзакційних листів у ЄС з API, сумісним із Resend. API працює в Нюрнберзі, поштові сервери — у Фалькенштайні, база даних — у Франкфурті; дані листів не залишають ЄС ([субпідрядники](https://eusend.dev/legal/subprocessors)). Листи: дані для входу ліда й пацієнта ([кабінет ліда](lead-patient-portal_ua.md#вхід-на-e-mail)), запрошення й код платника, нагадування перед видаленням заявки, тестовий лист сторінки «API-подключения».

## Чому так

- Сервери в Німеччині, обробка за DSGVO, AVV у кабінеті eusend.
- Клієнт у коді говорить лише протоколом Resend (`POST /emails`, `GET /emails/{id}`, `Authorization: Bearer`, `Idempotency-Key`), тож інший Resend-сумісний сервіс — це інша базова адреса і `PROVIDER_ID`, а не новий клієнт.
- Відстеження відкриттів і кліків у кожному листі вимкнено явно (`track_opens: false`, `track_clicks: false`): посилання входу й платника мають дійти без підміни, пікселів немає, хоч би що стояло в налаштуваннях кабінету eusend.
- Логотип GMED у листі завантажується з сервера консолі (`https://<console>/gmed-logo.png`), без вкладень і `cid:`. URL однаковий для всіх. Якщо клієнт блокує зображення, видно текст «GMED» у фірмовому стилі.
- Важливо для DSGVO: eusend зберігає запис доставки **разом із відрендереним листом** (HTML і текст) протягом строку зберігання журналу тарифу — 30 днів на тарифах до 100 000 листів на місяць, 90 днів від 250 000 ([Plans & Limits](https://eusend.dev/docs/reference/plans)). Лист із даними для входу містить пароль, тож пароль 30 днів лежить у журналі eusend. Це треба відобразити у VVT/AVV; медичних даних листи не містять.

## Факти API (з офіційної документації, 16.11.2026)

| Що | Значення | Джерело |
|---|---|---|
| Базова адреса | `https://api.eusend.dev` | [API Reference](https://eusend.dev/docs/reference/api-reference) |
| Автентифікація | `Authorization: Bearer eu_live_…` (`eu_test_…` — тестовий ключ: увесь конвеєр без доставки) | [Authentication](https://eusend.dev/docs/getting-started/authentication) |
| Права ключа | `full_access` (за замовчуванням) або `sending_access` — лише відправка; `GET /emails/{id}` для нього 403 | там само |
| Відправка | `POST /emails`, тіло `{from, to, subject, html, text, reply_to, track_opens, track_clicks, …}`; відповідь `201 {"id": "<uuid>"}` | [Send an Email](https://eusend.dev/docs/emails/send) |
| Ідемпотентність | заголовок `Idempotency-Key` (≤ 255 символів); повтор із тим самим ключем — `200` з id першого листа, другий лист не йде | там само |
| Пакет | `POST /emails/batch`, до 100 листів, результат по кожному (не використовується) | [Batch Send](https://eusend.dev/docs/emails/batch) |
| Статус | `GET /emails/{id}` → `{id, status, events[], html, text, createdAt, …}` (camelCase, разом із вмістом листа; SMTP-коду немає) | [Email Details](https://eusend.dev/docs/emails/details), [OpenAPI](https://eusend.dev/openapi.json) |
| Статуси | `queued`, `scheduled`, `canceled`, `sending`, `sent`, `delivered`, `bounced` (жорсткий відказ, адресу заблоковано), `complained`, `suppressed`, `failed` | [Statuses](https://eusend.dev/docs/emails/statuses) |
| Помилки | `{"error": "…", "code": "…"}`; коди `UNAUTHORIZED`, `FORBIDDEN`, `DOMAIN_NOT_VERIFIED`, `VALIDATION_ERROR`, `ALL_SUPPRESSED`, `RECIPIENT_DOMAIN_UNDELIVERABLE`, `RATE_LIMITED`, `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED`, `SENDING_SUSPENDED`, `SERVICE_PAUSED` тощо | [Error Codes](https://eusend.dev/docs/reference/error-codes) |
| Ліміти | 100 запитів / 10 с на організацію (`429 RATE_LIMITED`); Free: 3 000 листів/міс, 100 отримувачів/день, 1 домен | [Rate Limits](https://eusend.dev/docs/reference/rate-limits), [Plans](https://eusend.dev/docs/reference/plans) |
| Вебхуки | `email.sent/delivered/bounced/complained/failed/suppressed/opened/clicked`; підпис `webhook-signature: v1,<base64 HMAC-SHA256(secret, "{webhook-id}.{webhook-timestamp}.{body}")>` (Standard Webhooks) | [Webhooks](https://eusend.dev/docs/webhooks), [Security](https://eusend.dev/docs/webhooks/security) |

Відмінності від Resend, які враховує клієнт: перший лист — `201`, повтор — `200`; статус у полі `status` (Resend — `last_event`, клієнт читає обидва); помилки мають машинний `code`.

## Як працює в коді

- `crates/server/src/mail/mod.rs` — клієнт: `POST {base}/emails` з `Bearer`-ключем, `Idempotency-Key` і тілом `{from, to, subject, text, html, reply_to, track_opens: false, track_clicks: false}`. Базова адреса — `MAIL_DEFAULT_API_URL` (`https://api.eusend.dev`); `GMED_MAIL_API_URL` лише для тестів. До 3 спроб при збоях мережі, 5xx, `SERVICE_PAUSED` і `RATE_LIMITED` з `Retry-After` ≤ 5 с; ключ, домен і стан акаунта (401/403, `DOMAIN_NOT_VERIFIED`, `SENDING_SUSPENDED`, …) і помилки листа (400/409/413/422) не повторюються. Перед відправкою сервер сам перевіряє в DNS, чи приймає домен отримувача пошту (`crate::email_domain`).
- Зведення кодів eusend до наших нейтральних кодів (тексти в інтерфейсі не залежать від провайдера):

| eusend | GMED |
|---|---|
| `UNAUTHORIZED`, `FORBIDDEN`, `DOMAIN_NOT_VERIFIED`, `SENDING_SUSPENDED`, `ACCOUNT_RESTRICTED`, `WORKSPACE_INACTIVE`, `SENDER_NOT_PERMITTED`, `LIST_SEND_HELD` | `mail_rejected` |
| `VALIDATION_ERROR`, `BAD_REQUEST`, `CONFLICT`, `PAYLOAD_TOO_LARGE` | `mail_invalid_message` |
| `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED`, `PLAN_LIMIT_EXCEEDED`, `RATE_LIMITED` після спроб | `mail_quota_reached` |
| `RECIPIENT_DOMAIN_UNDELIVERABLE` | `mail_recipient_domain_no_mail` |
| `ALL_SUPPRESSED` (адреса в списку блокування після відмови чи скарги) | `mail_recipient_blocked` (новий) |
| `SERVICE_PAUSED`, `INTERNAL_ERROR`, 5xx, мережа | `mail_unavailable` |
| не налаштовано | `mail_not_configured` |

- `crates/server/src/mail/templates.rs` — шаблони GMED (HTML і текст, DE/EN/UA/RU), без змін.
- `PROVIDER_ID = "eusend"` записується з кожним листом (`portal_login_emails.provider`, `lead_payer_link_emails.provider`, `lead_retention_reminder_emails.provider`) і в подіях аудиту.

## Підключення: сторінка «API-подключения»

Ключ вводять у консолі: **API-подключения → E-Mail · eusend** (`/admin/api-connections?tab=email`, CEO та IT Admin). Поля: API-ключ (`eu_live_…` або `eu_test_…`), відправник (адреса на домені, підтвердженому в eusend), необов'язкова адреса для відповідей. Посилання «Кабинет eusend» веде на `https://eusend.dev/overview`. «Тестовое письмо» надсилає брендований тестовий лист без даних пацієнтів.

- `GET/POST /mail/connection`, `POST /mail/connection/test`, `POST /mail/connection/disconnect` (`admin.signatures`).
- Ключ зберігається в `mail_provider_connection` зашифрованим реєстром ключів сервера (позначка `mail-resend-api-v1` усередині шифротексту), назад не повертається, лише `…` і останні чотири символи.
- Збережене підключення має пріоритет над змінними середовища; «Отключить» зберігає вимкнений рядок без відправника й ключа.
- Аудит: `mail_connection_saved`, `mail_connection_test_sent`, `mail_connection_disconnected` (`provider: "eusend"`), без ключа й повних адрес.

### Перехід зі старого провайдера (міграція `20261116150005`)

- Рядок `mail_provider_connection`: відправник і адреса для відповідей залишаються, зашифрований старий ключ видаляється, підключення вимикається. API повертає `source: "disconnected"`, `reason_code: "mail_api_key_missing"` і збережені адреси; сторінка показує «Отправка e-mail переведена на eusend. Введите API-ключ eusend» з уже заповненим відправником. Подія аудиту `mail_connection_provider_changed` (з міграції, без виконавця).
- Журнали листів отримали колонку `provider`: старі рядки — попередній провайдер, нові — `eusend` (значення за замовчуванням). Перевірка доставки питає лише про листи `eusend`, тож старі id повідомлень ніколи не потрапляють до eusend; ще не завершені старі листи закрито (`delivery_final`), останній відомий статус лишається в історії.
- Змінні середовища перейменовано: `GMED_MAIL_API_KEY`, `GMED_MAIL_API_URL`. Старий ключ, якщо він лишився в `release.env`/SOPS під старою назвою, сервер більше не читає — його треба видалити.

## Змінні середовища (бекенд, запасний варіант)

| Змінна | Приклад | Примітка |
|---|---|---|
| `GMED_MAIL_API_KEY` | `eu_live_…` | Секрет, лише в `release.env` / SOPS. Діє, поки на сторінці «API-подключения» нічого не збережено. Зазвичай не потрібен: ключ вводять на сторінці. |
| `GMED_MAIL_FROM` | `zugang@gmed-health.com` | Адреса на домені, підтвердженому в eusend. |
| `GMED_MAIL_REPLY_TO` | `info@gmed-health.com` | Необов'язково. |
| `GMED_CONSOLE_URL` | `https://console.gmed-health.com` | Необов'язково: за замовчуванням перше `https://` з `CORS_ORIGIN`. |
| `GMED_MAIL_API_URL` | — | Лише для тестів (локальна заглушка, `https://`); за замовчуванням `https://api.eusend.dev`. |

`docker-compose.release.yml` передає всі п'ять змінних бекенду; порожнє значення = не задано.

## Що зробити власнику (один раз)

Стан домену на 05.10.2026: пошта `gmed-health.com` — Proton (MX `mail.protonmail.ch`), SPF `v=spf1 include:_spf.protonmail.ch ~all`, DMARC `v=DMARC1; p=quarantine`. Через `p=quarantine` лист без підпису DKIM потрапить у спам, тому домен треба підтвердити до першої відправки. DNS — у Vercel (`ns1/ns2.vercel-dns.com`).

1. **Акаунт.** Зареєструватися на `eusend.dev/signup` (Free: 3 000 листів/міс, 100 отримувачів/день, 1 домен; Production від 9 €/міс за 10 000). Укласти AVV у кабінеті.
2. **Домен.** У кабінеті eusend: **Domains** → додати `gmed-health.com`. Панель покаже записи з точними значеннями:
   - **DKIM** — TXT на `eusend._domainkey.gmed-health.com`, значення `v=DKIM1; k=rsa; p=…` з панелі (обов'язково);
   - **DMARC** — уже є (`p=quarantine`), **не змінювати й не додавати другий**;
   - **SPF на корені не додавати й не змінювати** (eusend використовує власну bounce-адресу; другий SPF-запис зламав би пошту Proton);
   - необов'язково, для вирівнювання SPF і автоматичних bounce на власному домені: TXT на `send.gmed-health.com` = `v=spf1 include:_spf.eusend.dev ~all` і MX на `send.gmed-health.com` = `feedback.eusend.dev` (пріоритет 10). Це піддомен, на Proton не впливає.
3. **Прибрати записи старого провайдера** у Vercel, якщо їх додавали: його DKIM-TXT (`<selektor>._domainkey`), його `include` у кореневому SPF (повернути `v=spf1 include:_spf.protonmail.ch ~all`) і MX/TXT на `bounce.gmed-health.com`.
4. **Перевірка.** eusend сам перевіряє DNS і переводить домен у `verified`; вручну — кнопка перевірки в Domains.
5. **API-ключ.** **API Keys** → створити **live-ключ з правом Full access** (ключ «Sending access» не може читати статус доставки, і відмітки «Доставлено / Не доставлено» в консолі не з'являться). Для DEV можна взяти `eu_test_…` — листи проходять увесь конвеєр, але не доставляються.
6. **Консоль GMED.** «API-подключения» → «E-Mail · eusend»: ключ (відправник уже підставлений після міграції), «Сохранить», потім «Отправить тестовое письмо» собі. Спершу DEV, потім PROD: на кожному сервері своє підключення.
7. **Прибрати старий ключ** з `release.env`/SOPS на серверах (стара назва змінної) і закрити акаунт старого провайдера.
8. **DSGVO.** Замінити провайдера у VVT і переліку субпідрядників; зазначити, що eusend зберігає вміст листів (із паролем входу) до 30 днів.

## Статуси доставки

Сервер сам питає статус кожного прийнятого листа `GET /emails/{id}` тим самим ключем; вебхуки не потрібні (для них у консолі немає публічного ендпоінта).

- `crates/server/src/mail/delivery.rs`: планувальник раз на хвилину бере до 25 листів провайдера `eusend`, яким настав час перевірки: перша година — щохвилини, до доби — раз на 15 хвилин, далі щогодини, загалом три дні. Рядки «забираються» `UPDATE … FOR UPDATE SKIP LOCKED`.
- Зведення слів: `queued`/`scheduled` → `queued`, `sending`, `sent`, `delivered`, `delivery_delayed` (Resend) → `deferred`, `bounced`, `failed`/`canceled` → `failed`, `suppressed`, `complained`; невідоме слово — за SMTP-кодом, якщо він є, інакше `unknown`. Оригінальне слово зберігається в `provider_status`. Відповідь містить вміст листа, тому межа відповіді для статусу — 4 МіБ.
- Перевірки припиняються на `delivered`, `bounced`, `failed`, `suppressed`, `complained` або коли eusend не знає листа (404 → `unknown`); `sent` без змін добу вважається остаточним. 401/403 (ключ без права читання), 429 і збої зупиняють прохід.
- Перший проблемний стан аудитується (`portal_login_email_undelivered`, `payer_link_email_undelivered`, `lead_retention_reminder_undelivered`) і повідомляється тому, хто відправив, без адреси.

## Що лишається в GMED

- `portal_login_emails`, `lead_payer_link_emails`, `lead_retention_reminder_emails`: кому, коли, мова, хто відправив, провайдер, id повідомлення або код помилки, статус доставки. Вміст листа й пароль не зберігаються. Рядки видаляються разом із лідом і під час анонімізації пацієнта ([Löschkonzept](../compliance/04_loeschkonzept.md)).
- Аудит: `send_lead_portal_login_email` / `send_patient_portal_login_email` (і `…_failed`) з провайдером, id входу, мовою, id повідомлення — без адреси й пароля.

## Відкрите

- Локальні стенди QA (`~/gmed-qa-lm` у WSL) мають поштову заглушку під старий API: її треба перевести на `GMED_MAIL_API_URL` з маршрутами `POST /emails` (відповідь `201 {"id"}`) і `GET /emails/{id}`.
- Прийом вебхуків eusend (Standard Webhooks, HMAC-SHA256) не реалізовано: опитування статусу достатньо, а приймач потребував би публічного ендпоінта й секрету на сторінці «API-подключения».
- `from` у вигляді `GMED <zugang@…>` eusend приймає, але поки використовуємо лише адресу.
