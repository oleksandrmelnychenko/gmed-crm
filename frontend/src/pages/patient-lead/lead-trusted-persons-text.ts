import { actsAsVormund, asLeadCabinetLang } from "./lead-request-text";

const texts = {
  de: {
    personsHeading: "Benannte Personen",
    title: "Auskunft an Dritte",
    introduction: "Wir geben Auskunft über Ihre persönlichen und medizinischen Daten ausschließlich an Sie selbst. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Ehepartner, Partner, Freunde, Kinder oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    representativeContext: (person: string) => `Sie entscheiden als Vertretung für ${person}. Die folgenden Angaben und die Einwilligung beziehen sich auf die Daten dieser Person.`,
    question: "Soll eine weitere Person Auskunft erhalten dürfen?", no: "Nein, nur ich selbst.", yes: "Ja, folgende Person(en) dürfen Auskunft erhalten:",
    noParents: "Nein, nur wir als Eltern.", noGuardian: "Nein, nur ich als Vormund.",
    noOwnRepresented: "Nein, nur ich selbst und meine Vertretung.",
    introductionOwnRepresented: "Wir geben Auskunft über Ihre persönlichen und medizinischen Daten ausschließlich an Sie selbst und an die Person, die Sie vertritt. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Ehepartner, Partner, Freunde, Kinder oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    noSoleParent: "Nein, nur ich als allein sorgeberechtigter Elternteil.",
    noRepresented: "Nein, nur die vertretene Person selbst und ich als ihre Vertretung.",
    introductionSoleParent: "Wir geben Auskunft über die persönlichen und medizinischen Daten Ihres Kindes ausschließlich an Sie als allein sorgeberechtigten Elternteil. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Partner, Freunde, Geschwister oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    introductionRepresented: "Wir geben Auskunft über die persönlichen und medizinischen Daten der von Ihnen vertretenen Person ausschließlich an diese Person selbst und an Sie als ihre Vertretung. Das gilt auch für Personen aus dem Umfeld der vertretenen Person, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Ehepartner, Partner, Freunde, Kinder oder andere Angehörige. Ohne ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    introductionParents: "Wir geben Auskunft über die persönlichen und medizinischen Daten Ihres Kindes ausschließlich an Sie als Eltern. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Partner, Freunde, Geschwister oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    introductionGuardian: "Wir geben Auskunft über die persönlichen und medizinischen Daten des Kindes ausschließlich an Sie als Vormund. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Partner, Freunde, Geschwister oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    name: "Name, Vorname", relation: "Beziehung zu Ihnen (z. B. Ehefrau, Tochter, Freund)", contact: "Telefon / E-Mail", scope: "Umfang der Auskunft", scopePlaceholder: "Bitte auswählen",
    scopeHint: "Diese Auswahl wird in Ihre Einwilligung zur Datenübermittlung übernommen.",
    scopeLegacy: (typed: string) => `Bisher angegeben: „${typed}“. Bitte wählen Sie den Umfang der Auskunft aus der Liste.`,
    consentHeading: "Einwilligung",
    consent: (company: string) => `Ich willige ausdrücklich ein, dass ${company} den oben genannten Personen im angegebenen Umfang Auskunft über meine personenbezogenen Daten, einschließlich meiner Gesundheitsdaten, erteilt und diese Daten an sie übermittelt. Soweit eine Schweigepflicht besteht, entbinde ich die an Organisation und Behandlung Beteiligten insoweit von dieser. Ich kann diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen. Die bis dahin erfolgte Verarbeitung bleibt davon unberührt. Weitere Informationen finden Sie im Datenschutzhinweis.`,
    privacy: "Datenschutzhinweis", footer: "Änderungen oder Widerruf teilen Sie uns bitte kurz mit.",
    savedByOther: (who: string, date: string) => `Diese Auswahl hat ${who} am ${date} gespeichert.`, otherParent: "der andere Elternteil bzw. die Vertretung",
    empty: "Noch keine Personen eingetragen.", save: "Speichern", saved: "Gespeichert", unsaved: "Änderungen noch nicht gespeichert", edit: "Auskunft an Dritte bearbeiten", requestLink: "Zum Antrag",
    byDefault: "Voreinstellung",
    consentReset: "Die Liste hat sich geändert – bitte bestätigen Sie die Einwilligung erneut.", legacy: "Eine frühere Auswahl liegt vor. Bitte bestätigen Sie Ihre aktuelle Entscheidung auf der Seite „Auskunft an Dritte“.",
    decision: "Bitte wählen Sie Ja oder Nein.", required: "Fügen Sie mindestens eine Person hinzu oder wählen Sie Nein.",
    invalid: "Geben Sie für jede Person einen Namen und eine Beziehung an und wählen Sie den Umfang der Auskunft aus. Höchstens 5 Personen; Name und Kontakt bis 120 Zeichen.",
    consentRequired: "Bitte bestätigen Sie die Einwilligung für die oben genannten Personen und den angegebenen Umfang.", outdated: "Die Einwilligung wurde aktualisiert. Laden Sie die Seite neu und bestätigen Sie den aktuellen Text.",
    nameRequired: "Bitte geben Sie den Namen an.", relationRequired: "Bitte wählen Sie die Beziehung aus.", scopeRequired: "Bitte wählen Sie den Umfang der Auskunft aus.",
    contactInvalid: "Bitte geben Sie eine Telefonnummer (z. B. +49 30 1234567) oder eine E-Mail-Adresse an.", maxReached: "Sie können höchstens 5 Personen benennen.",
  },
  en: {
    personsHeading: "Named people",
    title: "Information for third parties",
    introduction: "We provide information about your personal and medical data only to you personally. This also applies to people close to you who are not involved in organising your care or treatment, such as your spouse, partner, friends, children or other relatives. Without your explicit designation, we may not provide these people with any information.",
    representativeContext: (person: string) => `You are deciding as a representative for ${person}. The following details and consent relate to this person's data.`,
    question: "May another person receive information?", no: "No, only me.", yes: "Yes, the following person(s) may receive information:",
    noParents: "No, only us as parents.", noGuardian: "No, only me as the guardian.",
    noOwnRepresented: "No, only me and my representative.",
    introductionOwnRepresented: "We provide information about your personal and medical data only to you personally and to the person who represents you. This also applies to people close to you who are not involved in organising your care or treatment, such as your spouse, partner, friends, children or other relatives. Without your explicit designation, we may not provide these people with any information.",
    noSoleParent: "No, only me as the parent with sole custody.",
    noRepresented: "No, only the represented person and me as their representative.",
    introductionSoleParent: "We provide information about your child's personal and medical data only to you as the parent with sole custody. This also applies to people close to you who are not involved in organising the care or treatment, such as partners, friends, siblings or other relatives. Without your explicit designation, we may not provide these people with any information.",
    introductionRepresented: "We provide information about the personal and medical data of the person you represent only to that person and to you as their representative. This also applies to people close to the represented person who are not involved in organising the care or treatment, such as a spouse, partner, friends, children or other relatives. Without explicit designation, we may not provide these people with any information.",
    introductionParents: "We provide information about your child's personal and medical data only to you as parents. This also applies to people close to you who are not involved in organising the care or treatment, such as partners, friends, siblings or other relatives. Without your explicit designation, we may not provide these people with any information.",
    introductionGuardian: "We provide information about the child's personal and medical data only to you as the guardian. This also applies to people close to you who are not involved in organising the care or treatment, such as partners, friends, siblings or other relatives. Without your explicit designation, we may not provide these people with any information.",
    name: "Last name, first name", relation: "Relationship to you (e.g. wife, daughter, friend)", contact: "Phone / email", scope: "Scope of information", scopePlaceholder: "Please choose",
    scopeHint: "This choice is included in your consent to data transfer.",
    scopeLegacy: (typed: string) => `Previously entered: “${typed}”. Please choose the scope of information from the list.`,
    consentHeading: "Consent",
    consent: (company: string) => `I expressly consent to ${company} providing the persons named above with information about my personal data, including my health data, within the specified scope, and transmitting this data to them. Where a duty of confidentiality applies, I release those involved in organisation and treatment from that duty to this extent. I may withdraw this consent at any time with effect for the future. Processing carried out before withdrawal remains unaffected. Further information can be found in the Privacy Notice.`,
    privacy: "Privacy Notice", footer: "Just let us know about changes or withdrawal.",
    savedByOther: (who: string, date: string) => `This choice was saved by ${who} on ${date}.`, otherParent: "the other parent or representative",
    empty: "No people added yet.", save: "Save", saved: "Saved", unsaved: "Changes not saved yet", edit: "Edit information for third parties", requestLink: "Open request",
    byDefault: "default",
    consentReset: "The list has changed – please confirm the consent again.", legacy: "An earlier choice is on record. Please confirm your current decision on the “Information for third parties” page.",
    decision: "Please select Yes or No.", required: "Add at least one person or select No.", invalid: "Enter a name and relationship and choose the scope of information for each person. Add up to 5 people; name and contact up to 120 characters.",
    consentRequired: "Please confirm consent for the people and scope specified above.", outdated: "The consent has been updated. Reload the page and confirm the current text.",
    nameRequired: "Please enter the name.", relationRequired: "Please choose the relationship.", scopeRequired: "Please choose the scope of information.",
    contactInvalid: "Please enter a phone number (e.g. +49 30 1234567) or an email address.", maxReached: "You can name up to 5 people.",
  },
  uk: {
    personsHeading: "Зазначені особи",
    title: "Надання інформації третім особам",
    introduction: "Ми надаємо інформацію про ваші персональні та медичні дані лише вам особисто. Це стосується й людей із вашого оточення, які не беруть участі в організації та лікуванні, наприклад чоловіка чи дружини, партнера, друзів, дітей або інших родичів. Без вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    representativeContext: (person: string) => `Ви приймаєте рішення як представник особи ${person}. Наведені нижче відомості та згода стосуються даних цієї особи.`,
    question: "Чи можуть інші особи отримувати інформацію?", no: "Ні, лише я особисто.", yes: "Так, інформацію можуть отримувати такі особи:",
    noParents: "Ні, тільки ми (батьки).", noGuardian: "Ні, тільки я як опікун.",
    noOwnRepresented: "Ні, лише я особисто та мій представник.",
    introductionOwnRepresented: "Ми надаємо інформацію про ваші персональні та медичні дані лише вам особисто та особі, яка вас представляє. Це стосується й людей із вашого оточення, які не беруть участі в організації та лікуванні, наприклад чоловіка чи дружини, партнера, друзів, дітей або інших родичів. Без вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    noSoleParent: "Ні, тільки я як один із батьків з одноосібним правом опіки.",
    noRepresented: "Ні, тільки особа, яку я представляю, і я як її представник.",
    introductionSoleParent: "Ми надаємо інформацію про персональні та медичні дані вашої дитини лише вам як одному з батьків з одноосібним правом опіки. Це стосується й людей із вашого оточення, які не беруть участі в організації та лікуванні, наприклад партнерів, друзів, братів і сестер або інших родичів. Без вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    introductionRepresented: "Ми надаємо інформацію про персональні та медичні дані особи, яку ви представляєте, лише цій особі та вам як її представнику. Це стосується й людей з оточення цієї особи, які не беруть участі в організації та лікуванні, наприклад чоловіка чи дружини, партнера, друзів, дітей або інших родичів. Без прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    introductionParents: "Ми надаємо інформацію про персональні та медичні дані вашої дитини лише вам як батькам. Це стосується й людей із вашого оточення, які не беруть участі в організації та лікуванні, наприклад партнерів, друзів, братів і сестер або інших родичів. Без вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    introductionGuardian: "Ми надаємо інформацію про персональні та медичні дані дитини лише вам як опікуну. Це стосується й людей із вашого оточення, які не беруть участі в організації та лікуванні, наприклад партнерів, друзів, братів і сестер або інших родичів. Без вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    name: "Прізвище, ім’я", relation: "Ким доводиться вам (напр. дружина, донька, друг)", contact: "Телефон / ел. пошта", scope: "Обсяг інформації", scopePlaceholder: "Будь ласка, виберіть",
    scopeHint: "Цей вибір буде внесено до вашої згоди на передачу даних.",
    scopeLegacy: (typed: string) => `Раніше вказано: «${typed}». Виберіть, будь ласка, обсяг інформації зі списку.`,
    consentHeading: "Згода",
    consent: (company: string) => `Я надаю явну згоду на те, що ${company} надає зазначеним вище особам у вказаному обсязі інформацію про мої персональні дані, зокрема дані про стан здоров’я, та передає їм ці дані. Якщо існує обов’язок дотримуватися лікарської таємниці, я в цьому обсязі звільняю осіб, які беруть участь в організації та лікуванні, від цього обов’язку. Я можу будь-коли відкликати цю згоду на майбутнє. Обробка даних, здійснена до відкликання, залишається законною. Додаткова інформація міститься в Повідомленні про захист даних.`,
    privacy: "Повідомлення про захист даних", footer: "Про зміни чи відкликання просто повідомте нам.",
    savedByOther: (who: string, date: string) => `Цей вибір зберіг(ла) ${who} ${date}.`, otherParent: "другий з батьків або представник",
    empty: "Осіб ще не додано.", save: "Зберегти", saved: "Збережено", unsaved: "Зміни ще не збережено", edit: "Змінити надання інформації третім особам", requestLink: "Відкрити заявку",
    byDefault: "за замовчуванням",
    consentReset: "Список змінився — підтвердьте згоду ще раз.", legacy: "Є попередній вибір. Підтвердьте поточне рішення на сторінці «Надання інформації третім особам».",
    decision: "Виберіть Так або Ні.", required: "Додайте хоча б одну особу або виберіть Ні.", invalid: "Для кожної особи вкажіть ім’я та зв’язок і виберіть обсяг інформації. Не більше 5 осіб; ім’я й контакт до 120 символів.",
    consentRequired: "Підтвердьте згоду для зазначених вище осіб та обсягу інформації.", outdated: "Текст згоди оновлено. Перезавантажте сторінку та підтвердьте поточний текст.",
    nameRequired: "Вкажіть, будь ласка, ім’я.", relationRequired: "Виберіть, будь ласка, ким доводиться ця особа.", scopeRequired: "Виберіть, будь ласка, обсяг інформації.",
    contactInvalid: "Вкажіть, будь ласка, номер телефону (напр. +49 30 1234567) або адресу ел. пошти.", maxReached: "Можна вказати не більше 5 осіб.",
  },
  ru: {
    personsHeading: "Указанные лица",
    title: "Предоставление информации третьим лицам",
    introduction: "Мы предоставляем информацию о ваших персональных и медицинских данных только вам лично. Это касается и людей из вашего окружения, которые не участвуют в организации и лечении, например супруга(и), партнёра, друзей, детей или других родственников. Без вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    representativeContext: (person: string) => `Вы принимаете решение как представитель лица ${person}. Приведённые ниже сведения и согласие относятся к данным этого лица.`,
    question: "Могут ли другие лица получать информацию?", no: "Нет, только я сам(а).", yes: "Да, информацию могут получать следующие лица:",
    noParents: "Нет, только мы (родители).", noGuardian: "Нет, только я как опекун.",
    noOwnRepresented: "Нет, только я сам(а) и мой представитель.",
    introductionOwnRepresented: "Мы предоставляем информацию о ваших персональных и медицинских данных только вам лично и лицу, которое вас представляет. Это касается и людей из вашего окружения, которые не участвуют в организации и лечении, например супруга(и), партнёра, друзей, детей или других родственников. Без вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    noSoleParent: "Нет, только я как родитель с единоличным правом опеки.",
    noRepresented: "Нет, только представляемое лицо и я как его представитель.",
    introductionSoleParent: "Мы предоставляем информацию о персональных и медицинских данных вашего ребёнка только вам как родителю с единоличным правом опеки. Это касается и людей из вашего окружения, которые не участвуют в организации и лечении, например партнёров, друзей, братьев и сестёр или других родственников. Без вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    introductionRepresented: "Мы предоставляем информацию о персональных и медицинских данных представляемого вами лица только этому лицу и вам как его представителю. Это касается и людей из окружения этого лица, которые не участвуют в организации и лечении, например супруга(и), партнёра, друзей, детей или других родственников. Без прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    introductionParents: "Мы предоставляем информацию о персональных и медицинских данных вашего ребёнка только вам как родителям. Это касается и людей из вашего окружения, которые не участвуют в организации и лечении, например партнёров, друзей, братьев и сестёр или других родственников. Без вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    introductionGuardian: "Мы предоставляем информацию о персональных и медицинских данных ребёнка только вам как опекуну. Это касается и людей из вашего окружения, которые не участвуют в организации и лечении, например партнёров, друзей, братьев и сестёр или других родственников. Без вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    name: "Фамилия, имя", relation: "Кем приходится вам (напр. жена, дочь, друг)", contact: "Телефон / эл. почта", scope: "Объём информации", scopePlaceholder: "Пожалуйста, выберите",
    scopeHint: "Этот выбор будет внесён в ваше согласие на передачу данных.",
    scopeLegacy: (typed: string) => `Ранее указано: «${typed}». Выберите, пожалуйста, объём информации из списка.`,
    consentHeading: "Согласие",
    consent: (company: string) => `Я даю явное согласие на то, что ${company} предоставляет указанным выше лицам в указанном объёме информацию о моих персональных данных, включая данные о состоянии здоровья, и передаёт им эти данные. Если существует обязанность соблюдать врачебную тайну, я в этом объёме освобождаю лиц, участвующих в организации и лечении, от этой обязанности. Я могу в любое время отозвать это согласие на будущее. Обработка данных, осуществлённая до отзыва, остаётся законной. Дополнительная информация содержится в Уведомлении о защите данных.`,
    privacy: "Уведомление о защите данных", footer: "Об изменениях или отзыве просто сообщите нам.",
    savedByOther: (who: string, date: string) => `Этот выбор сохранил(а) ${who} ${date}.`, otherParent: "другой родитель или представитель",
    empty: "Лица ещё не добавлены.", save: "Сохранить", saved: "Сохранено", unsaved: "Изменения ещё не сохранены", edit: "Изменить предоставление информации третьим лицам", requestLink: "Открыть заявку",
    byDefault: "по умолчанию",
    consentReset: "Список изменился — подтвердите согласие ещё раз.", legacy: "Есть предыдущий выбор. Подтвердите текущее решение на странице «Предоставление информации третьим лицам».",
    decision: "Выберите Да или Нет.", required: "Добавьте хотя бы одно лицо или выберите Нет.", invalid: "Для каждого лица укажите имя и связь и выберите объём информации. Не более 5 лиц; имя и контакт до 120 символов.",
    consentRequired: "Подтвердите согласие для указанных выше лиц и объёма информации.", outdated: "Текст согласия обновлён. Перезагрузите страницу и подтвердите актуальный текст.",
    nameRequired: "Укажите, пожалуйста, имя.", relationRequired: "Выберите, пожалуйста, кем приходится это лицо.", scopeRequired: "Выберите, пожалуйста, объём информации.",
    contactInvalid: "Укажите, пожалуйста, номер телефона (напр. +49 30 1234567) или адрес эл. почты.", maxReached: "Можно указать не более 5 лиц.",
  },
};

