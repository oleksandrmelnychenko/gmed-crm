import { asLeadCabinetLang } from "./lead-request-text";

const texts = {
  de: {
    personsHeading: "Benannte Personen",
    title: "Auskunft an Dritte",
    introduction: "Wir geben Auskunft über Ihre persönlichen und medizinischen Daten ausschließlich an Sie selbst. Das gilt auch für Personen aus Ihrem Umfeld, die an der Organisation und Behandlung nicht beteiligt sind, zum Beispiel Ehepartner, Partner, Freunde, Kinder oder andere Angehörige. Ohne Ihre ausdrückliche Benennung dürfen wir diesen Personen keine Auskunft geben.",
    guardianContext: (child: string) => `Sie entscheiden als Elternteil oder gesetzliche Vertretung für ${child}. Die folgenden Angaben und die Einwilligung beziehen sich auf die Daten dieses Kindes.`,
    representativeContext: (person: string) => `Sie entscheiden als Vertretung für ${person}. Die folgenden Angaben und die Einwilligung beziehen sich auf die Daten dieser Person.`,
    question: "Soll eine weitere Person Auskunft erhalten dürfen?", no: "Nein, nur ich selbst.", yes: "Ja, folgende Person(en) dürfen Auskunft erhalten:",
    name: "Name, Vorname", relation: "Beziehung zu Ihnen (z. B. Ehefrau, Tochter, Freund)", contact: "Telefon / E-Mail", scope: "Umfang der Auskunft", scopePlaceholder: "Bitte auswählen",
    scopeHint: "Diese Auswahl wird in Ihre Einverständniserklärung zur Datenübermittlung (Anlage 1) übernommen.",
    scopeLegacy: (typed: string) => `Bisher angegeben: „${typed}“. Bitte wählen Sie den Umfang der Auskunft aus der Liste.`,
    consentHeading: "Einwilligung",
    consent: (company: string) => `Ich willige ausdrücklich ein, dass ${company} den oben genannten Personen im angegebenen Umfang Auskunft über meine personenbezogenen Daten, einschließlich meiner Gesundheitsdaten, erteilt und diese Daten an sie übermittelt. Soweit eine Schweigepflicht besteht, entbinde ich die an Organisation und Behandlung Beteiligten insoweit von dieser. Ich kann diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen. Die bis dahin erfolgte Verarbeitung bleibt davon unberührt. Weitere Informationen finden Sie im Datenschutzhinweis.`,
    privacy: "Datenschutzhinweis", footer: "Hinweis: Nur die hier genannten Personen dürfen Auskunft erhalten. Änderungen oder den Widerruf teilen Sie uns bitte einfach kurz mit.",
    empty: "Noch keine Personen eingetragen.", save: "Speichern", saved: "Gespeichert", unsaved: "Änderungen noch nicht gespeichert", edit: "Auskunft an Dritte bearbeiten", requestLink: "Zum Antrag",
    unanswered: "Noch nicht beantwortet", allowed: "Auskunft erlaubt", denied: "Keine Auskunft an Dritte", legacy: "Eine frühere Auswahl liegt vor. Bitte bestätigen Sie Ihre aktuelle Entscheidung auf der Seite „Auskunft an Dritte“.",
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
    guardianContext: (child: string) => `You are deciding as a parent or legal representative for ${child}. The following details and consent relate to this child's data.`,
    representativeContext: (person: string) => `You are deciding as a representative for ${person}. The following details and consent relate to this person's data.`,
    question: "May another person receive information?", no: "No, only me.", yes: "Yes, the following person(s) may receive information:",
    name: "Last name, first name", relation: "Relationship to you (e.g. wife, daughter, friend)", contact: "Phone / email", scope: "Scope of information", scopePlaceholder: "Please choose",
    scopeHint: "This choice is included in your consent to data transfer (Annex 1).",
    scopeLegacy: (typed: string) => `Previously entered: “${typed}”. Please choose the scope of information from the list.`,
    consentHeading: "Consent",
    consent: (company: string) => `I expressly consent to ${company} providing the persons named above with information about my personal data, including my health data, within the specified scope, and transmitting this data to them. Where a duty of confidentiality applies, I release those involved in organisation and treatment from that duty to this extent. I may withdraw this consent at any time with effect for the future. Processing carried out before withdrawal remains unaffected. Further information can be found in the Privacy Notice.`,
    privacy: "Privacy Notice", footer: "Note: Only the persons named here may receive information. Please let us know briefly if you wish to make changes or withdraw your consent.",
    empty: "No people added yet.", save: "Save", saved: "Saved", unsaved: "Changes not saved yet", edit: "Edit information for third parties", requestLink: "Open request",
    unanswered: "Not answered yet", allowed: "Disclosure permitted", denied: "No disclosure to third parties", legacy: "An earlier choice is on record. Please confirm your current decision on the “Information for third parties” page.",
    decision: "Please select Yes or No.", required: "Add at least one person or select No.", invalid: "Enter a name and relationship and choose the scope of information for each person. Add up to 5 people; name and contact up to 120 characters.",
    consentRequired: "Please confirm consent for the people and scope specified above.", outdated: "The consent has been updated. Reload the page and confirm the current text.",
    nameRequired: "Please enter the name.", relationRequired: "Please choose the relationship.", scopeRequired: "Please choose the scope of information.",
    contactInvalid: "Please enter a phone number (e.g. +49 30 1234567) or an email address.", maxReached: "You can name up to 5 people.",
  },
  uk: {
    personsHeading: "Зазначені особи",
    title: "Надання інформації третім особам",
    introduction: "Ми надаємо інформацію про Ваші персональні та медичні дані лише Вам особисто. Це стосується й людей із Вашого оточення, які не беруть участі в організації та лікуванні, наприклад чоловіка чи дружини, партнера, друзів, дітей або інших родичів. Без Вашої прямої вказівки ми не маємо права надавати цим особам жодної інформації.",
    guardianContext: (child: string) => `Ви приймаєте рішення як один із батьків або законний представник дитини ${child}. Наведені нижче відомості та згода стосуються даних цієї дитини.`,
    representativeContext: (person: string) => `Ви приймаєте рішення як представник особи ${person}. Наведені нижче відомості та згода стосуються даних цієї особи.`,
    question: "Чи можуть інші особи отримувати інформацію?", no: "Ні, лише я особисто.", yes: "Так, інформацію можуть отримувати такі особи:",
    name: "Прізвище, ім’я", relation: "Ким доводиться Вам (напр. дружина, донька, друг)", contact: "Телефон / ел. пошта", scope: "Обсяг інформації", scopePlaceholder: "Будь ласка, виберіть",
    scopeHint: "Цей вибір буде внесено до Вашої згоди на передачу даних (додаток 1).",
    scopeLegacy: (typed: string) => `Раніше вказано: «${typed}». Виберіть, будь ласка, обсяг інформації зі списку.`,
    consentHeading: "Згода",
    consent: (company: string) => `Я надаю явну згоду на те, що ${company} надає зазначеним вище особам у вказаному обсязі інформацію про мої персональні дані, зокрема дані про стан здоров’я, та передає їм ці дані. Якщо існує обов’язок дотримуватися лікарської таємниці, я в цьому обсязі звільняю осіб, які беруть участь в організації та лікуванні, від цього обов’язку. Я можу будь-коли відкликати цю згоду на майбутнє. Обробка даних, здійснена до відкликання, залишається законною. Додаткова інформація міститься в Повідомленні про захист даних.`,
    privacy: "Повідомлення про захист даних", footer: "Примітка: інформацію можуть отримувати лише зазначені тут особи. Про зміни або відкликання згоди просто повідомте нам.",
    empty: "Осіб ще не додано.", save: "Зберегти", saved: "Збережено", unsaved: "Зміни ще не збережено", edit: "Змінити надання інформації третім особам", requestLink: "Відкрити заявку",
    unanswered: "Ще не відповіли", allowed: "Надання інформації дозволено", denied: "Не надавати інформацію третім особам", legacy: "Є попередній вибір. Підтвердьте поточне рішення на сторінці «Надання інформації третім особам».",
    decision: "Виберіть Так або Ні.", required: "Додайте хоча б одну особу або виберіть Ні.", invalid: "Для кожної особи вкажіть ім’я та зв’язок і виберіть обсяг інформації. Не більше 5 осіб; ім’я й контакт до 120 символів.",
    consentRequired: "Підтвердьте згоду для зазначених вище осіб та обсягу інформації.", outdated: "Текст згоди оновлено. Перезавантажте сторінку та підтвердьте поточний текст.",
    nameRequired: "Вкажіть, будь ласка, ім’я.", relationRequired: "Виберіть, будь ласка, ким доводиться ця особа.", scopeRequired: "Виберіть, будь ласка, обсяг інформації.",
    contactInvalid: "Вкажіть, будь ласка, номер телефону (напр. +49 30 1234567) або адресу ел. пошти.", maxReached: "Можна вказати не більше 5 осіб.",
  },
  ru: {
    personsHeading: "Указанные лица",
    title: "Предоставление информации третьим лицам",
    introduction: "Мы предоставляем информацию о Ваших персональных и медицинских данных только Вам лично. Это касается и людей из Вашего окружения, которые не участвуют в организации и лечении, например супруга(и), партнёра, друзей, детей или других родственников. Без Вашего прямого указания мы не вправе предоставлять этим лицам никакую информацию.",
    guardianContext: (child: string) => `Вы принимаете решение как родитель или законный представитель ребёнка ${child}. Приведённые ниже сведения и согласие относятся к данным этого ребёнка.`,
    representativeContext: (person: string) => `Вы принимаете решение как представитель лица ${person}. Приведённые ниже сведения и согласие относятся к данным этого лица.`,
    question: "Могут ли другие лица получать информацию?", no: "Нет, только я сам(а).", yes: "Да, информацию могут получать следующие лица:",
    name: "Фамилия, имя", relation: "Кем приходится Вам (напр. жена, дочь, друг)", contact: "Телефон / эл. почта", scope: "Объём информации", scopePlaceholder: "Пожалуйста, выберите",
    scopeHint: "Этот выбор будет внесён в Ваше согласие на передачу данных (приложение 1).",
    scopeLegacy: (typed: string) => `Ранее указано: «${typed}». Выберите, пожалуйста, объём информации из списка.`,
    consentHeading: "Согласие",
    consent: (company: string) => `Я даю явное согласие на то, что ${company} предоставляет указанным выше лицам в указанном объёме информацию о моих персональных данных, включая данные о состоянии здоровья, и передаёт им эти данные. Если существует обязанность соблюдать врачебную тайну, я в этом объёме освобождаю лиц, участвующих в организации и лечении, от этой обязанности. Я могу в любое время отозвать это согласие на будущее. Обработка данных, осуществлённая до отзыва, остаётся законной. Дополнительная информация содержится в Уведомлении о защите данных.`,
    privacy: "Уведомление о защите данных", footer: "Примечание: информацию могут получать только указанные здесь лица. Об изменениях или об отзыве согласия просто сообщите нам.",
    empty: "Лица ещё не добавлены.", save: "Сохранить", saved: "Сохранено", unsaved: "Изменения ещё не сохранены", edit: "Изменить предоставление информации третьим лицам", requestLink: "Открыть заявку",
    unanswered: "Ещё не отвечено", allowed: "Предоставление информации разрешено", denied: "Не предоставлять информацию третьим лицам", legacy: "Есть предыдущий выбор. Подтвердите текущее решение на странице «Предоставление информации третьим лицам».",
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
