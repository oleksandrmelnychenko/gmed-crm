## Мета

- entry cost (вартість входу) у Salesforce за офіційно опублікованими тарифами;
- recurring cost baseline (базовий регулярний ліцензійний контур) для сценаріїв;
- це **не повний TCO** у фінальному значенні;
- це published-price baseline (базовий розрахунок на основі публічних цін);
- implementation (впровадження), partner work (роботи партнера), integrations (інтеграції), support (підтримка), e-signature, billing extensions, portal, DATEV logic і custom workflows у цей baseline **не входять**, якщо для них немає офіційного опублікованого прайсу.

---

## Офіційні published pricing (опубліковані ціни), що використані в розрахунках

### Salesforce Sales Cloud

- Sales Cloud Starter Suite - **$25 / user / month**
- Sales Cloud Enterprise - **$175 / user / month**
- Sales Cloud Unlimited - **$350 / user / month**

### Salesforce Health Cloud

- Health Cloud Enterprise - **$350 / user / month**
- Health Cloud Unlimited - **$525 / user / month**

### Salesforce Shield

Shield опублікований як percentage-of-net-spend pricing (модель ціни як відсоток від чистих витрат на ліцензії):

- Shield bundle - **30% of net spend**
- Platform Encryption - **20% of net spend**
- Event Monitoring - **10% of net spend**
- Field Audit Trail - **10% of net spend**

### Важливе уточнення

У цьому документі всі розрахунки робляться:

- у `USD`;
- без ПДВ;
- без знижок;
- без контрактних спецумов;
- для billed annually scenarios (сценаріїв із річною оплатою), де це вимагає тариф.

---

## Чому саме ці сценарії мають значення

Для медичної агенції доцільно розглядати щонайменше чотири базові сценарії входу у Salesforce.

### Scenario A. CRM-only baseline (лише CRM-база)

Використовується тільки Sales Cloud Enterprise.

Цей сценарій показує:

- мінімальну адекватну CRM-вартість для серйозного B2B/B2C процесу;
- але **не** покриває медичний контур.

### Scenario B. Healthcare baseline (медичний базовий контур)

Використовується Health Cloud Enterprise.

Цей сценарій показує:

- скільки коштує вхід уже на healthcare-рівні;
- але ще **без** повного Shield security layer (повного шару безпеки Shield).

### Scenario C. Healthcare + Shield baseline

Використовується Health Cloud Enterprise + Shield bundle.

Цей сценарій є одним із найбільш релевантних для regulated data scenario (сценарію з регульованими даними), оскільки показує вартість входу, якщо потрібні:

- encryption;
- field audit;
- event monitoring;
- sensitive data controls.

### Scenario D. Higher-end healthcare baseline

Використовується Health Cloud Unlimited + Shield bundle.

Це сценарій для випадку, коли потрібен вищий функціональний і сервісний рівень платформи.

---

## Формули розрахунку

### Monthly formula (місячна формула)

`Monthly Cost = Price per User per Month x Number of Users`

### Annual formula (річна формула)

`Annual Cost = Monthly Cost x 12`

### Shield formula (формула для Shield)

`Shield Cost = 30% x Net Salesforce License Spend`

---

## Entry cost scenarios (сценарії вартості входу)

### Scenario A — Sales Cloud Enterprise only

Тариф:

- **$175 / user / month**
- **$2,100 / user / year**

| Кількість користувачів | Місячна вартість | Річна вартість |
|---|---:|---:|
| 10 | $1,750 | $21,000 |
| 15 | $2,625 | $31,500 |
| 20 | $3,500 | $42,000 |

### Коментар

Це корисний орієнтир для CRM-сценарію, але він не показує реальну вартість медичного контуру.

---

### Scenario B — Health Cloud Enterprise only

Тариф:

- **$350 / user / month**
- **$4,200 / user / year**

| Кількість користувачів | Місячна вартість | Річна вартість |
|---|---:|---:|
| 10 | $3,500 | $42,000 |
| 15 | $5,250 | $63,000 |
| 20 | $7,000 | $84,000 |

### Коментар

Це вже значно реалістичніша точка входу для healthcare-shaped scenario (сценарію, схожого на медичний), але ще без повного Shield security stack (стека безпеки Shield).

---

### Scenario C — Health Cloud Enterprise + Shield bundle

Health Cloud Enterprise:

- **$350 / user / month**

Shield bundle:

- **30% of net spend**

Ефективна місячна вартість на 1 користувача:

- `$350 + 30% = $455 / user / month`

Ефективна річна вартість на 1 користувача:

- `$455 x 12 = $5,460 / user / year`

| Кількість користувачів | Місячна вартість | Річна вартість |
|---|---:|---:|
| 10 | $4,550 | $54,600 |
| 15 | $6,825 | $81,900 |
| 20 | $9,100 | $109,200 |

### Коментар

