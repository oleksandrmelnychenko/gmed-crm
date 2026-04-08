> Підготував: **Oleksandr Melnychenko, CEO at [Horizon Dynamics](https://www.horizon-dynamics.tech/)**

# Release Package Index

> Індекс релізного пакета документів для передачі клієнту у форматі PDF.

## Статус документа

- Версія: `Release Draft`
- Формат: `Client-facing PDF package`
- Дата підготовки: `Квітень 2026`

---

## 1. Призначення пакета

Цей пакет підготовлено для презентації клієнту варіантів побудови операційної системи медичної агенції:

- на базі Salesforce;
- на базі власної платформи;
- з урахуванням правових, фінансових і договірних ризиків.

Матеріали орієнтовані на:

- CEO / власника бізнесу;
- операційного директора;
- фінансового директора;
- зовнішнього юриста;
- IT / security stakeholders (технічних і безпекових учасників прийняття рішення).

---

## 2. Склад пакета

### Документ 1. Основне порівняння

`docs/comparison/salesforce-vs-custom-platform.md`

Містить:

- стратегічне порівняння Salesforce та власної платформи;
- product fit (відповідність продукту);
- data residency (локалізацію даних);
- encryption and audit (шифрування та аудит);
- access control (контроль доступу);
- medical workflow fit (відповідність медичному процесу);
- billing fit (відповідність фінансовому контуру);
- відповідальність при витоку;
- варіанти рішення;
- базову рекомендацію.

### Документ 2. Legal Risk Appendix

`docs/comparison/legal-risk-appendix.md`

Містить:

- володілець персональних даних / виконавець обробки / підрядний виконавець обробки (GDPR) logic;
- відповідальність при `personal data breach`;
- практичне пояснення "кого судять";
- відмінність між Salesforce scenario та custom platform scenario;
- юридичні питання, які обов'язково потрібно перевірити окремо.

### Документ 3. Contract Checklist

`docs/comparison/custom-platform-contract-checklist.md`

Містить:

- checklist для договору по власній платформі;
- ownership and control (власність і контроль);
- security obligations (обов'язки щодо безпеки);
- incident response (реагування на інциденти);
- audit rights (права аудиту);
- liability / indemnities / insurance;
- exit and transition terms (умови виходу і передачі).

### Документ 4. TCO and Entry Cost Appendix

`docs/comparison/tco-financial-appendix.md`

Містить:

- published pricing (опубліковані ціни) Salesforce;
- entry cost scenarios (сценарії вартості входу);
- recurring license baseline (базовий регулярний ліцензійний контур);
- пояснення, що входить і не входить у фінансову модель;
- список даних, які потрібно ще підтвердити для фінального TCO.

---

## 3. Рекомендований порядок читання

Для керівництва:

1. `salesforce-vs-custom-platform.md`
2. `tco-financial-appendix.md`
3. `legal-risk-appendix.md`

Для юриста:

1. `legal-risk-appendix.md`
2. `custom-platform-contract-checklist.md`
3. `salesforce-vs-custom-platform.md`

Для фінансового блоку:

1. `tco-financial-appendix.md`
2. `salesforce-vs-custom-platform.md`

Для технічної сторони:

1. `salesforce-vs-custom-platform.md`
2. `custom-platform-contract-checklist.md`

---

## 4. Рекомендована структура PDF-комплекту

Для фінального PDF-пакета доцільно використати таку послідовність:

1. `Cover page` (титульна сторінка)
   `docs/comparison/cover-page.md`
2. `Release Package Index` (цей документ)
   `docs/comparison/release-package-index.md`
3. `Salesforce vs. Власна платформа`
   `docs/comparison/salesforce-vs-custom-platform.md`
4. `TCO and Entry Cost Appendix`
   `docs/comparison/tco-financial-appendix.md`
5. `Legal Risk Appendix`
   `docs/comparison/legal-risk-appendix.md`
6. `Custom Platform Contract Checklist`
   `docs/comparison/custom-platform-contract-checklist.md`

---

## 5. Важливе застереження

Цей пакет є decision support package (пакетом для підтримки управлінського рішення).

Він:

- не є остаточним договором;
- не є індивідуальною юридичною консультацією;
- не є комерційною офертою;
- не замінює окрему юридичну перевірку, фінальний кошторис і договірне узгодження.

---

## 6. Статус пакета

- Версія: `Release Draft`
- Дата оновлення: `Квітень 2026`
- Формат: `Client-facing PDF package`

---

*Оновлено: Квітень 2026*
