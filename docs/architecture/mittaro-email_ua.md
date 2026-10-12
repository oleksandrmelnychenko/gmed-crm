# Листи через Mittaro

Рішення власника 2026-10-05: вихідні листи консолі йдуть через [Mittaro](https://mittaro.de/dokumentation), сервіс транзакційних листів із серверами в Німеччині (Falkenstein, Nürnberg). Перший і поки єдиний лист — дані для входу ліда в портал ([кабінет ліда](lead-patient-portal_ua.md#вхід-на-e-mail-mittaro)).

## Чому Mittaro

- Сервери в Німеччині, обробка за DSGVO; вміст листа видаляється після передачі поштовому серверу отримувача, лишаються метадані.
- Без пікселів відстеження й без підміни посилань.
- REST API з `Idempotency-Key`: повторний запит із тим самим ключем не відправляє лист удруге.
- Обмеження: без вкладень (422), без вбудованих зображень (`cid:`). Тому логотип GMED у листі завантажується з сервера консолі (`https://<console>/gmed-logo.png`, той самий файл, що на сторінці входу). URL однаковий для всіх, без параметрів, тож нікого не ідентифікує. Якщо клієнт блокує зображення, на місці логотипа видно текст «GMED» у фірмовому стилі.

## Як працює в коді

- `crates/server/src/mail/mod.rs` — клієнт: `POST https://api.mittaro.de/v1/emails`, `Authorization: Bearer tx_live_…`, `Idempotency-Key`, тіло `{from, to, subject, text, html, reply_to}`. До 3 спроб при 5xx, недоступності мережі та 429 з `Retry-After` ≤ 5 с; 401/403 (ключ або домен) і 400/409/413/422 (лист) не повторюються.
- `crates/server/src/mail/templates.rs` — шаблони GMED: HTML (таблична верстка, inline-стилі, `#f97316`, реквізити агентства з налаштувань компанії) і текстова версія, мови DE/EN/UA/RU. Усі значення екрануються; єдиний зовнішній ресурс — логотип із сервера консолі, шрифти, стилі й трекінг не завантажуються.
- Коди помилок для інтерфейсу: `mail_not_configured`, `mail_rejected`, `mail_invalid_message`, `mail_quota_reached`, `mail_unavailable`.

## Підключення: сторінка «API-подключения»

Ключ вводять у консолі: **API-подключения → E-Mail · Mittaro** (`/admin/api-connections?tab=email`, CEO та IT Admin, як і решта ключів). Поля: API-ключ (`tx_live_…`), відправник (адреса на домені, підтвердженому в Mittaro), необов'язкова адреса для відповідей. Кнопка «Тестовое письмо» надсилає брендований тестовий лист (без даних пацієнтів) на адресу користувача або на вказану. У Mittaro немає запиту, що перевіряє ключ без відправки, тому перевірка — саме тестовий лист.

- `GET/POST /mail/connection`, `POST /mail/connection/test`, `POST /mail/connection/disconnect` (`admin.signatures`, як у сторінки).
- Ключ зберігається в `mail_provider_connection` зашифрованим реєстром ключів сервера, як підключення Skribble; назад не повертається, лише `…` і останні чотири символи.
- Збережене на сторінці підключення має пріоритет над змінними середовища. «Отключить» зберігає вимкнений рядок, який вимикає листи навіть тоді, коли в середовищі лишився ключ.
- Аудит: `mail_connection_saved` (домен відправника, чи змінено ключ), `mail_connection_test_sent`, `mail_connection_disconnected` — без ключа й без повних адрес.

## Змінні середовища (бекенд, запасний варіант)


| Змінна | Приклад | Примітка |
|---|---|---|
| `GMED_MITTARO_API_KEY` | `tx_live_…` | Секрет, лише в `release.env` сервера / SOPS. Діє, поки на сторінці «API-подключения» нічого не збережено. |
| `GMED_MAIL_FROM` | `zugang@gmed-health.com` | Адреса на домені, підтвердженому в Mittaro. |
| `GMED_MAIL_REPLY_TO` | `info@gmed-health.com` | Необов'язково: куди потрапляє відповідь ліда. |
| `GMED_CONSOLE_URL` | `https://console.gmed-health.com` | Необов'язково: за замовчуванням перше `https://` з `CORS_ORIGIN` (DEV — `console-dev…`, PROD — `console…`). |
| `GMED_MITTARO_API_URL` | — | Лише для тестів; за замовчуванням `https://api.mittaro.de/v1/emails`. |

`docker-compose.release.yml` передає всі п'ять змінних бекенду; порожнє значення = не задано.

## Що зробити власнику (один раз на акаунт)

Стан домену на 05.10.2026: пошта `gmed-health.com` — Proton (MX `mail.protonmail.ch`), SPF `v=spf1 include:_spf.protonmail.ch ~all`, DMARC `v=DMARC1; p=quarantine`. Через `p=quarantine` лист без правильних DKIM/SPF потрапить у спам, тому домен треба підтвердити до першої відправки. DNS домену — у Vercel (`ns1/ns2.vercel-dns.com`).

1. **Акаунт.** Зареєструватися на `app.mittaro.de/registrieren` (безкоштовний тариф: 2 000 листів на місяць, без картки; далі Starter 10 000 за 9 €/міс). У налаштуваннях укласти AVV (Auftragsverarbeitungsvertrag, ст. 28 DSGVO).
2. **Домен.** У Mittaro: **Domains** → додати `gmed-health.com`. Панель покаже три записи з точними значеннями (вони свої для кожного домену):
   - **DKIM** — TXT на `<selektor>._domainkey.gmed-health.com` (значення з панелі);
   - **SPF** — TXT на `gmed-health.com`. Окремий другий SPF-запис створювати не можна: include Mittaro дописується в наявний запис Proton, наприклад `v=spf1 include:_spf.protonmail.ch include:spf.mittaro.de ~all` (точну назву include взяти з панелі);
   - **Return-Path / bounce** — MX на `bounce.gmed-health.com` (значення з панелі). Це піддомен, тож на пошту Proton для `@gmed-health.com` він не впливає.
3. **Внести записи у Vercel.** Vercel → Domains → `gmed-health.com` → DNS Records: додати DKIM-TXT і MX для `bounce`, а наявний SPF-TXT відредагувати. DMARC не змінювати.
4. **Перевірка.** У Mittaro натиснути перевірку домену; DNS оновлюється від кількох хвилин до кількох годин. Mittaro надалі сам стежить за записами і попереджає про зміни.
5. **API-ключ.** **API-Keys** → створити ключ лише з правом `emails:send`; він показується один раз.
6. **Консоль GMED.** «API-подключения» → «E-Mail · Mittaro»: ключ, відправник (наприклад `zugang@gmed-health.com`, адреса на підтвердженому домені; окрема скринька в Proton для неї не потрібна) і за бажанням адреса для відповідей (наприклад `info@gmed-health.com` — вона має існувати в Proton). «Сохранить», потім «Отправить тестовое письмо» собі. Спершу на DEV, потім на PROD: на кожному сервері своє підключення.
7. **Документація DSGVO.** Додати Mittaro до Verzeichnis von Verarbeitungstätigkeiten (дані: ім'я, e-mail, дані для входу; мета: доступ до порталу пацієнта/заявки).

## Статуси доставки

Побажання власника 2026-10-05: менеджер має бачити, чи дійшов лист із доступом. Формат підписаних вебхуків Mittaro публічно не описаний, тому сервер сам питає статус кожного прийнятого листа: `GET https://api.mittaro.de/v1/emails/{id}` (документовано на [mittaro.de/en#api](https://mittaro.de/en#api), відповідь `{id, status, created_at, sent_at, smtp_code}`) тим самим ключем.

- `crates/server/src/mail/delivery.rs`: планувальник раз на хвилину бере до 25 листів, яким настав час перевірки. Перша година — щохвилини, до доби — раз на 15 хвилин, далі щогодини, загалом три дні після відправки. Рядки «забираються» одним `UPDATE … FOR UPDATE SKIP LOCKED`, тож другий екземпляр сервера бере інші.
- Слово статусу Mittaro зводиться до одного зі станів, що їх показує журнал у кабінеті Mittaro: `queued` (In Warteschlange), `sending` (Wird übergeben), `sent` (Übergeben), `delivered` (Zugestellt), `deferred` (Zurückgestellt), `bounced` (Unzustellbar), `failed` (Fehlgeschlagen), `suppressed` (Unterdrückt), `complained` (скарга на спам), `unknown` (Ungeklärt). Документовані лише `queued` і `sent`, тому мапінг приймає поширені назви, а невідоме слово розрізняє за SMTP-кодом (5xx — bounce, 4xx — відкладено). Оригінальне слово й SMTP-код зберігаються поруч (`provider_status`, `smtp_code`).
- Перевірки припиняються на `delivered`, `bounced`, `failed`, `suppressed`, `complained` або коли Mittaro не знає листа (404 → `unknown`, наприклад лист відправлено іншим акаунтом). 401/403 (ключ без права читати статуси), 429 і збої зупиняють прохід; ці листи перевіряються наступного разу.
- Колонки `portal_login_emails`: `delivery_status`, `provider_status`, `smtp_code`, `delivery_final`, `delivery_updated_at`, `delivery_checked_at` (міграція `20261012210000`).
- Консоль: у рядку ліда й пацієнта біля «Доступ по e-mail» стоїть статус останнього листа цього входу (`portal_account.login_email_delivery`). Для «Не доставлено», «Адрес заблокирован» і «Отмечено как спам» є червона підказка передати доступ повідомленням або перевірити адресу. Журнал `GET …/portal-login-email` віддає `delivery_status` і `delivery_updated_at` для кожного листа.
- Аудит: `portal_login_email_undelivered` (без виконавця, сутність — лід або пацієнт), коли лист отримує `bounced`, `failed`, `suppressed` або `complained`. Містить id повідомлення, статус і SMTP-код, без адреси.

## Що лишається в GMED

- Таблиця `portal_login_emails`: кому, коли, мова, хто відправив, статус, id повідомлення Mittaro або код помилки, статус доставки; рядок належить ліду або пацієнту. Вміст листа й пароль не зберігаються. Рядки видаляються разом із лідом і під час анонімізації пацієнта ([Löschkonzept](../compliance/04_loeschkonzept.md)).
- Аудит: `send_lead_portal_login_email` / `send_patient_portal_login_email` (і `…_failed`) з id входу, мовою, id повідомлення — без адреси й пароля.

## Відкрите

- Вебхуки Mittaro (доставлено / bounce / скарга) не підключені, бо їхній формат і схема підпису публічно не описані. Статуси читає планувальник (розділ «Статуси доставки»). Коли формат буде відомий (налаштування Webhooks у кабінеті Mittaro), прийом вебхука оновлюватиме ті самі колонки, а секрет зберігатиметься на сторінці «API-подключения».
- Чи дає ключ лише з правом `emails:send` читати статуси (`GET /v1/emails/{id}`), документація не каже. Якщо Mittaro відповідає 401/403, статуси лишаються порожніми, а в лозі сервера є попередження `read sign-in e-mail delivery status` з `mail_rejected`; тоді в Mittaro треба створити ключ із правом читання.
- Чи приймає Mittaro `from` у вигляді `GMED <zugang@…>` — у документації не сказано; поки використовуємо лише адресу.
