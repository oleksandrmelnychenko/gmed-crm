# Посилені заходи належної перевірки (§ 15 GwG): формуляр і докази походження коштів

Стан: 2026-10-03. Це інженерний опис, не юридична консультація.

## Що це

Внутрішній документ GMED «Durchführung verstärkter Sorgfaltspflichten»
(шаблон `enhanced_due_diligence`, номер `AML-…`). Він потрібен, коли клієнт —
політично значуща особа (PeP) або пов'язаний із країною підвищеного ризику
(`lead_requires_enhanced_due_diligence` у `routes/leads.rs`). Формуляр
заповнюється:

- у візарді ліда — панель «Verstärkte Sorgfaltspflichten (§ 15 GwG)»
  (`frontend/src/pages/leads/ui/lead-wizard.tsx`), дані зберігаються у
  `leads.wizard_state.aml_enhanced_due_diligence`;
- у генерації документа для пацієнта — `EnhancedDueDiligenceBindingFields`
  (`frontend/src/pages/documents/ui/enhanced-due-diligence-binding-fields.tsx`).

PDF будує `build_enhanced_due_diligence_pdf` у `routes/documents.rs`; дані
формуляра зберігаються у `documents.generated_bindings.aml_enhanced_due_diligence`.
Документ підписує лише представник GMED (політика підписантів `agency_only`).

## Докази походження коштів (з 2026-10-03)

§ 15 Abs. 4 Nr. 2 GwG вимагає заходів, якими визначається походження майна;
§ 8 GwG — фіксації й зберігання цих відомостей. Тому одразу під полем
«Herkunft der eingesetzten Vermögenswerte» є завантажувач «Nachweise zur
Herkunft der Vermögenswerte» (`AssetOriginEvidenceField`).

- Файли: PDF, JPG, PNG, до 25 МБ кожен, до 20 у формулярі (виписки з рахунку,
  договори купівлі-продажу, довідки про доходи тощо).
- Кожен файл одразу зберігається звичайним завантаженням
  (`POST /documents/upload`) як внутрішній документ того самого пацієнта або
  ліда: `art = aml_asset_origin_evidence`, `category = compliance_aml`,
  `visibility = internal`. Він проходить ту саму перевірку типу файла й
  антивірус, що й будь-яке завантаження.
- У формулярі зберігаються лише посилання:
  `assetOriginEvidence: [{ documentId, filename, uploadedOn }]`.
- Під час генерації сервер (`resolve_aml_asset_origin_evidence`) перевіряє, що
  кожен документ існує, не видалений, має тип `aml_asset_origin_evidence` і
  належить тому самому пацієнту або ліду; інакше — 422 «Asset origin evidence
  document not found». Назву файла й дату завантаження сервер бере зі
  збереженого документа, а не із запиту.
- У PDF під «Herkunft der eingesetzten Vermögenswerte» друкується перелік
  «Nachweise zur Herkunft der Vermögenswerte (in der Akte abgelegt)»:
  `1. Kontoauszug.pdf (hochgeladen am 03.10.2026)`.
- «Убрать» у формулярі лише знімає посилання; файл лишається в документах
  (видалення — звичайним шляхом документів, з причиною й аудитом).
- У візарді ліда такі файли не потрапляють до розділів «посвідчення особи /
  згоди» навіть якщо їхня назва схожа на паспорт.

## Чого немає

- Окремого строку зберігання для цих файлів: діє загальна політика документів
  (див. `docs/compliance/04_loeschkonzept.md`); п'ятирічний строк § 8 Abs. 4 GwG
  слід врахувати при наступному перегляді концепції видалення.
- Автоматичної перевірки змісту доказів — це рішення працівника й керівника,
  який погоджує формуляр.