export function trustedPersonsText(lang: string) {
  return texts[asLeadCabinetLang(lang) ?? "ru"];
}

/** Whose data the disclosure consent is about (mirrors `DisclosureSubject` on the server). */
export type DisclosureSubject = "own" | "child" | "represented";

export function disclosureSubject(request: { access_kind?: string | null; minor?: boolean | null }): DisclosureSubject {
  if (request.access_kind !== "guardian") return "own";
  return request.minor === true ? "child" : "represented";
}

type TrustedPersonsText = ReturnType<typeof trustedPersonsText>;
type ChildCabinet = {
  access_kind?: string | null;
  minor?: boolean | null;
  representation?: { custody?: string | null; has_representative?: boolean | null } | null;
};

/**
 * "No" and the introduction of the disclosure by whose data it is and who decides (QA 2026-10-24/25):
 * a child's data go only to the parents ("wir als Eltern"), the parent with sole custody ("ich als allein
 * sorgeberechtigter Elternteil") or the guardian ("ich als Vormund") — never "only me myself"; a represented
 * adult's data go to that person and the representative, also when the adult answers in the own login
 * while somebody acts for them (Betreuer, power of attorney).
 */
export function disclosureWording(text: TrustedPersonsText, request: ChildCabinet): { no: string; introduction: string } {
  const subject = disclosureSubject(request);
  if (subject === "represented") return { no: text.noRepresented, introduction: text.introductionRepresented };
  if (subject === "own") {
    return request.representation?.has_representative === true
      ? { no: text.noOwnRepresented, introduction: text.introductionOwnRepresented }
      : { no: text.no, introduction: text.introduction };
  }
  if (actsAsVormund(request)) return { no: text.noGuardian, introduction: text.introductionGuardian };
  return request.representation?.custody === "sole_parent"
    ? { no: text.noSoleParent, introduction: text.introductionSoleParent }
    : { no: text.noParents, introduction: text.introductionParents };
}

