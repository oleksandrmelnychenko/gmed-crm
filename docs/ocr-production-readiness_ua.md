# OCR: підготовка до production

## Що вже захищено

- Сильний нативний PDF-текст зберігається; OCR запускається лише для слабких
  або scan-like сторінок.
- PaddleOCR працює в окремому локальному процесі. Перевищення page deadline
  завершує процес; наступний запит запускає чистий процес. Tesseract лишається
  локальним fallback.
- Production image запускає worker і Paddle child від непривілейованого
  системного користувача `gmed`; попередньо завантажений model cache належить
  цьому користувачу й не потребує root або runtime network access. Compose
  скидає всі Linux capabilities, забороняє privilege escalation і додає init
  process для коректного прибирання дочірніх OCR-процесів.
- Два послідовні збої Paddle відкривають circuit breaker на 60 секунд, тому
  пошкоджена модель не витрачає повний timeout на кожній сторінці.
- Слабкий перший результат може отримати один додатковий Otsu-прохід у межах
  того самого page deadline.
- Paddle blocks сортуються геометрично; підтримано типовий двоколонковий лист.
  Координати масштабуються назад до post-orientation/post-deskew зображення.
- Повторювані числові клітинки розпізнаються як таблиця і зберігаються у
  row-major порядку `показник → значення → одиниця`.
- Клінічний кандидат зіставляється зі своїми OCR-блоками лише в пам'яті.
  Review confidence використовує block-level confidence, а при неоднозначному
  match консервативно повертається до page-level оцінки.
- Вичерпаний page/document deadline зберігається у provenance. Draft отримує
  попередження про неповне розпізнавання, а всі кандидати примусово лишаються
  невибраними до ручної звірки з оригіналом.
- Збій рендера сторінки, виняток OCR або розбіжність кількості PDF-сторінок
  також вважаються неповним розпізнаванням і переводять увесь draft у
  fail-closed ручну перевірку.
- Українські й російські підказки вибирають менший відповідний Tesseract pack;
  для невизначеної кирилиці використовується спільний pack.
- Окремий OCR зображень у Rust document API має Tesseract та мовні моделі
  `deu+eng+ukr+rus` у production-образі, автоматичний layout (`psm 3`),
  обмежений timeout і CI smoke-check наявності кожного мовного пакета. Спільний
  deadline охоплює очікування в bounded queue та сам OCR; одночасно працює не
  більше `GMED_DOCUMENT_OCR_MAX_CONCURRENCY` процесів (production default: 2).
  Кожен дочірній Tesseract обмежено одним OpenMP thread, щоб OCR не витісняв
  API-запити з CPU.
  Тимчасовий OCR-файл створюється атомарно з правами `0600` і видаляється після
  будь-якого результату виклику.
- Windows OCR у локальному API також обгорнуто тим самим bounded timeout;
  завислий WinRT-виклик не утримує request необмежено й переходить на Tesseract.
- Production-лог `parser_metric` не містить тексту, шляхів, document ID або
  значень кандидатів.
- Success/failure/lease logs OCR worker та read-failure log Rust API також не
  містять import/document UUID, `storage_key`, filename або path-derived error.

## Benchmark-корпус

Реальні документи та ground truth не комітити. Зберігати їх у зашифрованому
сховищі з аудитом доступу. Ідентифікатор case має бути випадковим і не повинен
містити ПІБ, MRN або назву файлу.

Мінімальна стартова вибірка — 100 документів:

| Група | Частка | Що включити |
|---|---:|---|
| Німецькі Arztbrief/Befund | 30% | одно- і двоколонкові, різні клініки |
| Лабораторії й таблиці | 20% | одиниці, референси, прапорці H/L |
| Фото зі смартфона | 15% | перспектива, тіні, поворот, низький контраст |
| Факс/старі скани | 15% | шум, 150–200 DPI, печатки |
| Українська/російська | 10% | окремі та змішані з de/en сторінки |
| Негативні/складні | 10% | рукопис, порожні сторінки, пошкоджені PDF |

Для кожного case бажано мати human-corrected `raw_text`, клінічні candidates,
assertion/status, section rules і denylist небезпечних діагнозів. Формат описано
в `services/clinical-document-parser/benchmarks/README.md` та `schema.json`.

## Початкові quality gates

Пороги треба підтвердити на локальному корпусі, а не на production-трафіку:

- OCR character similarity: не нижче 0.95 загалом і 0.90 у кожній групі.
- Candidate micro F1: не нижче 0.90.
- Unsafe false-positive diagnoses: 0.
- p95 extraction: до 30 секунд на сторінку CPU; timeout rate нижче 1%.
- Частка ручних виправлень critical fields (діагноз, доза, одиниця): нижче 2%.

Приклад запуску:

```powershell
python -m benchmarks.run `
  --ground-truth D:\secure\clinical-parser-ground-truth.json `
  --fail-on-unsafe `
  --minimum-candidate-f1 0.90 `
  --minimum-ocr-similarity 0.95 `
  --minimum-cohort-candidate-f1 0.90 `
  --minimum-cohort-ocr-similarity 0.90 `
  --required-cohort arztbrief `
  --required-cohort laboratory `
  --required-cohort smartphone_photo `
  --required-cohort fax_scan `
  --required-cohort cyrillic `
  --required-cohort negative `
  --minimum-required-cohort-cases 10 `
  --output D:\secure\reports\parser-metrics.json
```

## Rollout

CI компілює parser, запускає unit/benchmark tests, synthetic cohort gates,
збирає production image і робить smoke test реального ізольованого Paddle
runtime на синтетичному зображенні з текстом. Smoke test проходить лише якщо
Paddle фактично розпізнав контрольні медичні слова, а не просто повернувся без
помилки.
Release workflow до `build-and-sign` повторює Rust format/clippy/tests,
frontend lint/tests/build, print-binding і repository-hygiene audits, а також
parser/benchmark/live-synthetic preflight. Тому GHCR image не публікується й не
підписується паралельно з неперевіреним application або OCR/parser кодом.

Локальний еквівалент основних gate-ів запускається з кореня репозиторію:

```powershell
python scripts/release_check.py
```

1. Прогнати benchmark на старій і новій версії та зберегти лише PHI-free
   reports.
2. Увімкнути нову версію на одному worker протягом 24–48 годин.
3. Порівняти `duration_ms`, `timed_out_pages`, engine fallback rate,
   low-confidence pages і ручні виправлення.
4. Розгорнути повністю лише якщо unsafe findings дорівнюють нулю, quality gates
   не погіршилися, а p95 вкладається в ресурсний бюджет.
5. Для швидкого rollback встановити `GMED_PARSER_OCR_MULTIPASS=false`; для
   повного обходу Paddle — `GMED_PARSER_OCR_ENGINE=tesseract`.

## Операційні налаштування

Production defaults задані в `docker-compose.release.yml`. Не вимикати
`GMED_PARSER_PADDLE_ISOLATE_PROCESS` у production: без процесної ізоляції
native inference не можна гарантовано перервати після timeout.
