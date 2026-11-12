export type StaffAccessCopy = {
  title: string;
  fullAccess: string;
  loadError: string;
  resourceLoadError: string;
  retry: string;
  profile: string;
  noProfile: string;
  validUntil: string;
  inherited: string;
  noInherited: string;
  personal: string;
  providers: string;
  patients: string;
  documents: string;
  search: string;
  resourceType: string;
  resourceStatus: string;
  resourceCount: string;
  empty: string;
  medicalLocked: string;
  medicalAllLocked: string;
  nonMedicalUploadOnly: string;
  nonMedicalUploadHint: string;
  directDeny: string;
  inheritedRule: string;
  globalRules: string;
  allScopeHint: string;
  remove: string;
  create: string;
  clone: string;
  newProfileName: string;
  description: string;
  createFromDirect: string;
  creating: string;
  profileCreateError: string;
  conflict: string;
  saveError: string;
  save: string;
  saving: string;
  all: string;
  inactive: string;
  assigned: string;
  unavailable: string;
  statuses: {
    active: string;
    inactive: string;
    prospective: string;
    deleted: string;
    draft: string;
    archived: string;
    unknown: string;
  };
  capabilities: {
    view: string;
    use: string;
    edit: string;
    download: string;
    upload: string;
  };
};

export interface StaffAccessTranslations {
  staffAccess: StaffAccessCopy;
}

export const staffAccessDe = {
  title: "Zugriffe",
  fullAccess: "Vollständiger Systemzugriff",
  loadError: "Zugriffe konnten nicht geladen werden.",
  resourceLoadError: "Katalog konnte nicht geladen werden.",
  retry: "Erneut versuchen",
  profile: "Wiederverwendbares Profil",
  noProfile: "Ohne Profil",
  validUntil: "Profil gültig bis",
  inherited: "Vom Profil geerbt",
  noInherited: "Das gewählte Profil enthält keine Regeln.",
  personal: "Persönliche Regeln",
  providers: "Anbieter",
  patients: "Patienten",
  documents: "Dokumente",
  search: "Ressource suchen",
  resourceType: "Typ",
  resourceStatus: "Status",
  resourceCount: "Angezeigt: {shown} von {total}",
  empty: "Keine Ressourcen gefunden.",
  medicalLocked: "Medizinisches Dokument: für die Rolle des ausgewählten Mitarbeiters systemweit gesperrt.",
  medicalAllLocked:
    "«Alle» umfasst auch medizinische Dokumente, die für diese Rolle systemweit gesperrt sind. Erlauben Sie einzelne Dokumente in der Liste unten.",
  nonMedicalUploadOnly: "Nur nicht medizinische",
  nonMedicalUploadHint:
    "Neue Dokumente hochladen: Diese Rolle darf nur nicht medizinische Dokumente hochladen; medizinische lehnt das System weiterhin ab.",
  directDeny: "Direkt verboten",
  inheritedRule: "Profil",
  globalRules: "Globale persönliche Regeln",
  allScopeHint:
    "Persönliche Regel für alle verfügbaren Einträge; medizinische Systemgrenzen bleiben aktiv.",
  remove: "Entfernen",
  create: "Profil erstellen",
  clone: "Profil duplizieren",
  newProfileName: "Profilname",
  description: "Beschreibung (optional)",
  createFromDirect: "Aus persönlichen Regeln erstellen",
  creating: "Wird erstellt…",
  profileCreateError: "Profil konnte nicht erstellt werden.",
  conflict:
    "Die Zugriffe wurden in einer anderen Sitzung geändert. Laden Sie die aktuellen Daten neu und wiederholen Sie die Änderungen.",
  saveError: "Zugriffe konnten nicht gespeichert werden.",
  save: "Zugriffe speichern",
  saving: "Wird gespeichert…",
  all: "Alle Einträge",
  inactive: "Inaktiv",
  assigned: "zugewiesen",
  unavailable: "Nicht im aktuellen Katalog verfügbar",
  statuses: {
    active: "Aktiv",
    inactive: "Inaktiv",
    prospective: "Interessent",
    deleted: "Gelöscht",
    draft: "Entwurf",
    archived: "Archiviert",
    unknown: "Unbekannt",
  },
  capabilities: {
    view: "Ansehen",
    use: "Verwenden",
    edit: "Bearbeiten",
    download: "Download",
    upload: "Upload",
  },
} satisfies StaffAccessCopy;

export const staffAccessRu = {
  title: "Доступы",
  fullAccess: "Полный системный доступ",
  loadError: "Не удалось загрузить доступы.",
  resourceLoadError: "Не удалось загрузить каталог.",
  retry: "Повторить",
  profile: "Многоразовый профиль",
  noProfile: "Без профиля",
  validUntil: "Профиль действует до",
  inherited: "Унаследовано из профиля",
  noInherited: "В выбранном профиле пока нет правил.",
  personal: "Персональные правила",
  providers: "Провайдеры",
  patients: "Пациенты",
  documents: "Документы",
  search: "Найти ресурс",
  resourceType: "Тип",
  resourceStatus: "Статус",
  resourceCount: "Показано: {shown} из {total}",
  empty: "Ресурсы не найдены.",
  medicalLocked: "Медицинский документ: доступ для роли выбранного сотрудника заблокирован системой.",
  medicalAllLocked:
    "«Все» включает и медицинские документы, которые для этой роли закрыты системой. Разрешите отдельные документы в списке ниже.",
  nonMedicalUploadOnly: "Только немедицинские",
  nonMedicalUploadHint:
    "Загрузка новых документов: эта роль может загружать только немедицинские документы; медицинские система по-прежнему отклоняет.",
  directDeny: "Прямой запрет",
  inheritedRule: "Профиль",
  globalRules: "Глобальные персональные правила",
  allScopeHint:
    "Персональное правило для всех доступных записей; системные медицинские ограничения продолжают действовать.",
  remove: "Удалить",
  create: "Создать профиль",
  clone: "Дублировать профиль",
  newProfileName: "Название профиля",
  description: "Описание (необязательно)",
  createFromDirect: "Создать из персональных правил",
  creating: "Создание…",
  profileCreateError: "Не удалось создать профиль.",
  conflict:
    "Доступы были изменены в другой сессии. Загрузите актуальные данные и повторите изменения.",
  saveError: "Не удалось сохранить доступы.",
  save: "Сохранить доступы",
  saving: "Сохранение…",
  all: "Все записи",
  inactive: "Неактивен",
  assigned: "назначен",
  unavailable: "Недоступен в текущем каталоге",
  statuses: {
    active: "Активен",
    inactive: "Неактивен",
    prospective: "Заявитель",
    deleted: "Удалён",
    draft: "Черновик",
    archived: "Архивный",
    unknown: "Неизвестно",
  },
  capabilities: {
    view: "Просмотр",
    use: "Использование",
    edit: "Редактирование",
    download: "Скачивание",
    upload: "Загрузка",
  },
} satisfies StaffAccessCopy;
