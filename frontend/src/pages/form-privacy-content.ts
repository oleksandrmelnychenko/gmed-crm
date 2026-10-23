/** Datenschutzerklärung Formular GMED as supplied on 2026-10-12: the German original and its Russian version,
 * shown word for word (owner 2026-10-14: what is in the Word document is what the page shows). `lead` is the
 * bold beginning of a paragraph or item; section 1 opens with the controller's address lines as written.
 * The German text is authoritative and shown for every other language.
 */
export type FormPrivacyText = { lead?: string; text: string };
export type FormPrivacyBlock =
  | ({ kind: "paragraph" } & FormPrivacyText)
  | { kind: "list"; items: readonly FormPrivacyText[] }
  | { kind: "address"; lines: readonly string[] };
export type FormPrivacySection = { number: number; title: string; blocks: readonly FormPrivacyBlock[] };

export type FormPrivacyLanguage = "de" | "ru";

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
};
