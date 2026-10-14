import { asLeadCabinetLang } from "./lead-request-text";

const texts = {
  de: {
    title: "Vertrauenspersonen", introduction: "Hier nennen Sie vertraute Personen, denen GMED Auskunft über Sie geben darf. Diese Personen handeln nicht in Ihrem Namen und unterschreiben nichts für Sie.",
    childIntroduction: "Hier nennen Sie vertraute Personen, denen GMED Auskunft über Ihr Kind geben darf. Diese Personen handeln nicht im Namen Ihres Kindes und unterschreiben nichts für Ihr Kind.",
    empty: "Noch keine Vertrauenspersonen eingetragen.", save: "Speichern", saved: "Gespeichert", unsaved: "Änderungen noch nicht gespeichert", edit: "Liste bearbeiten",
    consentHint: "Damit GMED diesen Personen Auskunft geben darf, wählen Sie im Antrag die Einwilligung zur Übermittlung an die unter „Vertrauenspersonen“ genannten Personen.",
    requestLink: "Zum Antrag", required: "Fügen Sie unter „Vertrauenspersonen“ mindestens eine Person hinzu oder entfernen Sie das Häkchen.",
    invalid: "Geben Sie für jede Person einen Namen und die Beziehung an. Höchstens 5 Personen, je Feld höchstens 120 Zeichen.",
    removeAllHint: "Wenn Sie die letzte Person entfernen und speichern, wird nur die Einwilligung zur Übermittlung an diese Personen aufgehoben. Alle anderen Einwilligungen bleiben unverändert.",
  },
  en: {
    title: "Trusted persons", introduction: "Name people you trust whom GMED may tell about you. These people cannot act on your behalf or sign anything for you.",
    childIntroduction: "Name people you trust whom GMED may tell about your child. These people cannot act on your child's behalf or sign anything for your child.",
    empty: "No trusted persons added yet.", save: "Save", saved: "Saved", unsaved: "Changes not saved yet", edit: "Edit list",
    consentHint: "For GMED to share information with these people, select the consent in your request to share data with the people listed under “Trusted persons”.",
    requestLink: "Open request", required: "Add at least one person under “Trusted persons”, or untick the consent.",
    invalid: "Enter a name and relationship for each person. Add up to 5 people, with up to 120 characters per field.",
    removeAllHint: "Removing the last person and saving also turns off consent to share information with these people. All other consents stay unchanged.",
  },
  uk: {
    title: "Довірені особи", introduction: "Вкажіть близьких людей, яким ви довіряєте і яким GMED може повідомляти відомості про вас. Ці люди не можуть діяти від вашого імені й нічого за вас не підписують.",
    childIntroduction: "Вкажіть близьких людей, яким ви довіряєте і яким GMED може повідомляти відомості про вашу дитину. Ці люди не можуть діяти від імені дитини й нічого за неї не підписують.",
    empty: "Довірених осіб ще не додано.", save: "Зберегти", saved: "Збережено", unsaved: "Зміни ще не збережено", edit: "Змінити список",
    consentHint: "Щоб GMED міг повідомляти цим людям відомості, позначте в заявці згоду на передачу даних особам, зазначеним у розділі «Довірені особи».",
    requestLink: "Відкрити заявку", required: "Додайте хоча б одну особу в розділі «Довірені особи» або зніміть позначку згоди.",
    invalid: "Для кожної особи вкажіть ім’я та оберіть, хто це. Не більше 5 осіб, до 120 символів у кожному полі.",
    removeAllHint: "Якщо видалити останню особу й зберегти, згоду на передачу відомостей цим особам також буде знято. Решта згод не зміниться.",
  },
  ru: {
    title: "Доверенные лица", introduction: "Укажите близких людей, которым вы доверяете и которым GMED может сообщать сведения о вас. Эти люди не могут действовать от вашего имени и ничего за вас не подписывают.",
    childIntroduction: "Укажите близких людей, которым вы доверяете и которым GMED может сообщать сведения о вашем ребёнке. Эти люди не могут действовать от имени ребёнка и ничего за него не подписывают.",
    empty: "Доверенные лица ещё не добавлены.", save: "Сохранить", saved: "Сохранено", unsaved: "Изменения ещё не сохранены", edit: "Изменить список",
    consentHint: "Чтобы GMED мог сообщать этим людям сведения, отметьте в заявке согласие на передачу данных лицам, указанным в разделе «Доверенные лица».",
    requestLink: "Открыть заявку", required: "Добавьте хотя бы одно лицо в разделе «Доверенные лица» или снимите отметку согласия.",
    invalid: "Для каждого лица укажите имя и выберите, кто это. Не более 5 лиц, до 120 символов в каждом поле.",
    removeAllHint: "Если удалить последнее лицо и сохранить, согласие на передачу сведений этим лицам также будет снято. Остальные согласия не изменятся.",
  },
};

export function trustedPersonsText(lang: string) {
  return texts[asLeadCabinetLang(lang) ?? "ru"];
}
