/** Datenschutzerklärung Formular GMED as supplied on 2026-10-12: the German original and its Russian version,
 * shown word for word (owner 2026-10-14: what is in the Word document is what the page shows). `lead` is the
 * bold beginning of a paragraph or item; section 1 opens with the controller's address lines as written.
 * The German text is authoritative. English and Ukrainian (owner 2026-11-10; QA finding 21: translated
 * headings above a German text) are translations of the German text made here, section by section, with
 * the same structure, references, names, addresses and periods — machine-drafted, not reviewed by a
 * lawyer; each opens with `FORM_PRIVACY_TRANSLATION_NOTE` (a convenience, the German version counts).
 */
export type FormPrivacyText = { lead?: string; text: string };
export type FormPrivacyBlock =
  | ({ kind: "paragraph" } & FormPrivacyText)
  | { kind: "list"; items: readonly FormPrivacyText[] }
  | { kind: "address"; lines: readonly string[] };
export type FormPrivacySection = { number: number; title: string; blocks: readonly FormPrivacyBlock[] };

export type FormPrivacyLanguage = "de" | "ru" | "en" | "uk";

export const FORM_PRIVACY_VERSION = "2026-10-12";

export const FORM_PRIVACY_SECTIONS: Record<FormPrivacyLanguage, readonly FormPrivacySection[]> = {
  de: [
    {
      number: 1,
      title: "Verantwortlicher und Datenschutzbeauftragter",
      blocks: [
        { kind: "address", lines: ["GMED - Agentur für Patientenbetreuung,", "Heorhii Hudiiev, Albert-Schweitzer-Straße 56", "81735 München", "Deutschland", "E-Mail: contact@gmed-health.com,", "Telefon: +49 151 20943768"] },
        { kind: "paragraph", text: "Verantwortlich für die Verarbeitung Ihrer Daten ist Heorhii Hudiiev, Albert-Schweitzer-Straße 56, 81735 München, Deutschland, E-mail: datenschutz@gmed-health.com." },
        { kind: "paragraph", text: "Diese Datenschutzerklärung gilt für unsere Kundenbefragung (Befragungsformular) und die Bearbeitung Ihrer Anfrage. Wenn wir zusammenarbeiten und einen Vertrag schließen, informieren wir Sie gesondert über die Datenverarbeitung bei der Zusammenarbeit. Für unsere Website gilt www.gmed-health.com/legal." },
      ],
    },
    {
      number: 2,
      title: "Welche Daten wir im Formular verarbeiten",
      blocks: [
        { kind: "paragraph", text: "Wir verarbeiten:" },
        { kind: "list", items: [
          { text: "Kontakt- und Identifikationsdaten (z. B. Name, Geburtsdatum, Staatsangehörigkeit, Anschrift, E-Mail, Telefon)," },
          { text: "Angaben zur Zahlung und Abrechnung (z. B. Zahlungsweise, Rechnungsempfänger, zahlende Person, Versicherungsstatus)," },
          { text: "Angaben zu weiteren Personen oder Organisationen, die Sie im Formular benennen (z. B. Angehörige, zahlende Person)," },
          { text: "Gesundheitsdaten einschließlich medizinischer Daten, z. B. Diagnosen, Beschwerden, Anamnese (besondere Kategorie nach Art. 9 DSGVO)," },
          { text: "Kommunikationsdaten (z. B. E-Mails und Nachrichten)," },
          { text: "Ergebnisse des Sanktionsscreenings (siehe Abschnitt 5)." },
        ] },
        { kind: "paragraph", text: "Die Daten erhalten wir von Ihnen und von den Personen, die Sie im Formular benennen." },
        { kind: "paragraph", text: "Wir verarbeiten personenbezogene Daten und Gesundheitsdaten von Patientinnen, Patienten, Angehörigen und Interessenten ausschließlich, um medizinische Untersuchungen und  Behandlungen zu vermitteln, zu organisieren und abzurechnen, sowie um nicht-medizinische Leistungen zu erbringen, zu vermitteln, zu organisieren und abzurechnen. Wir erbringen keine medizinischen Leistungen selbst, sondern organisatorische und verwaltungsbezogene Leistungen einschließlich Dolmetschen." },
      ],
    },
    {
      number: 3,
      title: "Zwecke und Rechtsgrundlagen",
      blocks: [
        { kind: "list", items: [
          { lead: "Bearbeitung Ihrer Anfrage, Prüfung und Vorbereitung einer Zusammenarbeit, Kommunikation mit Ihnen:", text: "Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen auf Ihre Anfrage)." },
          { lead: "Verarbeitung von Gesundheitsangaben im Formular:", text: "Ihre ausdrückliche Einwilligung, Art. 9 Abs. 2 lit. a DSGVO." },
          { lead: "Sanktionsscreening:", text: "Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, siehe Abschnitt 5)." },
          { lead: "Nachweis und Verteidigung gegen Rechtsansprüche:", text: "Art. 6 Abs. 1 lit. f DSGVO und, soweit Gesundheitsdaten betroffen sind, Art. 9 Abs. 2 lit. f DSGVO." },
          { lead: "Nachweis erteilter Einwilligungen:", text: "Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 7 Abs. 1 DSGVO." },
        ] },
      ],
    },
    {
      number: 4,
      title: "Pflichtangaben, Freiwilligkeit und automatisierte Entscheidungen",
      blocks: [
        { kind: "paragraph", text: "Pflichtfelder sind im Formular gekennzeichnet. Ohne die Pflichtangaben (Kontakt- und Identifikationsdaten, Angaben zu Rechnungsempfänger und zahlender Person) können wir Ihre Anfrage nicht bearbeiten und keine Zusammenarbeit anbieten. Alle anderen Angaben sind freiwillig." },
        { kind: "paragraph", text: "Ihre Einwilligung zur Verarbeitung Ihrer Gesundheitsangaben ist freiwillig. Wenn Sie sie nicht erteilen oder widerrufen, können wir die Behandlung leider nicht vermitteln, soweit medizinische Daten dafür erforderlich sind. Weitere Nachteile entstehen Ihnen nicht. Zum Widerruf siehe Abschnitt 11. Über die Weitergabe von Unterlagen an Kliniken, Ärztinnen und Ärzte und andere medizinische Leistungserbringer im Rahmen der Zusammenarbeit informieren wir Sie gesondert." },
        { kind: "paragraph", text: "Automatisierte Entscheidungen im Einzelfall einschließlich Profiling (Art. 22 DSGVO) treffen wir nicht. Auch beim Sanktionsscreening entscheiden Mitarbeitende." },
      ],
    },
    {
      number: 5,
      title: "Sanktionsscreening (Compliance-Prüfung)",
      blocks: [
        { kind: "paragraph", text: "Nach dem Absenden des Formulars und vor Beginn einer Zusammenarbeit gleichen wir Ihre Daten sowie die Daten der Personen und Organisationen, die Sie im Formular selbst angeben (z. B. die zahlende Person), mit den Finanzsanktionslisten der EU und Deutschlands ab. Wir nutzen dafür die Finanzsanktionsliste der Deutschen Bundesbank (FiSaLis). Verwendet werden nur Identifikationsdaten (Name, Geburtsdatum, Staatsangehörigkeit, Anschrift), keine Gesundheits- oder sonstigen medizinischen Daten. Kliniken, Ärztinnen und Ärzte sowie sonstige Leistungserbringer werden nicht geprüft. Auch bei späteren Zahlungen prüfen wir den Namen des Kontoinhabers eingehender Zahlungen. Darüber informieren wir Sie in der Datenschutzerklärung zur Zusammenarbeit." },
        { kind: "paragraph", text: "Rechtsgrundlage ist unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO): Wir möchten keine Zahlungen (z. B. Überweisungen oder Barzahlungen) von sanktionierten Personen oder Organisationen annehmen und nicht mit ihnen zusammenarbeiten, um rechtliche, finanzielle und Reputationsrisiken zu vermeiden, die wir in unserer internen Risikoanalyse bewertet haben. Das gilt für alle Kundinnen und Kunden. Über die Zusammenarbeit entscheiden wir erst nach dem Screening." },
        { kind: "paragraph", text: "Bei einem Treffer prüfen wir den Fall manuell; Entscheidungen treffen nur Mitarbeitende, nie allein ein automatisierter Abgleich. Bei einem bestätigten Treffer arbeiten wir mit der betroffenen Person oder Organisation nicht zusammen und nehmen keine Zahlungen von ihr an. Sollten wir in Ausnahmefällen gesetzlich dazu verpflichtet sein, informieren wir zuständige Behörden. Beruht ein Treffer auf einem Irrtum (z. B. Namensgleichheit), teilen Sie uns das bitte mit. Das Prüfergebnis speichern wir gemäß Abschnitt 9. Sie können dieser Prüfung widersprechen (Abschnitt 12)." },
      ],
    },
    {
      number: 6,
      title: "Empfänger und Auftragsverarbeiter",
      blocks: [
        { kind: "paragraph", text: "Wir verarbeiten Ihre Daten in unserem Kundenverwaltungssystem GMED-EDV-System." },
        { kind: "paragraph", lead: "Auftragsverarbeiter (Art. 28 DSGVO), die nach unseren Weisungen arbeiten:", text: "" },
        { kind: "list", items: [
          { text: "Hosting: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Deutschland. Unsere Server stehen ausschließlich in Rechenzentren in Deutschland. Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag." },
          { text: "Elektronische (Qualifizierte) Signatur: Skribble AG, Talacker 21, 8001 Zürich, Schweiz. Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag." },
        ] },
        { kind: "paragraph", lead: "Weitere Empfänger:", text: "" },
        { kind: "list", items: [
          { text: "unsere Mitarbeitenden, soweit sie die Daten für die Bearbeitung Ihrer Anfrage benötigen," },
          { text: "Dolmetscherinnen und Dolmetscher, soweit sie an der Bearbeitung Ihrer Anfrage beteiligt sind," },
          { text: "nur bei Online-Abfrage von FiSaLis: Deutsche Bundesbank (Suchbegriffe des Sanktionsscreenings)," },
          { text: "Behörden, soweit wir gesetzlich zur Meldung verpflichtet sind." },
        ] },
        { kind: "paragraph", text: "Eine Weitergabe an Kliniken, Ärztinnen und Ärzte und andere medizinische Leistungserbringer erfolgt erst im Rahmen der Zusammenarbeit. Darüber informieren wir Sie gesondert." },
      ],
    },
    {
      number: 7,
      title: "Übermittlung in Drittländer",
      blocks: [
        { kind: "paragraph", text: "Die Daten aus dem Formular verarbeiten wir in Deutschland und, für die elektronische Signatur Ihrer Einwilligung, in der Schweiz. Dafür setzen wir einen Auftragsverarbeiter in der Schweiz ein (Skribble AG, siehe Abschnitt 6), an den die dafür erforderlichen Daten übermittelt werden. Für die Schweiz hat die EU-Kommission ein angemessenes Datenschutzniveau festgestellt (Art. 45 DSGVO), weitere Garantien sind deshalb nicht erforderlich. Wenn im Rahmen der Zusammenarbeit Übermittlungen in Drittländer nötig werden (z. B. an Kliniken außerhalb der EU/des EWR), informieren wir Sie vorher gesondert und holen Ihre ausdrückliche Einwilligung ein." },
      ],
    },
    {
      number: 8,
      title: "Daten Dritter und Minderjährige",
      blocks: [
        { kind: "paragraph", text: "Wenn Sie uns Daten anderer Personen oder Organisationen mitteilen (auch im Formular), stellen Sie bitte sicher, dass Sie dazu befugt sind, und informieren Sie diese über diese Datenschutzerklärung. Deren Daten werden ebenfalls im Sanktionsscreening geprüft (Abschnitt 5). Gesundheitsangaben zu anderen Personen (z. B. zu Angehörigen) dürfen Sie nur machen, wenn diese eingewilligt haben oder Sie zu ihrer Vertretung befugt sind. Bei Minderjährigen willigen die Sorgeberechtigten ein." },
      ],
    },
    {
      number: 9,
      title: "Speicherdauer",
      blocks: [
        { kind: "paragraph", text: "Wir speichern personenbezogene Daten nur so lange, wie es für die genannten Zwecke erforderlich ist. Danach löschen wir sie, es sei denn, es bestehen gesetzliche Aufbewahrungspflichten (dann speichern wir sie bis zum Ablauf der jeweiligen Frist) oder wir benötigen sie weiterhin zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen (Art. 6 Abs. 1 lit. f DSGVO, bei Gesundheitsdaten Art. 9 Abs. 2 lit. f DSGVO). Unterliegen Daten mehreren Aufbewahrungsfristen, gilt die längste. Im Einzelnen:" },
        { kind: "list", items: [
          { text: "Anfragen ohne Vertrag: 14 Tage nach Absendung." },
          { text: "Einwilligung unterschrieben, aber kein Vertrag: 180 Tage, damit Sie sich in Ruhe entscheiden können und wir die bereits begonnene Planung (z. B. Abstimmung mit Kliniken, Klärung der Kostenübernahme) ohne erneute Datenerhebung fortsetzen können. Bei Widerruf der Einwilligung löschen wir sofort, soweit keine Aufbewahrungspflicht besteht." },
          { text: "Ergebnisse des Sanktionsscreenings: ohne Vertragsschluss zusammen mit der Anfrage nach 14 Tagen bzw. nach 180 Tagen bei unterschriebener Einwilligung; bei bestätigtem Treffer nach 3 Jahren, damit wir die Ablehnung nachweisen und Rechtsansprüche abwehren können." },
          { text: "Nachweis Ihrer Einwilligung: 3 Jahre nach Ablauf der jeweiligen Frist, damit wir sie nachweisen können (Art. 7 Abs. 1 DSGVO)." },
          { text: "Bei Vertragsschluss gehen Ihre Daten in das Vertragsverhältnis über. Die weiteren Speicherfristen, einschließlich der Aufbewahrung von Rechnungen, Verträgen und Screening-Ergebnissen, nennen wir Ihnen in der Datenschutzerklärung zur Zusammenarbeit." },
        ] },
      ],
    },
    {
      number: 10,
      title: "Datensicherheit",
      blocks: [
        { kind: "paragraph", text: "Wir schützen Ihre Daten durch angemessene technische und organisatorische Maßnahmen (Art. 32 DSGVO). Dazu gehören insbesondere die Verschlüsselung bei der Übertragung (TLS), die Verschlüsselung gespeicherter Daten, die Beschränkung des Zugriffs auf berechtigte Mitarbeitende nach dem Prinzip „nur, was nötig ist“." },
      ],
    },
    {
      number: 11,
      title: "Ihre Rechte",
      blocks: [
        { kind: "paragraph", text: "Sie haben das Recht auf Auskunft einschließlich einer Kopie Ihrer Daten (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20 DSGVO)." },
        { kind: "paragraph", text: "Sie können eine erteilte Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen; die bis dahin erfolgte Verarbeitung bleibt rechtmäßig. Der Widerruf ist so einfach möglich wie die Erteilung: schriftlich über die Kontaktdaten in Abschnitt 1." },
        { kind: "paragraph", text: "Wir antworten innerhalb eines Monats und kostenfrei. Zum Schutz Ihrer Daten können wir einen Nachweis Ihrer Identität verlangen." },
      ],
    },
    {
      number: 12,
      title: "Widerspruchsrecht",
      blocks: [
        { kind: "paragraph", lead: "Widerspruchsrecht (Art. 21 DSGVO):", text: "Sie können der Verarbeitung Ihrer Daten, die auf unserem berechtigten Interesse beruht (insbesondere dem Sanktionsscreening), jederzeit aus Gründen, die sich aus Ihrer besonderen Situation ergeben, widersprechen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen, Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen. Ohne Sanktionsscreening können wir nach unseren internen Compliance-Vorgaben keine Zusammenarbeit anbieten und keine Zahlungen entgegennehmen." },
      ],
    },
    {
      number: 13,
      title: "Beschwerderecht",
      blocks: [
        { kind: "paragraph", text: "Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem EU-Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO)." },
        { kind: "paragraph", text: "Wir würden uns freuen, wenn Sie uns zunächst Ihr Anliegen schildern (z. B. per E-Mail an datenschutz@gmed-health.com), damit wir es klären können. Ihr Recht, sich jederzeit direkt an eine Aufsichtsbehörde zu wenden, bleibt davon unberührt." },
      ],
    },
    {
      number: 14,
      title: "Stand und Änderungen",
      blocks: [
        { kind: "paragraph", text: "Stand: 12.10.2026. Wir passen diese Datenschutzerklärung an, wenn sich unsere Verarbeitungen ändern." },
      ],
    },
  ],
  ru: [
    {
      number: 1,
      title: "Ответственное лицо и уполномоченный по защите данных",
      blocks: [
        { kind: "address", lines: ["GMED - Agentur für Patientenbetreuung,", "Heorhii Hudiiev,", "Albert-Schweitzer-Straße 56", "81735 München", "Deutschland", "E-Mail: contact@gmed-health.com,", "Telefon: +49 151 20943768"] },
        { kind: "paragraph", text: "Лицо ответственное за обработку Ваших данных: Heorhii Hudiiev, Albert-Schweitzer-Straße 56, 81735 München, Deutschland, E-Mail: contact@gmed-health.com" },
        { kind: "paragraph", text: "Настоящая политика конфиденциальности касается нашего опроса клиентов (формы опроса) и обработки Вашего запроса. Если мы начнём сотрудничество и заключим договор, мы отдельно проинформируем Вас об обработке данных при сотрудничестве. Для нашего сайта действует www.gmed-health.com/legal." },
      ],
    },
    {
      number: 2,
      title: "Какие данные мы обрабатываем в форме",
      blocks: [
        { kind: "paragraph", text: "Мы обрабатываем:" },
        { kind: "list", items: [
          { text: "контактные и идентификационные данные (например, имя, дата рождения, гражданство, адрес, e-mail, телефон)," },
          { text: "сведения об оплате и расчётах (например, способ оплаты, получатель счёта, плательщик, статус страхования)," },
          { text: "сведения о других лицах или организациях, которых Вы указываете в форме (например, близкие, плательщик)," },
          { text: "данные о здоровье, включая медицинские данные, например диагнозы, жалобы, анамнез (особая категория данных согласно ст. 9 DSGVO)," },
          { text: "данные коммуникации (например, электронные письма и сообщения)," },
          { text: "результаты санкционной проверки (см. раздел 5)." },
        ] },
        { kind: "paragraph", text: "Данные мы получаем от Вас и от лиц, которых Вы указываете в форме." },
        { kind: "paragraph", text: "Мы сами не оказываем медицинских услуг, а предоставляем консалтинговые, организационные и административные услуги, включая услуги перевода." },
      ],
    },
    {
      number: 3,
      title: "Цели и правовые основания",
      // lawyer review pending (2026-10-22): references as "ст. 6 абз. 1 лит. b DSGVO", like the cabinet and the payer link.
      blocks: [
        { kind: "list", items: [
          { lead: "Обработка Вашего запроса, проверка и подготовка сотрудничества, общение с Вами:", text: "ст. 6 абз. 1 лит. b DSGVO (предварительные меры по Вашему запросу)." },
          { lead: "Обработка сведений о здоровье в форме:", text: "Ваше явное согласие, ст. 9 абз. 2 лит. a DSGVO." },
          { lead: "Санкционная проверка:", text: "ст. 6 абз. 1 лит. f DSGVO (законный интерес, см. раздел 5)." },
          { lead: "Подтверждение и защита от правовых требований:", text: "ст. 6 абз. 1 лит. f DSGVO и, если затрагиваются данные о здоровье, ст. 9 абз. 2 лит. f DSGVO." },
          { lead: "Подтверждение данных согласий:", text: "ст. 6 абз. 1 лит. c DSGVO в сочетании со ст. 7 абз. 1 DSGVO." },
        ] },
      ],
    },
    {
      number: 4,
      title: "Обязательные сведения, добровольность и автоматизированные решения",
      blocks: [
        { kind: "paragraph", text: "Обязательные поля отмечены в форме. Без обязательных сведений (контактные и идентификационные данные, сведения о получателе счёта и плательщике) мы не сможем обработать Ваш запрос и предложить сотрудничество. Все остальные сведения предоставляются добровольно." },
        { kind: "paragraph", text: "Ваше согласие на обработку Ваших сведений о здоровье добровольно. Если Вы не дадите согласие или отзовёте его, мы, к сожалению, не сможем организовать лечение, если для этого необходимы медицинские данные. Других неблагоприятных последствий для Вас не будет. Об отзыве согласия см. раздел 11. О передаче документов клиникам, врачам и другим медицинским учреждениям в рамках сотрудничества мы проинформируем Вас отдельно." },
        { kind: "paragraph", text: "Автоматизированные решения в отдельных случаях, включая профилирование (ст. 22 DSGVO), мы не принимаем. При санкционной проверке решения также принимают сотрудники." },
      ],
    },
    {
      number: 5,
      title: "Санкционная проверка (проверка на соблюдение требований)",
      blocks: [
        { kind: "paragraph", text: "После отправки формы и перед началом сотрудничества мы сверяем Ваши данные, а также данные лиц и организаций, которых Вы сами указываете в форме (например, плательщика), со списками финансовых санкций ЕС и Германии. Для этого мы используем список финансовых санкций Немецкого федерального банка (FiSaLis). Используются только идентификационные данные (имя, дата рождения, гражданство, адрес), без данных о здоровье и иных медицинских данных. Клиники, врачи и иные поставщики услуг не проверяются. При последующих платежах мы также проверяем имя владельца счёта, с которого поступил платёж. Об этом мы информируем Вас в политике конфиденциальности при сотрудничестве." },
        { kind: "paragraph", text: "Правовое основание: наш законный интерес (ст. 6 абз. 1 лит. f DSGVO). Мы не хотим принимать платежи (например, банковские переводы или наличные) от лиц и организаций, находящихся под санкциями, и сотрудничать с ними, чтобы избежать правовых, финансовых и репутационных рисков, оценённых в нашем внутреннем анализе рисков. Это относится ко всем клиентам. Решение о сотрудничестве мы принимаем только после проверки." },
        { kind: "paragraph", text: "При совпадении мы проверяем случай вручную; решения принимают только сотрудники, а не автоматическое сравнение. При подтверждённом совпадении мы не сотрудничаем с соответствующим лицом или организацией и не принимаем от них платежи. Если в исключительных случаях закон обяжет нас, мы уведомим компетентные органы. Если совпадение возникло по ошибке (например, из-за одинакового имени), пожалуйста, сообщите нам об этом. Результат проверки мы храним в соответствии с разделом 9. Вы можете возразить против этой проверки (раздел 12)." },
      ],
    },
    {
      number: 6,
      title: "Получатели и обработчики по поручению",
      blocks: [
        { kind: "paragraph", text: "Мы обрабатываем Ваши данные в нашей системе управления клиентами GMED-EDV-System." },
        { kind: "paragraph", lead: "Обработчики по поручению (ст. 28 DSGVO), действующие по нашим указаниям:", text: "" },
        { kind: "list", items: [
          { text: "Хостинг: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen. Наши серверы находятся исключительно в центрах обработки данных в Германии. С провайдером заключён договор об обработке данных по поручению." },
          { text: "Электронная (квалифицированная) подпись: Skribble AG, Talacker 21, 8001 Цюрих, Швейцария. Швейцария (третья страна, см. раздел 7). С поставщиком заключён договор об обработке данных по поручению." },
        ] },
        { kind: "paragraph", lead: "Другие получатели:", text: "" },
        { kind: "list", items: [
          { text: "наши сотрудники, которым данные необходимы для обработки Вашего запроса," },
          { text: "переводчики, участвующие в обработке Вашего запроса," },
          { text: "только при онлайн-запросе FiSaLis: Немецкий федеральный банк (поисковые данные санкционной проверки)," },
          { text: "органы власти, если мы обязаны по закону сообщить о данных." },
        ] },
        { kind: "paragraph", text: "Передача клиникам, врачам и другим медицинским учреждениям осуществляется только в рамках сотрудничества. Об этом мы проинформируем Вас отдельно." },
      ],
    },
    {
      number: 7,
      title: "Передача данных в третьи страны",
      blocks: [
        { kind: "paragraph", text: "Данные из формы мы обрабатываем в Германии и, для электронной подписи Вашего согласия, в Швейцарии. Для этого мы привлекаем обработчика по поручению в Швейцарии (Skribble AG, см. раздел 6), которому передаются необходимые данные. Для Швейцарии действует решение Европейской комиссии об адекватном уровне защиты данных (ст. 45 DSGVO), поэтому дополнительные гарантии не требуются. Если в рамках сотрудничества потребуется передача в третьи страны (например, клиникам за пределами ЕС/ЕЭП), мы заранее проинформируем Вас отдельно и получим Ваше явное согласие." },
      ],
    },
    {
      number: 8,
      title: "Данные третьих лиц и несовершеннолетние",
      blocks: [
        { kind: "paragraph", text: "Если Вы сообщаете нам данные других лиц или организаций (в том числе в форме), пожалуйста, убедитесь, что Вы уполномочены на это, и проинформируйте их об этой политике конфиденциальности. Их данные также проверяются в рамках санкционной проверки (раздел 5). Сведения о здоровье других лиц (например, родственников) Вы можете указывать только при наличии их согласия или полномочий представлять их. В отношении несовершеннолетних согласие дают законные представители." },
      ],
    },
    {
      number: 9,
      title: "Срок хранения",
      blocks: [
        { kind: "paragraph", text: "Мы храним персональные данные только столько, сколько это необходимо для указанных целей. После этого мы удаляем их, за исключением случаев, когда действуют установленные законом обязанности по хранению (тогда мы храним данные до истечения соответствующего срока) или когда данные по-прежнему нужны нам для предъявления, осуществления или защиты правовых требований (ст. 6 абз. 1 лит. f DSGVO, для данных о здоровье ст. 9 абз. 2 лит. f DSGVO). Если к данным применяется несколько сроков хранения, действует самый длительный. В частности:" },
        { kind: "list", items: [
          { text: "запросы без заключения договора: 14 дней после отправки." },
          { text: "согласие подписано, договор не заключён: 180 дней, чтобы Вы могли спокойно принять решение, а мы могли продолжить уже начатую организацию (например, согласование с клиниками, выяснение вопроса о покрытии расходов) без повторного сбора данных. При отзыве согласия мы удаляем данные сразу, если нет обязанности хранения." },
          { text: "результаты санкционной проверки: без заключения договора вместе с запросом через 14 дней или через 180 дней при подписанном согласии; при подтверждённом совпадении через 3 года, чтобы мы могли доказать причину отказа и защититься от правовых требований." },
          { text: "подтверждение Вашего согласия: 3 года после истечения соответствующего срока, чтобы мы могли его подтвердить (ст. 7 абз. 1 DSGVO)." },
          { text: "при заключении договора Ваши данные переходят в договорные отношения. Дальнейшие сроки хранения, включая хранение счетов, договоров и результатов проверки, мы укажем в политике конфиденциальности при сотрудничестве." },
        ] },
      ],
    },
    {
      number: 10,
      title: "Безопасность данных",
      blocks: [
        { kind: "paragraph", text: "Мы защищаем Ваши данные соответствующими техническими и организационными мерами (ст. 32 DSGVO). К ним относятся, в частности, шифрование при передаче (TLS), шифрование хранимых данных, ограничение доступа кругом уполномоченных сотрудников по принципу «только то, что необходимо»." },
      ],
    },
    {
      number: 11,
      title: "Ваши права",
      blocks: [
        { kind: "paragraph", text: "Вы вправе получить доступ к данным, включая копию Ваших данных (ст. 15), требовать исправления (ст. 16), удаления (ст. 17), ограничения обработки (ст. 18) и переноса данных (ст. 20 DSGVO)." },
        { kind: "paragraph", text: "Вы можете в любое время отозвать данное Вами согласие с действием на будущее; законность обработки, проведённой до отзыва, остаётся неизменной. Отозвать согласие так же просто, как дать его: письменно по контактам из раздела 1." },
        { kind: "paragraph", text: "Мы отвечаем в течение одного месяца и бесплатно. Для защиты Ваших данных мы можем потребовать подтверждение Вашей личности." },
      ],
    },
    {
      number: 12,
      title: "Право на возражение",
      blocks: [
        { kind: "paragraph", lead: "Право на возражение (ст. 21 DSGVO):", text: "Вы вправе в любой момент возразить против обработки Ваших данных, основанной на нашем законном интересе (в частности, против санкционной проверки), по причинам, связанным с Вашей особой ситуацией. После этого мы прекращаем обработку, если только не докажем наличие убедительных законных оснований, которые преобладают над Вашими интересами, правами и свободами, либо обработка служит для предъявления, осуществления или защиты правовых требований. Без санкционной проверки мы в соответствии с нашими внутренними требованиями комплаенса не можем предлагать сотрудничество и принимать платежи." },
      ],
    },
    {
      number: 13,
      title: "Право на жалобу",
      blocks: [
        { kind: "paragraph", text: "Вы вправе подать жалобу в надзорный орган по защите данных, в частности в государстве-члене ЕС по месту Вашего проживания, работы или предполагаемого нарушения (ст. 77 DSGVO)." },
        { kind: "paragraph", text: "Мы будем рады, если Вы сначала сообщите нам о Вашем обращении (например, по e-mail datenschutz@gmed-health.com), чтобы мы могли всё выяснить. Это не ограничивает Ваше право в любой момент обратиться непосредственно в надзорный орган." },
      ],
    },
    {
      number: 14,
      title: "Актуальность и изменения",
      blocks: [
        { kind: "paragraph", text: "Дата: 12.10.2026. Мы изменяем настоящую политику конфиденциальности, если меняется наша обработка данных." },
      ],
    },
  ],
  // Machine-drafted translation of the German text, section by section (owner 2026-11-10); not reviewed by a lawyer.
  en: [
    {
      number: 1,
      title: "Controller and data protection officer",
      blocks: [
        { kind: "address", lines: ["GMED - Agentur für Patientenbetreuung,", "Heorhii Hudiiev, Albert-Schweitzer-Straße 56", "81735 München", "Germany", "E-mail: contact@gmed-health.com,", "Telephone: +49 151 20943768"] },
        { kind: "paragraph", text: "The controller responsible for the processing of your data is Heorhii Hudiiev, Albert-Schweitzer-Straße 56, 81735 München, Germany, e-mail: datenschutz@gmed-health.com." },
        { kind: "paragraph", text: "This privacy notice applies to our client questionnaire (questionnaire form) and to the handling of your enquiry. If we work together and conclude a contract, we will inform you separately about the data processing in the course of the cooperation. For our website, www.gmed-health.com/legal applies." },
      ],
    },
    {
      number: 2,
      title: "Which data we process in the form",
      blocks: [
        { kind: "paragraph", text: "We process:" },
        { kind: "list", items: [
          { text: "contact and identification data (e.g. name, date of birth, nationality, address, e-mail, telephone)," },
          { text: "details of payment and invoicing (e.g. method of payment, invoice recipient, paying person, insurance status)," },
          { text: "details of other persons or organisations that you name in the form (e.g. relatives, paying person)," },
          { text: "health data including medical data, e.g. diagnoses, complaints, medical history (special category under Art. 9 GDPR)," },
          { text: "communication data (e.g. e-mails and messages)," },
          { text: "results of the sanctions screening (see section 5)." },
        ] },
        { kind: "paragraph", text: "We receive the data from you and from the persons you name in the form." },
        { kind: "paragraph", text: "We process personal data and health data of patients, relatives and prospective clients solely in order to arrange, organise and invoice medical examinations and treatments, and in order to provide, arrange, organise and invoice non-medical services. We do not provide medical services ourselves, but organisational and administrative services, including interpreting." },
      ],
    },
    {
      number: 3,
      title: "Purposes and legal bases",
      blocks: [
        { kind: "list", items: [
          { lead: "Handling your enquiry, examining and preparing a cooperation, communicating with you:", text: "Art. 6(1)(b) GDPR (pre-contractual measures at your request)." },
          { lead: "Processing of health information in the form:", text: "your explicit consent, Art. 9(2)(a) GDPR." },
          { lead: "Sanctions screening:", text: "Art. 6(1)(f) GDPR (legitimate interest, see section 5)." },
          { lead: "Evidence and defence against legal claims:", text: "Art. 6(1)(f) GDPR and, where health data are concerned, Art. 9(2)(f) GDPR." },
          { lead: "Evidence of consents given:", text: "Art. 6(1)(c) GDPR in conjunction with Art. 7(1) GDPR." },
        ] },
      ],
    },
    {
      number: 4,
      title: "Mandatory information, voluntariness and automated decisions",
      blocks: [
        { kind: "paragraph", text: "Mandatory fields are marked in the form. Without the mandatory information (contact and identification data, details of the invoice recipient and the paying person) we cannot handle your enquiry and cannot offer a cooperation. All other information is voluntary." },
        { kind: "paragraph", text: "Your consent to the processing of your health information is voluntary. If you do not give it or if you withdraw it, we unfortunately cannot arrange the treatment in so far as medical data are required for this. You will not suffer any further disadvantages. On withdrawal, see section 11. We will inform you separately about the passing on of documents to clinics, doctors and other medical service providers in the course of the cooperation." },
        { kind: "paragraph", text: "We do not take automated individual decisions, including profiling (Art. 22 GDPR). In the sanctions screening, too, decisions are taken by members of staff." },
      ],
    },
    {
      number: 5,
      title: "Sanctions screening (compliance check)",
      blocks: [
        { kind: "paragraph", text: "After the form has been sent and before a cooperation begins, we check your data and the data of the persons and organisations that you yourself state in the form (e.g. the paying person) against the financial sanctions lists of the EU and Germany. For this we use the financial sanctions list of the Deutsche Bundesbank (FiSaLis). Only identification data are used (name, date of birth, nationality, address), no health data or other medical data. Clinics, doctors and other service providers are not checked. For later payments we also check the name of the account holder of incoming payments. We inform you about this in the privacy notice for the cooperation." },
        { kind: "paragraph", text: "The legal basis is our legitimate interest (Art. 6(1)(f) GDPR): we do not wish to accept payments (e.g. bank transfers or cash payments) from sanctioned persons or organisations or to work with them, in order to avoid legal, financial and reputational risks that we have assessed in our internal risk analysis. This applies to all clients. We decide on a cooperation only after the screening." },
        { kind: "paragraph", text: "In the event of a match we examine the case manually; decisions are taken only by members of staff, never by an automated comparison alone. In the event of a confirmed match we do not work with the person or organisation concerned and do not accept payments from them. Should we be legally obliged to do so in exceptional cases, we inform the competent authorities. If a match is based on an error (e.g. identical names), please let us know. We store the result of the check in accordance with section 9. You may object to this check (section 12)." },
      ],
    },
    {
      number: 6,
      title: "Recipients and processors",
      blocks: [
        { kind: "paragraph", text: "We process your data in our client management system, the GMED IT system (GMED-EDV-System)." },
        { kind: "paragraph", lead: "Processors (Art. 28 GDPR) who work on our instructions:", text: "" },
        { kind: "list", items: [
          { text: "Hosting: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany. Our servers are located exclusively in data centres in Germany. A data processing agreement is in place with the provider." },
          { text: "Electronic (qualified) signature: Skribble AG, Talacker 21, 8001 Zürich, Switzerland. A data processing agreement is in place with the provider." },
        ] },
        { kind: "paragraph", lead: "Other recipients:", text: "" },
        { kind: "list", items: [
          { text: "our members of staff, in so far as they need the data to handle your enquiry," },
          { text: "interpreters, in so far as they are involved in handling your enquiry," },
          { text: "only when FiSaLis is queried online: Deutsche Bundesbank (search terms of the sanctions screening)," },
          { text: "authorities, in so far as we are legally obliged to report." },
        ] },
        { kind: "paragraph", text: "Data are passed on to clinics, doctors and other medical service providers only in the course of the cooperation. We will inform you about this separately." },
      ],
    },
    {
      number: 7,
      title: "Transfers to third countries",
      blocks: [
        { kind: "paragraph", text: "We process the data from the form in Germany and, for the electronic signature of your consent, in Switzerland. For this we use a processor in Switzerland (Skribble AG, see section 6), to which the data required for this purpose are transferred. For Switzerland the European Commission has determined an adequate level of data protection (Art. 45 GDPR); further safeguards are therefore not required. If transfers to third countries become necessary in the course of the cooperation (e.g. to clinics outside the EU/EEA), we will inform you separately beforehand and obtain your explicit consent." },
      ],
    },
    {
      number: 8,
      title: "Data of third parties and minors",
      blocks: [
        { kind: "paragraph", text: "If you give us data of other persons or organisations (including in the form), please make sure that you are authorised to do so and inform them of this privacy notice. Their data are also checked in the sanctions screening (section 5). You may give health information about other persons (e.g. about relatives) only if they have consented or if you are authorised to represent them. In the case of minors, the persons with parental responsibility give the consent." },
      ],
    },
    {
      number: 9,
      title: "Storage period",
      blocks: [
        { kind: "paragraph", text: "We store personal data only for as long as is necessary for the purposes stated. After that we erase them, unless statutory retention obligations apply (in which case we store them until the respective period has expired) or we continue to need them for the establishment, exercise or defence of legal claims (Art. 6(1)(f) GDPR, for health data Art. 9(2)(f) GDPR). If data are subject to several retention periods, the longest applies. In detail:" },
        { kind: "list", items: [
          { text: "Enquiries without a contract: 14 days after sending." },
          { text: "Consent signed, but no contract: 180 days, so that you can take your decision without haste and we can continue the planning already begun (e.g. coordination with clinics, clarification of the assumption of costs) without collecting the data again. If the consent is withdrawn we erase immediately, in so far as no retention obligation applies." },
          { text: "Results of the sanctions screening: without the conclusion of a contract, together with the enquiry after 14 days, or after 180 days where the consent has been signed; in the event of a confirmed match after 3 years, so that we can prove the refusal and defend ourselves against legal claims." },
          { text: "Evidence of your consent: 3 years after the respective period has expired, so that we can prove it (Art. 7(1) GDPR)." },
          { text: "When a contract is concluded, your data pass into the contractual relationship. We state the further storage periods, including the retention of invoices, contracts and screening results, in the privacy notice for the cooperation." },
        ] },
      ],
    },
    {
      number: 10,
      title: "Data security",
      blocks: [
        { kind: "paragraph", text: "We protect your data by appropriate technical and organisational measures (Art. 32 GDPR). These include in particular encryption in transit (TLS), encryption of stored data, and the restriction of access to authorised members of staff according to the principle “only what is necessary”." },
      ],
    },
    {
      number: 11,
      title: "Your rights",
      blocks: [
        { kind: "paragraph", text: "You have the right of access, including a copy of your data (Art. 15), to rectification (Art. 16), to erasure (Art. 17), to restriction of processing (Art. 18) and to data portability (Art. 20 GDPR)." },
        { kind: "paragraph", text: "You may withdraw a consent you have given at any time with effect for the future; the processing carried out until then remains lawful. Withdrawing is as easy as giving consent: in writing, using the contact details in section 1." },
        { kind: "paragraph", text: "We reply within one month and free of charge. To protect your data we may ask for proof of your identity." },
      ],
    },
    {
      number: 12,
      title: "Right to object",
      blocks: [
        { kind: "paragraph", lead: "Right to object (Art. 21 GDPR):", text: "You may object at any time, on grounds relating to your particular situation, to the processing of your data that is based on our legitimate interest (in particular the sanctions screening). We will then no longer process the data, unless we can demonstrate compelling legitimate grounds which override your interests, rights and freedoms, or the processing serves the establishment, exercise or defence of legal claims. Without sanctions screening we cannot, under our internal compliance requirements, offer a cooperation or accept payments." },
      ],
    },
    {
      number: 13,
      title: "Right to lodge a complaint",
      blocks: [
        { kind: "paragraph", text: "You have the right to lodge a complaint with a data protection supervisory authority, in particular in the EU Member State of your habitual residence, your place of work or the place of the alleged infringement (Art. 77 GDPR)." },
        { kind: "paragraph", text: "We would be glad if you first described your concern to us (e.g. by e-mail to datenschutz@gmed-health.com), so that we can resolve it. Your right to contact a supervisory authority directly at any time remains unaffected." },
      ],
    },
    {
      number: 14,
      title: "Version and changes",
      blocks: [
        { kind: "paragraph", text: "Version: 12.10.2026. We adapt this privacy notice when our processing changes." },
      ],
    },
  ],
  // Machine-drafted translation of the German text, section by section (owner 2026-11-10); not reviewed by a lawyer.
  uk: [
    {
      number: 1,
      title: "Відповідальна особа (контролер) та уповноважений із захисту даних",
      blocks: [
        { kind: "address", lines: ["GMED - Agentur für Patientenbetreuung,", "Heorhii Hudiiev, Albert-Schweitzer-Straße 56", "81735 München", "Німеччина", "Ел. пошта: contact@gmed-health.com,", "Телефон: +49 151 20943768"] },
        { kind: "paragraph", text: "Відповідальним за обробку Ваших даних є Heorhii Hudiiev, Albert-Schweitzer-Straße 56, 81735 München, Німеччина, e-mail: datenschutz@gmed-health.com." },
        { kind: "paragraph", text: "Ця декларація про захист даних стосується нашого опитування клієнтів (анкети) та опрацювання Вашого запиту. Якщо ми співпрацюватимемо й укладемо договір, ми окремо поінформуємо Вас про обробку даних під час співпраці. Для нашого вебсайту діє www.gmed-health.com/legal." },
      ],
    },
    {
      number: 2,
      title: "Які дані ми обробляємо у формі",
      blocks: [
        { kind: "paragraph", text: "Ми обробляємо:" },
        { kind: "list", items: [
          { text: "контактні та ідентифікаційні дані (наприклад, ім’я, дата народження, громадянство, адреса, електронна пошта, телефон)," },
          { text: "відомості про оплату та розрахунки (наприклад, спосіб оплати, отримувач рахунку, особа, яка платить, статус страхування)," },
          { text: "відомості про інших осіб або організації, яких Ви зазначаєте у формі (наприклад, близькі, особа, яка платить)," },
          { text: "дані про стан здоров’я, включно з медичними даними, наприклад діагнози, скарги, анамнез (особлива категорія згідно зі ст. 9 GDPR (Загальний регламент про захист даних))," },
          { text: "дані комунікації (наприклад, електронні листи та повідомлення)," },
          { text: "результати санкційної перевірки (див. розділ 5)." },
        ] },
        { kind: "paragraph", text: "Дані ми отримуємо від Вас та від осіб, яких Ви зазначаєте у формі." },
        { kind: "paragraph", text: "Ми обробляємо персональні дані та дані про стан здоров’я пацієнток, пацієнтів, близьких і зацікавлених осіб виключно для того, щоб бути посередником у проведенні медичних обстежень і лікування, організовувати їх та проводити за них розрахунки, а також для того, щоб надавати немедичні послуги, бути посередником у їх наданні, організовувати їх та проводити за них розрахунки. Ми самі не надаємо медичних послуг, а надаємо організаційні та адміністративні послуги, включно з усним перекладом." },
      ],
    },
    {
      number: 3,
      title: "Цілі та правові підстави",
      blocks: [
        { kind: "list", items: [
          { lead: "Опрацювання Вашого запиту, перевірка та підготовка співпраці, спілкування з Вами:", text: "ст. 6 абз. 1 літ. b GDPR (переддоговірні заходи за Вашим запитом)." },
          { lead: "Обробка відомостей про стан здоров’я у формі:", text: "Ваша явна згода, ст. 9 абз. 2 літ. a GDPR." },
          { lead: "Санкційна перевірка:", text: "ст. 6 абз. 1 літ. f GDPR (законний інтерес, див. розділ 5)." },
          { lead: "Підтвердження та захист від правових вимог:", text: "ст. 6 абз. 1 літ. f GDPR, а якщо йдеться про дані про стан здоров’я, ст. 9 абз. 2 літ. f GDPR." },
          { lead: "Підтвердження наданих згод:", text: "ст. 6 абз. 1 літ. c GDPR у поєднанні зі ст. 7 абз. 1 GDPR." },
        ] },
      ],
    },
    {
      number: 4,
      title: "Обов’язкові відомості, добровільність та автоматизовані рішення",
      blocks: [
        { kind: "paragraph", text: "Обов’язкові поля позначено у формі. Без обов’язкових відомостей (контактні та ідентифікаційні дані, відомості про отримувача рахунку та особу, яка платить) ми не можемо опрацювати Ваш запит і запропонувати співпрацю. Усі інші відомості є добровільними." },
        { kind: "paragraph", text: "Ваша згода на обробку Ваших відомостей про стан здоров’я є добровільною. Якщо Ви її не надасте або відкличете, ми, на жаль, не зможемо організувати лікування, якщо для цього потрібні медичні дані. Інших несприятливих наслідків для Вас не буде. Про відкликання див. розділ 11. Про передання документів клінікам, лікаркам і лікарям та іншим надавачам медичних послуг у межах співпраці ми поінформуємо Вас окремо." },
        { kind: "paragraph", text: "Автоматизованого індивідуального ухвалення рішень, включно з профілюванням (ст. 22 GDPR), ми не застосовуємо. Під час санкційної перевірки рішення також ухвалюють працівники." },
      ],
    },
    {
      number: 5,
      title: "Санкційна перевірка (перевірка на відповідність вимогам)",
      blocks: [
        { kind: "paragraph", text: "Після надсилання форми та до початку співпраці ми звіряємо Ваші дані, а також дані осіб і організацій, яких Ви самі зазначаєте у формі (наприклад, особи, яка платить), зі списками фінансових санкцій ЄС та Німеччини. Для цього ми використовуємо список фінансових санкцій Німецького федерального банку (FiSaLis). Використовуються лише ідентифікаційні дані (ім’я, дата народження, громадянство, адреса), без даних про стан здоров’я чи інших медичних даних. Клініки, лікарки й лікарі та інші надавачі послуг не перевіряються. Під час подальших платежів ми також перевіряємо ім’я власника рахунку, з якого надходить платіж. Про це ми інформуємо Вас у декларації про захист даних щодо співпраці." },
        { kind: "paragraph", text: "Правовою підставою є наш законний інтерес (ст. 6 абз. 1 літ. f GDPR): ми не хочемо приймати платежі (наприклад, банківські перекази чи готівкові платежі) від осіб або організацій, щодо яких застосовано санкції, і не хочемо з ними співпрацювати, щоб уникнути правових, фінансових і репутаційних ризиків, які ми оцінили у своєму внутрішньому аналізі ризиків. Це стосується всіх клієнток і клієнтів. Рішення про співпрацю ми ухвалюємо лише після перевірки." },
        { kind: "paragraph", text: "У разі збігу ми перевіряємо випадок вручну; рішення ухвалюють лише працівники, ніколи лише автоматизоване звіряння. У разі підтвердженого збігу ми не співпрацюємо з відповідною особою чи організацією і не приймаємо від неї платежів. Якщо у виняткових випадках ми будемо зобов’язані до цього законом, ми поінформуємо компетентні органи. Якщо збіг ґрунтується на помилці (наприклад, однакове ім’я), будь ласка, повідомте нам про це. Результат перевірки ми зберігаємо відповідно до розділу 9. Ви можете заперечити проти цієї перевірки (розділ 12)." },
      ],
    },
    {
      number: 6,
      title: "Одержувачі та оператори (обробники за дорученням)",
      blocks: [
        { kind: "paragraph", text: "Ми обробляємо Ваші дані в нашій системі управління клієнтами — ІТ-системі GMED (GMED-EDV-System)." },
        { kind: "paragraph", lead: "Оператори (обробники за дорученням, ст. 28 GDPR), які працюють за нашими вказівками:", text: "" },
        { kind: "list", items: [
          { text: "Хостинг: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Німеччина. Наші сервери розташовані виключно в центрах обробки даних у Німеччині. З постачальником укладено договір про обробку даних за дорученням." },
          { text: "Електронний (кваліфікований) підпис: Skribble AG, Talacker 21, 8001 Zürich, Швейцарія. З постачальником укладено договір про обробку даних за дорученням." },
        ] },
        { kind: "paragraph", lead: "Інші одержувачі:", text: "" },
        { kind: "list", items: [
          { text: "наші працівники, якщо дані потрібні їм для опрацювання Вашого запиту," },
          { text: "усні перекладачки та перекладачі, якщо вони беруть участь в опрацюванні Вашого запиту," },
          { text: "лише в разі онлайн-запиту до FiSaLis: Німецький федеральний банк (пошукові дані санкційної перевірки)," },
          { text: "органи влади, якщо ми за законом зобов’язані подати повідомлення." },
        ] },
        { kind: "paragraph", text: "Передання клінікам, лікаркам і лікарям та іншим надавачам медичних послуг відбувається лише в межах співпраці. Про це ми поінформуємо Вас окремо." },
      ],
    },
    {
      number: 7,
      title: "Передання до третіх країн",
      blocks: [
        { kind: "paragraph", text: "Дані з форми ми обробляємо в Німеччині та, для електронного підпису Вашої згоди, у Швейцарії. Для цього ми залучаємо оператора (обробника за дорученням) у Швейцарії (Skribble AG, див. розділ 6), якому передаються потрібні для цього дані. Щодо Швейцарії Європейська комісія встановила належний рівень захисту даних (ст. 45 GDPR), тому додаткові гарантії не потрібні. Якщо в межах співпраці знадобиться передання до третіх країн (наприклад, клінікам за межами ЄС/ЄЕП), ми заздалегідь окремо поінформуємо Вас і отримаємо Вашу явну згоду." },
      ],
    },
    {
      number: 8,
      title: "Дані третіх осіб і неповнолітні",
      blocks: [
        { kind: "paragraph", text: "Якщо Ви повідомляєте нам дані інших осіб або організацій (зокрема у формі), будь ласка, переконайтеся, що Ви маєте на це право, і поінформуйте їх про цю декларацію про захист даних. Їхні дані також перевіряються під час санкційної перевірки (розділ 5). Відомості про стан здоров’я інших осіб (наприклад, близьких) Ви можете надавати лише тоді, коли вони дали згоду або коли Ви маєте право їх представляти. Щодо неповнолітніх згоду дають особи, які мають право опіки над дитиною." },
      ],
    },
    {
      number: 9,
      title: "Строк зберігання",
      blocks: [
        { kind: "paragraph", text: "Ми зберігаємо персональні дані лише стільки, скільки це потрібно для зазначених цілей. Після цього ми їх видаляємо, крім випадків, коли існують установлені законом обов’язки зберігання (тоді ми зберігаємо їх до закінчення відповідного строку) або коли вони й надалі потрібні нам для пред’явлення, здійснення чи захисту правових вимог (ст. 6 абз. 1 літ. f GDPR, для даних про стан здоров’я ст. 9 абз. 2 літ. f GDPR). Якщо на дані поширюються кілька строків зберігання, діє найдовший. Зокрема:" },
        { kind: "list", items: [
          { text: "Запити без договору: 14 днів після надсилання." },
          { text: "Згоду підписано, але договору немає: 180 днів, щоб Ви могли спокійно ухвалити рішення, а ми могли продовжити вже розпочате планування (наприклад, узгодження з клініками, з’ясування питання про покриття витрат) без повторного збирання даних. У разі відкликання згоди ми видаляємо дані негайно, якщо немає обов’язку зберігання." },
          { text: "Результати санкційної перевірки: без укладення договору разом із запитом через 14 днів або через 180 днів у разі підписаної згоди; у разі підтвердженого збігу через 3 роки, щоб ми могли довести відмову та захиститися від правових вимог." },
          { text: "Підтвердження Вашої згоди: 3 роки після закінчення відповідного строку, щоб ми могли її підтвердити (ст. 7 абз. 1 GDPR)." },
          { text: "У разі укладення договору Ваші дані переходять у договірні відносини. Подальші строки зберігання, включно зі зберіганням рахунків, договорів і результатів перевірки, ми зазначаємо в декларації про захист даних щодо співпраці." },
        ] },
      ],
    },
    {
      number: 10,
      title: "Безпека даних",
      blocks: [
        { kind: "paragraph", text: "Ми захищаємо Ваші дані належними технічними та організаційними заходами (ст. 32 GDPR). До них належать, зокрема, шифрування під час передавання (TLS), шифрування збережених даних, обмеження доступу колом уповноважених працівників за принципом «лише те, що потрібно»." },
      ],
    },
    {
      number: 11,
      title: "Ваші права",
      blocks: [
        { kind: "paragraph", text: "Ви маєте право на доступ, включно з копією Ваших даних (ст. 15), на виправлення (ст. 16), видалення (ст. 17), обмеження обробки (ст. 18) та перенесення даних (ст. 20 GDPR)." },
        { kind: "paragraph", text: "Ви можете в будь-який час відкликати надану згоду з дією на майбутнє; обробка, здійснена до того часу, залишається законною. Відкликати згоду так само просто, як і надати: письмово за контактними даними з розділу 1." },
        { kind: "paragraph", text: "Ми відповідаємо протягом одного місяця і безоплатно. Для захисту Ваших даних ми можемо вимагати підтвердження Вашої особи." },
      ],
    },
    {
      number: 12,
      title: "Право на заперечення",
      blocks: [
        { kind: "paragraph", lead: "Право на заперечення (ст. 21 GDPR):", text: "Ви можете в будь-який час заперечити проти обробки Ваших даних, яка ґрунтується на нашому законному інтересі (зокрема проти санкційної перевірки), з причин, що випливають із Вашої особливої ситуації. Тоді ми більше не обробляємо дані, крім випадків, коли ми можемо довести наявність переконливих законних підстав, які переважають Ваші інтереси, права і свободи, або коли обробка слугує пред’явленню, здійсненню чи захисту правових вимог. Без санкційної перевірки ми відповідно до наших внутрішніх вимог комплаєнсу не можемо запропонувати співпрацю і приймати платежі." },
      ],
    },
    {
      number: 13,
      title: "Право на скаргу",
      blocks: [
        { kind: "paragraph", text: "Ви маєте право подати скаргу до наглядового органу із захисту даних, зокрема в державі-члені ЄС за місцем Вашого перебування, Вашої роботи або ймовірного порушення (ст. 77 GDPR)." },
        { kind: "paragraph", text: "Ми будемо раді, якщо Ви спочатку опишете нам суть Вашого звернення (наприклад, електронною поштою на datenschutz@gmed-health.com), щоб ми могли його з’ясувати. Ваше право в будь-який час звернутися безпосередньо до наглядового органу це не обмежує." },
      ],
    },
    {
      number: 14,
      title: "Редакція та зміни",
      blocks: [
        { kind: "paragraph", text: "Редакція: 12.10.2026. Ми змінюємо цю декларацію про захист даних, якщо змінюються наші процеси обробки." },
      ],
    },
  ],
};

/**
 * The sentence above a translation that the owner asked for without a supplied document
 * (2026-11-10): the translation is a convenience, the German text counts.
 */
export const FORM_PRIVACY_TRANSLATION_NOTE: Partial<Record<FormPrivacyLanguage, string>> = {
  en: "This translation is provided for your convenience only. The German version is the authoritative one.",
  uk: "Цей переклад надано лише для Вашої зручності. Юридично обов’язковою є версія німецькою мовою.",
};
