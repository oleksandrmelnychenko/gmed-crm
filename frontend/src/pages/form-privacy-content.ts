/** Form privacy notice supplied by GMED on 2026-10-12 (DE original, with RU, EN and UK translations).
 * Contact details are rendered from the agency settings. Lists preserve the reference's OOXML numbering.
 * The reference's unresolved website-policy link is omitted.
 */
export type FormPrivacyBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: readonly string[] };
export type FormPrivacySection = { number: number; title: string; blocks: readonly FormPrivacyBlock[] };

export type FormPrivacyLanguage = "de" | "en" | "uk" | "ru";

export const FORM_PRIVACY_VERSION = "2026-10-13";

export const FORM_PRIVACY_SECTIONS: Record<FormPrivacyLanguage, readonly FormPrivacySection[]> = {
  "de": [
    {
      "number": 1,
      "title": "Verantwortlicher und Datenschutzbeauftragter",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Diese Datenschutzerklärung gilt für unsere Kundenbefragung (Befragungsformular) und die Bearbeitung Ihrer Anfrage. Wenn wir zusammenarbeiten und einen Vertrag schließen, informieren wir Sie gesondert über die Datenverarbeitung bei der Zusammenarbeit."
        }
      ]
    },
    {
      "number": 2,
      "title": "Welche Daten wir im Formular verarbeiten",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Wir verarbeiten:"
        },
        {
          "kind": "list",
          "items": [
            "Kontakt- und Identifikationsdaten (z. B. Name, Geburtsdatum, Staatsangehörigkeit, Anschrift, E-Mail, Telefon),",
            "Angaben zur Zahlung und Abrechnung (z. B. Zahlungsweise, Rechnungsempfänger, zahlende Person, Versicherungsstatus),",
            "Angaben zu weiteren Personen oder Organisationen, die Sie im Formular benennen (z. B. Angehörige, zahlende Person),",
            "Gesundheitsdaten einschließlich medizinischer Daten, z. B. Diagnosen, Beschwerden, Anamnese (besondere Kategorie nach Art. 9 DSGVO),",
            "Kommunikationsdaten (z. B. E-Mails und Nachrichten),",
            "Ergebnisse des Sanktionsscreenings (siehe Abschnitt 5)."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Die Daten erhalten wir von Ihnen und von den Personen, die Sie im Formular benennen."
        },
        {
          "kind": "paragraph",
          "text": "Wir verarbeiten personenbezogene Daten und Gesundheitsdaten von Patientinnen, Patienten, Angehörigen und Interessenten ausschließlich, um medizinische Untersuchungen und  Behandlungen zu vermitteln, zu organisieren und abzurechnen, sowie um nicht-medizinische Leistungen zu erbringen, zu vermitteln, zu organisieren und abzurechnen. Wir erbringen keine medizinischen Leistungen selbst, sondern organisatorische und verwaltungsbezogene Leistungen einschließlich Dolmetschen."
        }
      ]
    },
    {
      "number": 3,
      "title": "Zwecke und Rechtsgrundlagen",
      "blocks": [
        {
          "kind": "list",
          "items": [
            "Bearbeitung Ihrer Anfrage, Prüfung und Vorbereitung einer Zusammenarbeit, Kommunikation mit Ihnen: Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahmen auf Ihre Anfrage).",
            "Verarbeitung von Gesundheitsangaben im Formular: Ihre ausdrückliche Einwilligung, Art. 9 Abs. 2 lit. a DSGVO.",
            "Sanktionsscreening: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse, siehe Abschnitt 5).",
            "Nachweis und Verteidigung gegen Rechtsansprüche: Art. 6 Abs. 1 lit. f DSGVO und, soweit Gesundheitsdaten betroffen sind, Art. 9 Abs. 2 lit. f DSGVO.",
            "Nachweis erteilter Einwilligungen: Art. 6 Abs. 1 lit. c DSGVO in Verbindung mit Art. 7 Abs. 1 DSGVO."
          ]
        }
      ]
    },
    {
      "number": 4,
      "title": "Pflichtangaben, Freiwilligkeit und automatisierte Entscheidungen",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Pflichtfelder sind im Formular gekennzeichnet. Ohne die Pflichtangaben (Kontakt- und Identifikationsdaten, Angaben zu Rechnungsempfänger und zahlender Person) können wir Ihre Anfrage nicht bearbeiten und keine Zusammenarbeit anbieten. Alle anderen Angaben sind freiwillig."
        },
        {
          "kind": "paragraph",
          "text": "Ihre Einwilligung zur Verarbeitung Ihrer Gesundheitsangaben ist freiwillig. Wenn Sie sie nicht erteilen oder widerrufen, können wir die Behandlung leider nicht vermitteln, soweit medizinische Daten dafür erforderlich sind. Weitere Nachteile entstehen Ihnen nicht. Zum Widerruf siehe Abschnitt 11. Über die Weitergabe von Unterlagen an Kliniken, Ärztinnen und Ärzte und andere medizinische Leistungserbringer im Rahmen der Zusammenarbeit informieren wir Sie gesondert."
        },
        {
          "kind": "paragraph",
          "text": "Automatisierte Entscheidungen im Einzelfall einschließlich Profiling (Art. 22 DSGVO) treffen wir nicht. Auch beim Sanktionsscreening entscheiden Mitarbeitende."
        }
      ]
    },
    {
      "number": 5,
      "title": "Sanktionsscreening (Compliance-Prüfung)",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Nach dem Absenden des Formulars und vor Beginn einer Zusammenarbeit gleichen wir die Identifikationsdaten der Patientin oder des Patienten, der zahlenden Person oder Organisation, der gesetzlichen Vertreterinnen und Vertreter einschließlich rechtlicher Betreuer, eines Rechnungsempfängers, der nicht selbst zahlt, und der für die Zahlung angegebenen Bank mit den Finanzsanktionslisten der EU und Deutschlands ab. Wir nutzen dafür die Finanzsanktionsliste der Deutschen Bundesbank (FiSaLis). Verwendet werden nur Identifikationsdaten (Name, Geburtsdatum, Staatsangehörigkeit, Anschrift), keine Gesundheits- oder sonstigen medizinischen Daten. Personen, die ausschließlich als Empfänger in der Einwilligung zur Datenübermittlung genannt werden, sowie Kliniken, Ärztinnen und Ärzte und sonstige Leistungserbringer werden nicht geprüft. Auch bei späteren Zahlungen prüfen wir den Namen des Kontoinhabers eingehender Zahlungen. Darüber informieren wir Sie in der Datenschutzerklärung zur Zusammenarbeit."
        },
        {
          "kind": "paragraph",
          "text": "Rechtsgrundlage ist unser berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO): Wir möchten keine Zahlungen (z. B. Überweisungen oder Barzahlungen) von sanktionierten Personen oder Organisationen annehmen und nicht mit ihnen zusammenarbeiten, um rechtliche, finanzielle und Reputationsrisiken zu vermeiden, die wir in unserer internen Risikoanalyse bewertet haben. Das gilt für alle Kundinnen und Kunden. Über die Zusammenarbeit entscheiden wir erst nach dem Screening."
        },
        {
          "kind": "paragraph",
          "text": "Bei einem Treffer prüfen wir den Fall manuell; Entscheidungen treffen nur Mitarbeitende, nie allein ein automatisierter Abgleich. Bei einem bestätigten Treffer arbeiten wir mit der betroffenen Person oder Organisation nicht zusammen und nehmen keine Zahlungen von ihr an. Sollten wir in Ausnahmefällen gesetzlich dazu verpflichtet sein, informieren wir zuständige Behörden. Beruht ein Treffer auf einem Irrtum (z. B. Namensgleichheit), teilen Sie uns das bitte mit. Das Prüfergebnis speichern wir gemäß Abschnitt 9. Sie können dieser Prüfung widersprechen (Abschnitt 12)."
        }
      ]
    },
    {
      "number": 6,
      "title": "Empfänger und Auftragsverarbeiter",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Wir verarbeiten Ihre Daten in unserem Kundenverwaltungssystem GMED-EDV-System."
        },
        {
          "kind": "paragraph",
          "text": "Auftragsverarbeiter (Art. 28 DSGVO), die nach unseren Weisungen arbeiten:"
        },
        {
          "kind": "list",
          "items": [
            "Hosting: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Deutschland. Unsere Server stehen ausschließlich in Rechenzentren in Deutschland. Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag.",
            "Elektronische (Qualifizierte) Signatur: Skribble AG, Talacker 21, 8001 Zürich, Schweiz. Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Weitere Empfänger:"
        },
        {
          "kind": "list",
          "items": [
            "unsere Mitarbeitenden, soweit sie die Daten für die Bearbeitung Ihrer Anfrage benötigen,",
            "Dolmetscherinnen und Dolmetscher, soweit sie an der Bearbeitung Ihrer Anfrage beteiligt sind,",
            "nur bei Online-Abfrage von FiSaLis: Deutsche Bundesbank (Suchbegriffe des Sanktionsscreenings),",
            "Behörden, soweit wir gesetzlich zur Meldung verpflichtet sind."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Eine Weitergabe an Kliniken, Ärztinnen und Ärzte und andere medizinische Leistungserbringer erfolgt erst im Rahmen der Zusammenarbeit. Darüber informieren wir Sie gesondert."
        }
      ]
    },
    {
      "number": 7,
      "title": "Übermittlung in Drittländer",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Die Daten aus dem Formular verarbeiten wir in Deutschland und, für die elektronische Signatur Ihrer Einwilligung, in der Schweiz. Dafür setzen wir einen Auftragsverarbeiter in der Schweiz ein (Skribble AG, siehe Abschnitt 6), an den die dafür erforderlichen Daten übermittelt werden. Für die Schweiz hat die EU-Kommission ein angemessenes Datenschutzniveau festgestellt (Art. 45 DSGVO), weitere Garantien sind deshalb nicht erforderlich. Wenn im Rahmen der Zusammenarbeit Übermittlungen in Drittländer nötig werden (z. B. an Kliniken außerhalb der EU/des EWR), informieren wir Sie vorher gesondert und holen Ihre ausdrückliche Einwilligung ein."
        }
      ]
    },
    {
      "number": 8,
      "title": "Daten Dritter und Minderjährige",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Wenn Sie uns Daten anderer Personen oder Organisationen mitteilen (auch im Formular), stellen Sie bitte sicher, dass Sie dazu befugt sind, und informieren Sie diese über diese Datenschutzerklärung. Eine Sanktionsprüfung erfolgt nur für die in Abschnitt 5 genannten Beteiligten. Personen, die ausschließlich als Empfänger in der Einwilligung zur Datenübermittlung genannt werden, werden nicht geprüft. Gesundheitsangaben zu anderen Personen (z. B. zu Angehörigen) dürfen Sie nur machen, wenn diese eingewilligt haben oder Sie zu ihrer Vertretung befugt sind. Bei Minderjährigen willigen die Sorgeberechtigten ein."
        }
      ]
    },
    {
      "number": 9,
      "title": "Speicherdauer",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Wir speichern personenbezogene Daten nur so lange, wie es für die genannten Zwecke erforderlich ist. Danach löschen wir sie, es sei denn, es bestehen gesetzliche Aufbewahrungspflichten (dann speichern wir sie bis zum Ablauf der jeweiligen Frist) oder wir benötigen sie weiterhin zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen (Art. 6 Abs. 1 lit. f DSGVO, bei Gesundheitsdaten Art. 9 Abs. 2 lit. f DSGVO). Unterliegen Daten mehreren Aufbewahrungsfristen, gilt die längste. Im Einzelnen:"
        },
        {
          "kind": "list",
          "items": [
            "Anfragen ohne Vertrag: 14 Tage nach Absendung.",
            "Einwilligung unterschrieben, aber kein Vertrag: 180 Tage, damit Sie sich in Ruhe entscheiden können und wir die bereits begonnene Planung (z. B. Abstimmung mit Kliniken, Klärung der Kostenübernahme) ohne erneute Datenerhebung fortsetzen können. Bei Widerruf der Einwilligung löschen wir sofort, soweit keine Aufbewahrungspflicht besteht.",
            "Ergebnisse des Sanktionsscreenings: ohne Vertragsschluss zusammen mit der Anfrage nach 14 Tagen bzw. nach 180 Tagen bei unterschriebener Einwilligung; bei bestätigtem Treffer nach 3 Jahren, damit wir die Ablehnung nachweisen und Rechtsansprüche abwehren können.",
            "Nachweis Ihrer Einwilligung: 3 Jahre nach Ablauf der jeweiligen Frist, damit wir sie nachweisen können (Art. 7 Abs. 1 DSGVO).",
            "Bei Vertragsschluss gehen Ihre Daten in das Vertragsverhältnis über. Die weiteren Speicherfristen, einschließlich der Aufbewahrung von Rechnungen, Verträgen und Screening-Ergebnissen, nennen wir Ihnen in der Datenschutzerklärung zur Zusammenarbeit."
          ]
        }
      ]
    },
    {
      "number": 10,
      "title": "Datensicherheit",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Wir schützen Ihre Daten durch angemessene technische und organisatorische Maßnahmen (Art. 32 DSGVO). Dazu gehören insbesondere die Verschlüsselung bei der Übertragung (TLS), die Verschlüsselung gespeicherter Daten, die Beschränkung des Zugriffs auf berechtigte Mitarbeitende nach dem Prinzip „nur, was nötig ist“."
        }
      ]
    },
    {
      "number": 11,
      "title": "Ihre Rechte",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Sie haben das Recht auf Auskunft einschließlich einer Kopie Ihrer Daten (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20 DSGVO)."
        },
        {
          "kind": "paragraph",
          "text": "Sie können eine erteilte Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen; die bis dahin erfolgte Verarbeitung bleibt rechtmäßig. Der Widerruf ist so einfach möglich wie die Erteilung: schriftlich über die Kontaktdaten in Abschnitt 1."
        },
        {
          "kind": "paragraph",
          "text": "Wir antworten innerhalb eines Monats und kostenfrei. Zum Schutz Ihrer Daten können wir einen Nachweis Ihrer Identität verlangen."
        }
      ]
    },
    {
      "number": 12,
      "title": "Widerspruchsrecht",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Widerspruchsrecht (Art. 21 DSGVO): Sie können der Verarbeitung Ihrer Daten, die auf unserem berechtigten Interesse beruht (insbesondere dem Sanktionsscreening), jederzeit aus Gründen, die sich aus Ihrer besonderen Situation ergeben, widersprechen. Wir verarbeiten die Daten dann nicht mehr, es sei denn, wir können zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen, Rechte und Freiheiten überwiegen, oder die Verarbeitung dient der Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen. Ohne Sanktionsscreening können wir nach unseren internen Compliance-Vorgaben keine Zusammenarbeit anbieten und keine Zahlungen entgegennehmen."
        }
      ]
    },
    {
      "number": 13,
      "title": "Beschwerderecht",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem EU-Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO)."
        },
        {
          "kind": "paragraph",
          "text": "Wir würden uns freuen, wenn Sie uns zunächst Ihr Anliegen schildern (z. B. per E-Mail an datenschutz@gmed-health.com), damit wir es klären können. Ihr Recht, sich jederzeit direkt an eine Aufsichtsbehörde zu wenden, bleibt davon unberührt."
        }
      ]
    },
    {
      "number": 14,
      "title": "Stand und Änderungen",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Stand: 13.10.2026. Wir passen diese Datenschutzerklärung an, wenn sich unsere Verarbeitungen ändern."
        }
      ]
    }
  ],
  "ru": [
    {
      "number": 1,
      "title": "Ответственное лицо и уполномоченный по защите данных",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Настоящая политика конфиденциальности касается нашего опроса клиентов (формы опроса) и обработки Вашего запроса. Если мы начнём сотрудничество и заключим договор, мы отдельно проинформируем Вас об обработке данных при сотрудничестве."
        }
      ]
    },
    {
      "number": 2,
      "title": "Какие данные мы обрабатываем в форме",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Мы обрабатываем:"
        },
        {
          "kind": "list",
          "items": [
            "контактные и идентификационные данные (например, имя, дата рождения, гражданство, адрес, e-mail, телефон),",
            "сведения об оплате и расчётах (например, способ оплаты, получатель счёта, плательщик, статус страхования),",
            "сведения о других лицах или организациях, которых Вы указываете в форме (например, близкие, плательщик),",
            "данные о здоровье, включая медицинские данные, например диагнозы, жалобы, анамнез (особая категория данных согласно ст. 9 DSGVO),",
            "данные коммуникации (например, электронные письма и сообщения),",
            "результаты санкционной проверки (см. раздел 5)."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Данные мы получаем от Вас и от лиц, которых Вы указываете в форме."
        },
        {
          "kind": "paragraph",
          "text": "Мы сами не оказываем медицинских услуг, а предоставляем консалтинговые, организационные и административные услуги, включая услуги перевода."
        }
      ]
    },
    {
      "number": 3,
      "title": "Цели и правовые основания",
      "blocks": [
        {
          "kind": "list",
          "items": [
            "Обработка Вашего запроса, проверка и подготовка сотрудничества, общение с Вами: ст. 6 абз. 1 п. b DSGVO (предварительные меры по Вашему запросу).",
            "Обработка сведений о здоровье в форме: Ваше явное согласие, ст. 9 абз. 2 п. a DSGVO.",
            "Санкционная проверка: ст. 6 абз. 1 п. f DSGVO (законный интерес, см. раздел 5).",
            "Подтверждение и защита от правовых требований: ст. 6 абз. 1 п. f DSGVO и, если затрагиваются данные о здоровье, ст. 9 абз. 2 п. f DSGVO.",
            "Подтверждение данных согласий: ст. 6 абз. 1 п. c DSGVO в сочетании со ст. 7 абз. 1 DSGVO."
          ]
        }
      ]
    },
    {
      "number": 4,
      "title": "Обязательные сведения, добровольность и автоматизированные решения",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Обязательные поля отмечены в форме. Без обязательных сведений (контактные и идентификационные данные, сведения о получателе счёта и плательщике) мы не сможем обработать Ваш запрос и предложить сотрудничество. Все остальные сведения предоставляются добровольно."
        },
        {
          "kind": "paragraph",
          "text": "Ваше согласие на обработку Ваших сведений о здоровье добровольно. Если Вы не дадите согласие или отзовёте его, мы, к сожалению, не сможем организовать лечение, если для этого необходимы медицинские данные. Других неблагоприятных последствий для Вас не будет. Об отзыве согласия см. раздел 11. О передаче документов клиникам, врачам и другим медицинским учреждениям в рамках сотрудничества мы проинформируем Вас отдельно."
        },
        {
          "kind": "paragraph",
          "text": "Автоматизированные решения в отдельных случаях, включая профилирование (ст. 22 DSGVO), мы не принимаем. При санкционной проверке решения также принимают сотрудники."
        }
      ]
    },
    {
      "number": 5,
      "title": "Санкционная проверка (проверка на соблюдение требований)",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "После отправки формы и до начала сотрудничества мы сверяем идентификационные данные пациента, плательщика — физического лица или организации, законных представителей, включая назначенных судом попечителей, получателя счёта, который сам не платит, и указанного для оплаты банка с финансовыми санкционными списками ЕС и Германии. Для этого мы используем финансовый санкционный список Немецкого федерального банка (FiSaLis). Используются только идентификационные данные (имя, дата рождения, гражданство, адрес), без данных о здоровье или других медицинских данных. Лица, указанные исключительно как получатели в согласии на передачу данных, а также клиники, врачи и другие поставщики услуг не проверяются. При последующих платежах мы также проверяем имя владельца счёта, с которого поступает платёж. Об этом мы сообщаем в политике конфиденциальности при сотрудничестве."
        },
        {
          "kind": "paragraph",
          "text": "Правовое основание: наш законный интерес (ст. 6 абз. 1 п. f DSGVO). Мы не хотим принимать платежи (например, банковские переводы или наличные) от лиц и организаций, находящихся под санкциями, и сотрудничать с ними, чтобы избежать правовых, финансовых и репутационных рисков, оценённых в нашем внутреннем анализе рисков. Это относится ко всем клиентам. Решение о сотрудничестве мы принимаем только после проверки."
        },
        {
          "kind": "paragraph",
          "text": "При совпадении мы проверяем случай вручную; решения принимают только сотрудники, а не автоматическое сравнение. При подтверждённом совпадении мы не сотрудничаем с соответствующим лицом или организацией и не принимаем от них платежи. Если в исключительных случаях закон обяжет нас, мы уведомим компетентные органы. Если совпадение возникло по ошибке (например, из-за одинакового имени), пожалуйста, сообщите нам об этом. Результат проверки мы храним в соответствии с разделом 9. Вы можете возразить против этой проверки (раздел 12)."
        }
      ]
    },
    {
      "number": 6,
      "title": "Получатели и обработчики по поручению",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Мы обрабатываем Ваши данные в нашей системе управления клиентами GMED-EDV-System."
        },
        {
          "kind": "paragraph",
          "text": "Обработчики по поручению (ст. 28 DSGVO), действующие по нашим указаниям:"
        },
        {
          "kind": "list",
          "items": [
            "Хостинг: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen. Наши серверы находятся исключительно в центрах обработки данных в Германии. С провайдером заключён договор об обработке данных по поручению.",
            "Электронная (квалифицированная) подпись: Skribble AG, Talacker 21, 8001 Цюрих, Швейцария. Швейцария (третья страна, см. раздел 7). С поставщиком заключён договор об обработке данных по поручению."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Другие получатели:"
        },
        {
          "kind": "list",
          "items": [
            "наши сотрудники, которым данные необходимы для обработки Вашего запроса,",
            "переводчики, участвующие в обработке Вашего запроса,",
            "только при онлайн-запросе FiSaLis: Немецкий федеральный банк (поисковые данные санкционной проверки),",
            "органы власти, если мы обязаны по закону сообщить о данных."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Передача клиникам, врачам и другим медицинским учреждениям осуществляется только в рамках сотрудничества. Об этом мы проинформируем Вас отдельно."
        }
      ]
    },
    {
      "number": 7,
      "title": "Передача данных в третьи страны",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Данные из формы мы обрабатываем в Германии и, для электронной подписи Вашего согласия, в Швейцарии. Для этого мы привлекаем обработчика по поручению в Швейцарии (Skribble AG, см. раздел 6), которому передаются необходимые данные. Для Швейцарии действует решение Европейской комиссии об адекватном уровне защиты данных (ст. 45 DSGVO), поэтому дополнительные гарантии не требуются. Если в рамках сотрудничества потребуется передача в третьи страны (например, клиникам за пределами ЕС/ЕЭП), мы заранее проинформируем Вас отдельно и получим Ваше явное согласие."
        }
      ]
    },
    {
      "number": 8,
      "title": "Данные третьих лиц и несовершеннолетние",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Если Вы сообщаете нам данные других лиц или организаций (в том числе в форме), пожалуйста, убедитесь, что Вы уполномочены на это, и проинформируйте их об этой политике конфиденциальности. Санкционная проверка проводится только в отношении участников, перечисленных в разделе 5. Лица, указанные исключительно как получатели в согласии на передачу данных, не проверяются. Сведения о здоровье других лиц (например, родственников) Вы можете указывать только при наличии их согласия или полномочий представлять их. В отношении несовершеннолетних согласие дают законные представители."
        }
      ]
    },
    {
      "number": 9,
      "title": "Срок хранения",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Мы храним персональные данные только столько, сколько это необходимо для указанных целей. После этого мы удаляем их, за исключением случаев, когда действуют установленные законом обязанности по хранению (тогда мы храним данные до истечения соответствующего срока) или когда данные по-прежнему нужны нам для предъявления, осуществления или защиты правовых требований (ст. 6 абз. 1 п. f DSGVO, для данных о здоровье ст. 9 абз. 2 п. f DSGVO). Если к данным применяется несколько сроков хранения, действует самый длительный. В частности:"
        },
        {
          "kind": "list",
          "items": [
            "запросы без заключения договора: 14 дней после отправки.",
            "согласие подписано, договор не заключён: 180 дней, чтобы Вы могли спокойно принять решение, а мы могли продолжить уже начатую организацию (например, согласование с клиниками, выяснение вопроса о покрытии расходов) без повторного сбора данных. При отзыве согласия мы удаляем данные сразу, если нет обязанности хранения.",
            "результаты санкционной проверки: без заключения договора вместе с запросом через 14 дней или через 180 дней при подписанном согласии; при подтверждённом совпадении через 3 года, чтобы мы могли доказать причину отказа и защититься от правовых требований.",
            "подтверждение Вашего согласия: 3 года после истечения соответствующего срока, чтобы мы могли его подтвердить (ст. 7 абз. 1 DSGVO).",
            "при заключении договора Ваши данные переходят в договорные отношения. Дальнейшие сроки хранения, включая хранение счетов, договоров и результатов проверки, мы укажем в политике конфиденциальности при сотрудничестве."
          ]
        }
      ]
    },
    {
      "number": 10,
      "title": "Безопасность данных",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Мы защищаем Ваши данные соответствующими техническими и организационными мерами (ст. 32 DSGVO). К ним относятся, в частности, шифрование при передаче (TLS), шифрование хранимых данных, ограничение доступа кругом уполномоченных сотрудников по принципу «только то, что необходимо»."
        }
      ]
    },
    {
      "number": 11,
      "title": "Ваши права",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Вы вправе получить доступ к данным, включая копию Ваших данных (ст. 15), требовать исправления (ст. 16), удаления (ст. 17), ограничения обработки (ст. 18) и переноса данных (ст. 20 DSGVO)."
        },
        {
          "kind": "paragraph",
          "text": "Вы можете в любое время отозвать данное Вами согласие с действием на будущее; законность обработки, проведённой до отзыва, остаётся неизменной. Отозвать согласие так же просто, как дать его: письменно по контактам из раздела 1."
        },
        {
          "kind": "paragraph",
          "text": "Мы отвечаем в течение одного месяца и бесплатно. Для защиты Ваших данных мы можем потребовать подтверждение Вашей личности."
        }
      ]
    },
    {
      "number": 12,
      "title": "Право на возражение",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Право на возражение (ст. 21 DSGVO): Вы вправе в любой момент возразить против обработки Ваших данных, основанной на нашем законном интересе (в частности, против санкционной проверки), по причинам, связанным с Вашей особой ситуацией. После этого мы прекращаем обработку, если только не докажем наличие убедительных законных оснований, которые преобладают над Вашими интересами, правами и свободами, либо обработка служит для предъявления, осуществления или защиты правовых требований. Без санкционной проверки мы в соответствии с нашими внутренними требованиями комплаенса не можем предлагать сотрудничество и принимать платежи."
        }
      ]
    },
    {
      "number": 13,
      "title": "Право на жалобу",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Вы вправе подать жалобу в надзорный орган по защите данных, в частности в государстве-члене ЕС по месту Вашего проживания, работы или предполагаемого нарушения (ст. 77 DSGVO)."
        },
        {
          "kind": "paragraph",
          "text": "Мы будем рады, если Вы сначала сообщите нам о Вашем обращении (например, по e-mail datenschutz@gmed-health.com), чтобы мы могли всё выяснить. Это не ограничивает Ваше право в любой момент обратиться непосредственно в надзорный орган."
        }
      ]
    },
    {
      "number": 14,
      "title": "Актуальность и изменения",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Дата: 13.10.2026. Мы изменяем настоящую политику конфиденциальности, если меняется наша обработка данных."
        }
      ]
    }
  ],
  "en": [
    {
      "number": 1,
      "title": "Controller and data protection officer",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "This privacy notice applies to our customer questionnaire (inquiry form) and the handling of your inquiry. If we work together and enter into a contract, we will inform you separately about data processing during that cooperation."
        }
      ]
    },
    {
      "number": 2,
      "title": "Data we process in the form",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "We process:"
        },
        {
          "kind": "list",
          "items": [
            "Contact and identification data (e.g. name, date of birth, nationality, address, email, telephone),",
            "Payment and billing details (e.g. payment method, invoice recipient, payer, insurance status),",
            "Details of other people or organisations you name in the form (e.g. relatives, the payer),",
            "Health data, including medical data such as diagnoses, symptoms and medical history (a special category under Article 9 GDPR),",
            "Communication data (e.g. emails and messages),",
            "Sanctions screening results (see section 5)."
          ]
        },
        {
          "kind": "paragraph",
          "text": "We receive the data from you and from the people you name in the form."
        },
        {
          "kind": "paragraph",
          "text": "We process personal data and health data of patients, relatives and prospective clients solely to arrange, organise and bill for medical examinations and treatment, and to provide, arrange, organise and bill for non-medical services. We do not provide medical services ourselves; we provide organisational and administrative services, including interpreting."
        }
      ]
    },
    {
      "number": 3,
      "title": "Purposes and legal bases",
      "blocks": [
        {
          "kind": "list",
          "items": [
            "Handling your inquiry, assessing and preparing cooperation, and communicating with you: Article 6(1)(b) GDPR (steps prior to entering into a contract at your request).",
            "Processing health information in the form: your explicit consent, Article 9(2)(a) GDPR.",
            "Sanctions screening: Article 6(1)(f) GDPR (legitimate interest, see section 5).",
            "Establishing and defending against legal claims: Article 6(1)(f) GDPR and, where health data is concerned, Article 9(2)(f) GDPR.",
            "Evidence of consent given: Article 6(1)(c) GDPR in conjunction with Article 7(1) GDPR."
          ]
        }
      ]
    },
    {
      "number": 4,
      "title": "Required information, voluntary consent and automated decisions",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Required fields are marked in the form. Without the required information (contact and identification data, details of the invoice recipient and payer), we cannot handle your inquiry or offer cooperation. All other information is voluntary."
        },
        {
          "kind": "paragraph",
          "text": "Your consent to processing your health information is voluntary. If you do not give it or withdraw it, we unfortunately cannot arrange treatment insofar as medical data is necessary for that purpose. You will suffer no other disadvantage. For withdrawal, see section 11. We will inform you separately about sharing documents with clinics, doctors and other medical service providers during our cooperation."
        },
        {
          "kind": "paragraph",
          "text": "We do not make automated individual decisions, including profiling (Article 22 GDPR). Staff also make the decisions in sanctions screening."
        }
      ]
    },
    {
      "number": 5,
      "title": "Sanctions screening (compliance check)",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "After the form is submitted and before cooperation begins, we compare the identification data of the patient, the individual or organisation paying, legal representatives including court-appointed guardians, an invoice recipient who does not pay, and the bank specified for payment against the financial sanctions lists of the EU and Germany. We use the Deutsche Bundesbank financial sanctions list (FiSaLis). Only identification data (name, date of birth, nationality, address) is used, not health or other medical data. People named solely as recipients in the consent to data sharing, and clinics, doctors and other service providers, are not screened. For subsequent payments, we also check the name of the account holder of incoming payments. We explain this in the privacy notice for our cooperation."
        },
        {
          "kind": "paragraph",
          "text": "The legal basis is our legitimate interest (Article 6(1)(f) GDPR): we do not wish to accept payments (e.g. bank transfers or cash payments) from sanctioned people or organisations or work with them, in order to avoid legal, financial and reputational risks assessed in our internal risk analysis. This applies to all clients. We decide on cooperation only after screening."
        },
        {
          "kind": "paragraph",
          "text": "If there is a match, we review the case manually; decisions are made only by staff, never solely by an automated comparison. If a match is confirmed, we do not work with the person or organisation concerned or accept payments from them. If, exceptionally, we are legally obliged to do so, we inform the competent authorities. If a match is mistaken (e.g. an identical name), please let us know. We retain the screening result as described in section 9. You may object to this screening (section 12)."
        }
      ]
    },
    {
      "number": 6,
      "title": "Recipients and processors",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "We process your data in our GMED-EDV-System customer management system."
        },
        {
          "kind": "paragraph",
          "text": "Processors acting on our instructions (Article 28 GDPR):"
        },
        {
          "kind": "list",
          "items": [
            "Hosting: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany. Our servers are located exclusively in data centres in Germany. We have a data processing agreement with the provider.",
            "Electronic (qualified) signature: Skribble AG, Talacker 21, 8001 Zurich, Switzerland. We have a data processing agreement with the provider."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Other recipients:"
        },
        {
          "kind": "list",
          "items": [
            "Our staff, insofar as they need the data to handle your inquiry,",
            "Interpreters, insofar as they are involved in handling your inquiry,",
            "Only for online FiSaLis searches: Deutsche Bundesbank (sanctions screening search terms),",
            "Authorities, insofar as we are legally required to report."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Data is shared with clinics, doctors and other medical service providers only during our cooperation. We will inform you about this separately."
        }
      ]
    },
    {
      "number": 7,
      "title": "Transfers to third countries",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "We process data from the form in Germany and, for the electronic signature of your consent, in Switzerland. For this purpose we use a processor in Switzerland (Skribble AG, see section 6), to whom the necessary data is transferred. The European Commission has recognised an adequate level of data protection in Switzerland (Article 45 GDPR), so no additional safeguards are required. If transfers to third countries become necessary during our cooperation (e.g. to clinics outside the EU/EEA), we will inform you separately in advance and obtain your explicit consent."
        }
      ]
    },
    {
      "number": 8,
      "title": "Third-party data and minors",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "If you provide us with data about other people or organisations (including in the form), please ensure you are authorised to do so and inform them of this privacy notice. Sanctions screening applies only to the parties listed in section 5. People named solely as recipients in the consent to data sharing are not screened. You may provide health information about other people (e.g. relatives) only if they have consented or you are authorised to represent them. For minors, those with parental responsibility give consent."
        }
      ]
    },
    {
      "number": 9,
      "title": "Retention periods",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "We retain personal data only for as long as necessary for the stated purposes. We then delete it, unless statutory retention obligations apply (in which case we retain it until the relevant period expires) or we still need it to establish, exercise or defend legal claims (Article 6(1)(f) GDPR and, for health data, Article 9(2)(f) GDPR). Where several retention periods apply, the longest applies. In detail:"
        },
        {
          "kind": "list",
          "items": [
            "Inquiries without a contract: 14 days after submission.",
            "Consent signed but no contract: 180 days, so that you can decide at your own pace and we can continue planning already begun (e.g. coordinating with clinics or clarifying cost coverage) without collecting the data again. If consent is withdrawn, we delete the data immediately unless a retention obligation applies.",
            "Sanctions screening results: without a contract, together with the inquiry after 14 days, or after 180 days if consent has been signed; for a confirmed match, after 3 years, so we can demonstrate the reason for refusal and defend against legal claims.",
            "Evidence of your consent: 3 years after the relevant period expires, so we can demonstrate it (Article 7(1) GDPR).",
            "If a contract is concluded, your data becomes part of the contractual relationship. Further retention periods, including those for invoices, contracts and screening results, are set out in the privacy notice for our cooperation."
          ]
        }
      ]
    },
    {
      "number": 10,
      "title": "Data security",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "We protect your data through appropriate technical and organisational measures (Article 32 GDPR). These include, in particular, encryption in transit (TLS), encryption of stored data, and restricting access to authorised staff on a need-to-know basis."
        }
      ]
    },
    {
      "number": 11,
      "title": "Your rights",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "You have the right of access, including a copy of your data (Article 15), rectification (Article 16), erasure (Article 17), restriction of processing (Article 18), and data portability (Article 20 GDPR)."
        },
        {
          "kind": "paragraph",
          "text": "You may withdraw consent at any time with effect for the future; processing carried out before withdrawal remains lawful. Withdrawing consent is as easy as giving it: in writing using the contact details in section 1."
        },
        {
          "kind": "paragraph",
          "text": "We respond within one month and free of charge. To protect your data, we may request proof of your identity."
        }
      ]
    },
    {
      "number": 12,
      "title": "Right to object",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Right to object (Article 21 GDPR): you may object at any time, on grounds relating to your particular situation, to processing based on our legitimate interest (especially sanctions screening). We will then stop processing the data unless we can demonstrate compelling legitimate grounds that override your interests, rights and freedoms, or processing serves to establish, exercise or defend legal claims. Under our internal compliance requirements, we cannot offer cooperation or accept payments without sanctions screening."
        }
      ]
    },
    {
      "number": 13,
      "title": "Right to complain",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "You have the right to lodge a complaint with a data protection supervisory authority, particularly in the EU Member State of your habitual residence, place of work or the alleged infringement (Article 77 GDPR)."
        },
        {
          "kind": "paragraph",
          "text": "We would appreciate it if you first told us about your concern (e.g. by email to datenschutz@gmed-health.com), so we can address it. This does not affect your right to contact a supervisory authority directly at any time."
        }
      ]
    },
    {
      "number": 14,
      "title": "Date and changes",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Date: 13.10.2026. We update this privacy notice when our processing changes."
        }
      ]
    }
  ],
  "uk": [
    {
      "number": 1,
      "title": "Володілець даних та уповноважений із захисту даних",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Це повідомлення про конфіденційність стосується нашого опитування клієнтів (форми опитування) та опрацювання Вашого запиту. Якщо ми почнемо співпрацю та укладемо договір, ми окремо повідомимо Вас про обробку даних під час співпраці."
        }
      ]
    },
    {
      "number": 2,
      "title": "Які дані ми обробляємо у формі",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ми обробляємо:"
        },
        {
          "kind": "list",
          "items": [
            "Контактні та ідентифікаційні дані (наприклад, ім’я, дата народження, громадянство, адреса, електронна пошта, телефон),",
            "Відомості про оплату та розрахунки (наприклад, спосіб оплати, одержувач рахунку, платник, статус страхування),",
            "Відомості про інших осіб або організації, яких Ви зазначаєте у формі (наприклад, родичі, платник),",
            "Дані про здоров’я, зокрема медичні дані, наприклад діагнози, скарги, анамнез (особлива категорія за ст. 9 GDPR),",
            "Дані комунікації (наприклад, електронні листи та повідомлення),",
            "Результати санкційної перевірки (див. розділ 5)."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Ми отримуємо дані від Вас та осіб, яких Ви зазначаєте у формі."
        },
        {
          "kind": "paragraph",
          "text": "Ми обробляємо персональні дані та дані про здоров’я пацієнтів, родичів і потенційних клієнтів виключно для посередництва, організації та розрахунків за медичні обстеження й лікування, а також для надання, посередництва, організації та розрахунків за немедичні послуги. Ми самі не надаємо медичних послуг, а надаємо організаційні та адміністративні послуги, зокрема усний переклад."
        }
      ]
    },
    {
      "number": 3,
      "title": "Цілі та правові підстави",
      "blocks": [
        {
          "kind": "list",
          "items": [
            "Опрацювання Вашого запиту, оцінювання та підготовка співпраці, спілкування з Вами: ст. 6(1)(b) GDPR (заходи до укладення договору на Ваш запит).",
            "Обробка відомостей про здоров’я у формі: Ваша явна згода, ст. 9(2)(a) GDPR.",
            "Санкційна перевірка: ст. 6(1)(f) GDPR (законний інтерес, див. розділ 5).",
            "Підтвердження та захист від правових вимог: ст. 6(1)(f) GDPR і, якщо йдеться про дані про здоров’я, ст. 9(2)(f) GDPR.",
            "Підтвердження наданої згоди: ст. 6(1)(c) GDPR у поєднанні зі ст. 7(1) GDPR."
          ]
        }
      ]
    },
    {
      "number": 4,
      "title": "Обов’язкові відомості, добровільність та автоматизовані рішення",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Обов’язкові поля позначені у формі. Без обов’язкових відомостей (контактних та ідентифікаційних даних, відомостей про одержувача рахунку й платника) ми не можемо опрацювати Ваш запит і запропонувати співпрацю. Усі інші відомості є добровільними."
        },
        {
          "kind": "paragraph",
          "text": "Ваша згода на обробку відомостей про здоров’я є добровільною. Якщо Ви не надасте її або відкличете, ми, на жаль, не зможемо організувати лікування тією мірою, якою для цього необхідні медичні дані. Інших негативних наслідків для Вас не буде. Про відкликання див. розділ 11. Про передачу документів клінікам, лікарям та іншим надавачам медичних послуг під час співпраці ми повідомимо Вас окремо."
        },
        {
          "kind": "paragraph",
          "text": "Ми не ухвалюємо автоматизованих індивідуальних рішень, зокрема на основі профілювання (ст. 22 GDPR). Під час санкційної перевірки рішення також ухвалюють співробітники."
        }
      ]
    },
    {
      "number": 5,
      "title": "Санкційна перевірка (комплаєнс-перевірка)",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Після надсилання форми та до початку співпраці ми звіряємо ідентифікаційні дані пацієнта, платника — фізичної особи або організації, законних представників, зокрема призначених судом піклувальників, одержувача рахунку, який сам не платить, і зазначеного для оплати банку з фінансовими санкційними списками ЄС та Німеччини. Для цього ми використовуємо фінансовий санкційний список Німецького федерального банку (FiSaLis). Використовуються лише ідентифікаційні дані (ім’я, дата народження, громадянство, адреса), без даних про здоров’я чи інших медичних даних. Особи, зазначені виключно як одержувачі у згоді на передачу даних, а також клініки, лікарі та інші надавачі послуг не перевіряються. Під час подальших платежів ми також перевіряємо ім’я власника рахунку, з якого надходить платіж. Про це ми повідомляємо в повідомленні про конфіденційність для співпраці."
        },
        {
          "kind": "paragraph",
          "text": "Правовою підставою є наш законний інтерес (ст. 6(1)(f) GDPR): ми не бажаємо приймати платежі (наприклад, банківські перекази чи готівку) від підсанкційних осіб або організацій і співпрацювати з ними, щоб уникнути правових, фінансових та репутаційних ризиків, оцінених у нашому внутрішньому аналізі ризиків. Це стосується всіх клієнтів. Рішення про співпрацю ми ухвалюємо лише після перевірки."
        },
        {
          "kind": "paragraph",
          "text": "У разі збігу ми перевіряємо випадок вручну; рішення ухвалюють лише співробітники, ніколи — виключно автоматизоване зіставлення. Якщо збіг підтверджено, ми не співпрацюємо з відповідною особою чи організацією та не приймаємо від неї платежів. Якщо у виняткових випадках цього вимагає закон, ми повідомляємо компетентні органи. Якщо збіг помилковий (наприклад, однакові імена), будь ласка, повідомте нас. Результат перевірки зберігаємо відповідно до розділу 9. Ви можете заперечити проти цієї перевірки (розділ 12)."
        }
      ]
    },
    {
      "number": 6,
      "title": "Одержувачі та обробники даних",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ми обробляємо Ваші дані у нашій системі управління клієнтами GMED-EDV-System."
        },
        {
          "kind": "paragraph",
          "text": "Обробники, які діють за нашими вказівками (ст. 28 GDPR):"
        },
        {
          "kind": "list",
          "items": [
            "Хостинг: Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Німеччина. Наші сервери розміщені виключно в центрах обробки даних у Німеччині. З надавачем укладено договір про обробку даних.",
            "Електронний (кваліфікований) підпис: Skribble AG, Talacker 21, 8001 Zürich, Швейцарія. З надавачем укладено договір про обробку даних."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Інші одержувачі:"
        },
        {
          "kind": "list",
          "items": [
            "Наші співробітники, яким дані необхідні для опрацювання Вашого запиту,",
            "Усні перекладачі, якщо вони беруть участь в опрацюванні Вашого запиту,",
            "Лише під час онлайн-пошуку у FiSaLis: Німецький федеральний банк (пошукові дані санкційної перевірки),",
            "Органи влади, якщо ми зобов’язані повідомляти їх за законом."
          ]
        },
        {
          "kind": "paragraph",
          "text": "Передача клінікам, лікарям та іншим надавачам медичних послуг відбувається лише під час співпраці. Про це ми повідомимо Вас окремо."
        }
      ]
    },
    {
      "number": 7,
      "title": "Передача даних до третіх країн",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Дані з форми ми обробляємо в Німеччині та, для електронного підписання Вашої згоди, у Швейцарії. Для цього ми залучаємо обробника у Швейцарії (Skribble AG, див. розділ 6), якому передаються необхідні дані. Європейська комісія визнала належний рівень захисту даних у Швейцарії (ст. 45 GDPR), тому додаткові гарантії не потрібні. Якщо під час співпраці буде необхідна передача до третіх країн (наприклад, клінікам за межами ЄС/ЄЕЗ), ми заздалегідь окремо повідомимо Вас і отримаємо Вашу явну згоду."
        }
      ]
    },
    {
      "number": 8,
      "title": "Дані третіх осіб і неповнолітні",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Якщо Ви повідомляєте нам дані інших осіб або організацій (зокрема у формі), будь ласка, переконайтеся, що маєте на це повноваження, та ознайомте їх із цим повідомленням про конфіденційність. Санкційна перевірка проводиться лише щодо учасників, перелічених у розділі 5. Особи, зазначені виключно як одержувачі у згоді на передачу даних, не перевіряються. Відомості про здоров’я інших осіб (наприклад, родичів) Ви можете надавати лише за їхньою згодою або якщо маєте повноваження представляти їх. За неповнолітніх згоду надають особи, які мають батьківські права."
        }
      ]
    },
    {
      "number": 9,
      "title": "Строки зберігання",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ми зберігаємо персональні дані лише стільки, скільки потрібно для зазначених цілей. Після цього ми їх видаляємо, крім випадків, коли діють установлені законом обов’язки зберігання (тоді зберігаємо до закінчення відповідного строку) або дані все ще потрібні для пред’явлення, здійснення чи захисту правових вимог (ст. 6(1)(f) GDPR, а для даних про здоров’я — ст. 9(2)(f) GDPR). Якщо діє кілька строків зберігання, застосовується найдовший. Зокрема:"
        },
        {
          "kind": "list",
          "items": [
            "Запити без договору: 14 днів після надсилання.",
            "Згоду підписано, але договір не укладено: 180 днів, щоб Ви могли спокійно прийняти рішення, а ми — продовжити вже розпочате планування (наприклад, узгодження з клініками чи з’ясування покриття витрат) без повторного збору даних. У разі відкликання згоди ми видаляємо дані негайно, якщо немає обов’язку їх зберігати.",
            "Результати санкційної перевірки: без укладення договору — разом із запитом через 14 днів або через 180 днів за наявності підписаної згоди; за підтвердженого збігу — через 3 роки, щоб ми могли підтвердити причину відмови й захиститися від правових вимог.",
            "Підтвердження Вашої згоди: 3 роки після закінчення відповідного строку, щоб ми могли підтвердити її надання (ст. 7(1) GDPR).",
            "Після укладення договору Ваші дані стають частиною договірних відносин. Подальші строки зберігання, зокрема рахунків, договорів та результатів перевірки, ми зазначаємо в повідомленні про конфіденційність для співпраці."
          ]
        }
      ]
    },
    {
      "number": 10,
      "title": "Безпека даних",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ми захищаємо Ваші дані належними технічними та організаційними заходами (ст. 32 GDPR). До них, зокрема, належать шифрування під час передачі (TLS), шифрування збережених даних та обмеження доступу колом уповноважених співробітників за принципом «лише необхідне»."
        }
      ]
    },
    {
      "number": 11,
      "title": "Ваші права",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ви маєте право на доступ, зокрема отримання копії Ваших даних (ст. 15), виправлення (ст. 16), видалення (ст. 17), обмеження обробки (ст. 18) та перенесення даних (ст. 20 GDPR)."
        },
        {
          "kind": "paragraph",
          "text": "Ви можете будь-коли відкликати надану згоду з дією на майбутнє; обробка, здійснена до відкликання, залишається правомірною. Відкликати згоду так само просто, як надати її: письмово за контактами з розділу 1."
        },
        {
          "kind": "paragraph",
          "text": "Ми відповідаємо протягом одного місяця та безоплатно. Для захисту Ваших даних ми можемо попросити підтвердження Вашої особи."
        }
      ]
    },
    {
      "number": 12,
      "title": "Право на заперечення",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Право на заперечення (ст. 21 GDPR): Ви можете будь-коли заперечити проти обробки Ваших даних, що ґрунтується на нашому законному інтересі (зокрема санкційної перевірки), з причин, пов’язаних із Вашою конкретною ситуацією. Тоді ми припиняємо обробку, якщо не доведемо наявність вагомих законних підстав, що переважають Ваші інтереси, права та свободи, або якщо обробка потрібна для пред’явлення, здійснення чи захисту правових вимог. Без санкційної перевірки ми, відповідно до наших внутрішніх вимог комплаєнсу, не можемо запропонувати співпрацю та приймати платежі."
        }
      ]
    },
    {
      "number": 13,
      "title": "Право на скаргу",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Ви маєте право подати скаргу до наглядового органу із захисту даних, зокрема в державі-члені ЄС за місцем Вашого постійного проживання, роботи або ймовірного порушення (ст. 77 GDPR)."
        },
        {
          "kind": "paragraph",
          "text": "Будемо вдячні, якщо Ви спершу повідомите нам про Ваше звернення (наприклад, електронною поштою на datenschutz@gmed-health.com), щоб ми могли його з’ясувати. Це не обмежує Вашого права будь-коли звернутися безпосередньо до наглядового органу."
        }
      ]
    },
    {
      "number": 14,
      "title": "Дата та зміни",
      "blocks": [
        {
          "kind": "paragraph",
          "text": "Дата: 13.10.2026. Ми оновлюємо це повідомлення про конфіденційність, якщо змінюється наша обробка даних."
        }
      ]
    }
  ]
};