Це один із ключових орієнтирів для реалістичного regulated healthcare scenario (сценарію з регульованими медичними даними), оскільки він показує:

- не тільки healthcare license;
- а й security and audit baseline (базовий безпековий та аудиторський шар).

---

### Scenario D — Health Cloud Unlimited + Shield bundle

Health Cloud Unlimited:

- **$525 / user / month**

Shield bundle:

- **30% of net spend**

Ефективна місячна вартість на 1 користувача:

- `$525 + 30% = $682.50 / user / month`

Ефективна річна вартість на 1 користувача:

- `$682.50 x 12 = $8,190 / user / year`

| Кількість користувачів | Місячна вартість | Річна вартість |
|---|---:|---:|
| 10 | $6,825 | $81,900 |
| 15 | $10,237.50 | $122,850 |
| 20 | $13,650 | $163,800 |

### Коментар

Це вже high-end baseline (високий базовий сценарій) і його варто розглядати, якщо реально потрібен підвищений platform tier (рівень платформи), більший сервісний пакет і ширший enterprise contour (корпоративний контур).

---

## Що в цих цифрах ще НЕ враховано

Навіть у Scenario C або D ці цифри **не є повним TCO**. У них ще не враховано:

- implementation partner fees (вартість партнера з впровадження);
- solution design and architecture work (проєктування рішення і архітектури);
- custom development (кастомну розробку);
- integrations (інтеграції);
- patient portal (портал пацієнта);
- custom billing logic (кастомну білінгову логіку);
- document governance layer (документний контур);
- e-signature provider cost (вартість провайдера електронного підпису);
- email / communication tooling;
- internal admin / devops / support cost;
- ongoing customization and maintenance (подальшу підтримку і кастомізацію).

---

## Практичне значення

### Мінімальний чесний висновок

Для медичної агенції важливо не плутати:

- **CRM entry cost (вартість входу в CRM)**
і
- **operational platform cost (вартість входу в повноцінну операційну платформу)**.

Salesforce може виглядати дешевше, якщо дивитися тільки на стартову CRM-ліцензію.

Але якщо потрібні:

- healthcare license;
- Shield security layer;
- регуляторна відповідність;
- кастомний document flow;
- кастомний billing contour;
- role-sensitive workflows;

тоді реальний фінансовий контур швидко стає значно ширшим за базову CRM-ціну.

### Рекомендована бізнес-формула

Для такого типу проєкту правильніше дивитися не на:

`CRM license only`

а на:

`License + Security + Healthcare + Customization + Integration + Support`

---

## Як це порівнювати з власною платформою

Для власної платформи published list pricing (опублікованих стандартних тарифів) зазвичай не існує в тому ж вигляді, як у Salesforce.

Замість цього фінансова модель складається з:

- discovery and architecture (дослідження й архітектури);
- product design (проєктування продукту);
- implementation (розробки);
- cloud infrastructure (хмарної інфраструктури);
- support and maintenance (підтримки і супроводу);
- legal / compliance work (юридичної та регуляторної підготовки).

### Чому це важливо

У Salesforce значна частина витрат має форму recurring platform fees (регулярних ліцензійних платежів).

У власній платформі значна частина витрат зсунуто:

- у початкову фазу побудови;
- а далі - у support, hosting і контрольовану еволюцію продукту.

Типова різниця між підходами може бути зведена до такої логіки:

- Salesforce: нижчий поріг запуску простого CRM, але часто вищий довгостроковий recurring spend у складних сценаріях;
- custom platform: вищий початковий поріг побудови, але часто нижчий platform lock-in і вищий контроль над подальшою економікою.

---

## Що треба уточнити перед фінальним фінансовим порівнянням

Щоб зробити вже остаточний client-ready TCO (готовий до клієнта фінансовий розрахунок), окремо треба зафіксувати:

- скільки буде named users (іменних користувачів);
- скільки з них потребують тільки CRM, а скільки - healthcare-tier access;
- чи потрібен Shield bundle для всіх користувачів або лише для частини;
- чи потрібні окремі продукти для portal, e-signature, integrations, analytics;
- який обсяг кастомної логіки реально потрібно реалізовувати в Salesforce;
- який expected support model (очікуваний формат підтримки) потрібен після запуску;
- чи потрібно порівнювати:
   - тільки software spend (витрати на ПЗ);
   - чи повний TCO разом із командою, інтеграціями, операціями і юридичною підготовкою.

---

## Публічні джерела

- Salesforce Sales Pricing:
   [salesforce.com/sales/pricing](https://www.salesforce.com/sales/pricing/?bc=HA)
- Salesforce Health Cloud Pricing:
   [salesforce.com/healthcare-life-sciences/health-cloud/pricing](https://www.salesforce.com/healthcare-life-sciences/health-cloud/pricing/?bc=HA)
- Salesforce Shield Pricing:
   [salesforce.com/platform/shield/pricing](https://www.salesforce.com/platform/shield/pricing/?bc=HA)

---

