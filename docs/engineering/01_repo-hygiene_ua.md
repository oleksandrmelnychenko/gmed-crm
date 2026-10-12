# Repo Hygiene

## Базові правила

1. У репозиторій не комітяться runtime/build артефакти:
   - `target/`
   - `target-test-run/`
   - `target-patient-slice/`
   - `dist/`
   - `frontend/dist/`
   - `node_modules/`
   - `frontend/node_modules/`
   - локальні IDE/agent secrets на кшталт `.claude/settings.local.json`

2. Текстові файли мають бути з `LF`, бінарні артефакти маркуються в `.gitattributes`.

3. Кожен merge у `main` має проходити:
   - `cargo fmt --all -- --check`
   - `cargo clippy --workspace --all-targets --locked -- -D warnings`
   - `cargo test --workspace --locked`
   - `npm --prefix frontend run lint -- --max-warnings 0`
   - `npm --prefix frontend run test`
   - `npm --prefix frontend run build`
   - `python scripts/check_repo_hygiene.py`

   Це повний набір перевірок перед merge, а не обов'язкова послідовність після кожної локальної правки. Додаткові CI-перевірки визначені в [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Архітектурні правила

1. Один bounded context не розмазується по паралельних старих flow.
   Поточний приклад: public intake живе в `leads`, а не дублюється окремим `visitor_intake` slice без чіткої межі.

2. Frontend types мають слідувати backend payload, а не дублювати локальні ad-hoc shape.

3. Новий workflow додається тільки разом із:
   - route/API
   - shared type contract
   - UI/consumer
   - test або regression note

4. Мова інтерфейсу в компонентах береться з `useLang()` і передається далі: `uiText(key, lang)`, а не `uiText(key)` чи `getLang()`. React Compiler кешує те, що компонент обчислює без реактивних входів, тож після перемикання RU→DE без перезавантаження такий текст лишався б старим.
   - Допоміжні функції модуля, які читають мову самі (`appointmentText`, `statusLabel`, `formatPortalDate`, `patientDetailText` тощо), перелічено в об'єкті модуля `XXX_LANGUAGE_HELPERS`; хук модуля (`useAppointmentLabels()`, `usePortalLabels()`, `useLeadLabels()` …, для функцій лише власного файлу — `useLanguageHelpers()`) повертає їхні копії, прив'язані до поточної мови (`useLanguageBound` у `frontend/src/lib/i18n`). Компоненти й хуки беруть їх із хука: `const { statusLabel } = useAppointmentLabels();`.
   - Нова функція, що читає мову й потрібна компонентам, додається до об'єкта свого модуля (або отримує `lang` параметром).
   - Правило ESLint `gmed/no-bare-ui-text` (`frontend/eslint-rules/no-bare-ui-text.js`) забороняє в компонентах і хуках `uiText(key)` без мови, `getLang()` і пряме використання перелічених функцій; виняток — колбеки ефектів.

## Локальна перевірка

Під час реалізації обирайте перевірки за зміненим кодом і ризиком:

- Документація та інструкції: перевірка змісту, посилань і формату; для skills — валідатор навички.
- Текст або стилі UI: перевірка відповідного екрана; для змін поведінки — цільові unit/E2E-тести та перевірка типів за потреби.
- Backend: форматування зміненого коду та тести відповідного модуля; зміни спільних контрактів, доступів або міграцій потребують перевірки залежних сценаріїв.
- Тести з БД запускайте на одноразовій тестовій базі. Для повного Rust gate на Bash/Docker-хості є [`scripts/run-rust-tests-isolated.sh`](../../scripts/run-rust-tests-isolated.sh).

Після виправлення повторюйте перевірки, яких стосується зміна. Розширюйте набір за новими помилками або залежностями; успішні локальні перевірки не замінюють повний gate перед merge.