// The phrase of the own text and its replacements; the server stores the same wording.
const subjectPhrases = {
  de: {
    own: "über meine personenbezogenen Daten, einschließlich meiner Gesundheitsdaten,",
    child: "über die personenbezogenen Daten meines Kindes, einschließlich seiner Gesundheitsdaten,",
    represented: "über die personenbezogenen Daten der von mir vertretenen Person, einschließlich ihrer Gesundheitsdaten,",
  },
  en: {
    own: "about my personal data, including my health data,",
    child: "about my child's personal data, including my child's health data,",
    represented: "about the personal data of the person I represent, including their health data,",
  },
  uk: {
    own: "про мої персональні дані, зокрема дані про стан здоров’я,",
    child: "про персональні дані моєї дитини, зокрема дані про стан її здоров’я,",
    represented: "про персональні дані особи, яку я представляю, зокрема дані про стан її здоров’я,",
  },
  ru: {
    own: "о моих персональных данных, включая данные о состоянии здоровья,",
    child: "о персональных данных моего ребёнка, включая данные о состоянии его здоровья,",
    represented: "о персональных данных представляемого мною лица, включая данные о состоянии его здоровья,",
  },
} as const;

/** The disclosure consent for whose data it is: a parent consents for the child's data, never "my data". */
export function disclosureConsentText(lang: string, company: string, subject: DisclosureSubject): string {
  const key = asLeadCabinetLang(lang) ?? "ru";
  const own = texts[key].consent(company);
  if (subject === "own") return own;
  const phrases = subjectPhrases[key];
  return own.replace(phrases.own, phrases[subject]);
}
