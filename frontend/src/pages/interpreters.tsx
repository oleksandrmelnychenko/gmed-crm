import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Plus,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import {
  buildInterpreterLanguagesPath,
  buildInterpreterListPath,
  buildInterpreterProfileDocumentDownloadPath,
  buildInterpreterProfileDocumentsPath,
  canCreateInterpreterUserAccount,
  emptyInterpreterLanguage,
  interpreterLanguageRecordToForm,
  interpreterLanguagesToPayload,
  normalizeInterpreterAccountDraft,
  type InterpreterLanguageForm,
  type InterpreterLanguageRecord,
} from "./interpreters.model";

type InterpreterRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  profile_source?: "user" | "standalone";
  profile: InterpreterProfile;
  profile_updated_at: string | null;
};

type InterpreterProfile = Record<string, unknown>;

type CreatedInterpreterUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

type InterpreterOperations = {
  summary: Record<string, unknown>;
  patients: Record<string, unknown>[];
  upcoming_appointments: Record<string, unknown>[];
  active_tasks: Record<string, unknown>[];
  recent_reports: Record<string, unknown>[];
  billing_lines: Record<string, unknown>[];
};

type UploadedProfileDocument = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
};

type CredentialForm = {
  credentialType: string;
  title: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  documentUrl: string;
  documentId: string;
  documentName: string;
  notes: string;
};

type InterpreterProfileForm = {
  gender: string;
  birthDate: string;
  status: string;
  contractType: string;
  contractStartDate: string;
  contractEndDate: string;
  employmentKind: string;
  phone: string;
  emailSecure: boolean;
  address: string;
  emergencyContact: string;
  workCountries: string;
  workLocations: string;
  languageProfile: string;
  certificates: string;
  credentials: CredentialForm[];
  medicalKnowledge: string;
  trainingHistory: string;
  confidentialityStatus: string;
  confidentialitySignedAt: string;
  confidentialityDocumentUrl: string;
  confidentialityDocumentId: string;
  confidentialityDocumentName: string;
  avvStatus: string;
  avvSignedAt: string;
  avvDocumentUrl: string;
  avvDocumentId: string;
  avvDocumentName: string;
  gdprTrainingAt: string;
  workPermitValidUntil: string;
  hourlyRate: string;
  salaryClass: string;
  bankDetails: string;
  taxNumber: string;
  ustIdnr: string;
  billingStatus: string;
  weeklyCapacityHours: string;
  accessLevel: string;
  autoBlockPolicy: string;
  internalNotes: string;
  equipment: string;
  retentionDeleteAt: string;
  erasureRequestStatus: string;
};

type CreateInterpreterAccountForm = {
  name: string;
  email: string;
  password: string;
  role: "interpreter" | "teamlead_interpreter";
  status: string;
  contractType: string;
  employmentKind: string;
  createUserAccount: boolean;
};

const inputClass =
  "h-9 rounded-lg border border-input bg-background px-3 text-sm";
const selectClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

function asProfile(value: unknown): InterpreterProfile {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as InterpreterProfile)
    : {};
}

function nested(profile: InterpreterProfile, key: string) {
  return asProfile(profile[key]);
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function bool(value: unknown) {
  return value === true;
}

function listText(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join(", ")
    : text(value);
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function displayValue(value: unknown, fallback = "-") {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function displayNumber(value: unknown, suffix = "") {
  const textValue = displayValue(value, "0");
  return suffix ? `${textValue}${suffix}` : textValue;
}

type StaffPageCopy = ReturnType<typeof staffPageCopy>;

function staffPageCopy(lang: "de" | "ru") {
  if (lang === "de") {
    return {
      title: "Mitarbeitende",
      subtitle: "Verträge, Compliance, Verfügbarkeit und interne Mitarbeiterdaten.",
      newInternalEmployee: "Neue Mitarbeitende",
      refresh: "Aktualisieren",
      createAccountTitle: "Mitarbeiterkonto erstellen",
      createAccountDescription:
        "Interne Mitarbeitende können ein Benutzerkonto erhalten. Externe Auftragnehmer bleiben außerhalb der Benutzerverwaltung.",
      createAccountInUsers: "Konto in Benutzer erstellen",
      externalAccountBlocked: "Externe Auftragnehmer können nicht als Benutzerkonto erstellt werden.",
      createAccount: "Konto erstellen",
      createStaffProfile: "Profil erstellen",
      creating: "Wird erstellt...",
      employees: "Mitarbeitende",
      search: "Suchen",
      allStatuses: "Alle Status",
      allContractTypes: "Alle Vertragsarten",
      clearFilters: "Filter zurücksetzen",
      noEmployees: "Keine Mitarbeitenden gefunden.",
      save: "Speichern",
      saving: "Speichert...",
      coreData: "A. Kerndaten",
      status: "Status",
      contractType: "Vertragsart",
      employmentKind: "Intern / extern",
      userAccount: "Benutzerkonto",
      existsInUsers: "Existiert in Benutzer",
      noUserAccount: "Kein Benutzerkonto",
      noStatus: "kein Status",
      notSet: "Nicht gesetzt",
      name: "Name",
      email: "E-Mail",
      temporaryPassword: "Temporäres Passwort",
      role: "Rolle",
      loadFailed: "Laden fehlgeschlagen",
      saveFailed: "Speichern fehlgeschlagen",
      uploadSavedNotice: "Dokument hochgeladen. Speichern Sie das Profil, um den Link zu behalten.",
      uploadFailed: "Hochladen fehlgeschlagen",
      downloadFailed: "Herunterladen fehlgeschlagen",
      profileSaved: "Profil gespeichert",
      internalOnlyError: "Nur interne Mitarbeitende können als Benutzerkonto erstellt werden.",
      nameRequired: "Name ist erforderlich.",
      nameEmailRequired: "Name und E-Mail sind für Benutzerkonten erforderlich.",
      passwordLengthError: "Das Passwort muss mindestens 8 Zeichen enthalten.",
      accountCreated: "Mitarbeiterkonto erstellt",
      staffProfileCreated: "Mitarbeiterprofil erstellt",
      createAccountFailed: "Mitarbeiterkonto konnte nicht erstellt werden",
      createStaffProfileFailed: "Mitarbeiterprofil konnte nicht erstellt werden",
      roles: {
        interpreter: "Mitarbeiter",
        teamlead_interpreter: "Teamlead Mitarbeiter",
        external_staff: "Externe Mitarbeitende",
        standalone_staff: "Mitarbeiterprofil",
      },
      statuses: {
        active: "Aktiv",
        vacation: "Urlaub",
        sick: "Krank",
        training: "Training",
        blocked: "Gesperrt",
        terminated: "Beendet",
      },
      contractTypes: {
        employee: "Mitarbeiter",
        freelancer: "Freelancer",
        hourly: "Stundenbasis",
      },
      employmentKinds: {
        internal: "Intern",
        external: "Extern",
      },
      profile: {
        gender: "Geschlecht",
        birthDate: "Geburtsdatum",
        contractDates: "Vertragsbeginn / -ende",
        contactAvailability: "B. Kontakt und Verfügbarkeit",
        phone: "Telefon",
        emailSecurity: "E-Mail-Sicherheit",
        secureEmailVerified: "Sichere E-Mail bestätigt",
        address: "Adresse",
        emergencyContact: "Notfallkontakt",
        workCountries: "Einsatzländer",
        workLocations: "Einsatzorte",
        qualificationLanguages: "C. Qualifikation und Sprachen",
        structuredLanguages: "Strukturierte Sprachen",
        addLanguage: "Sprache hinzufügen",
        loadingLanguages: "Sprachen werden geladen...",
        languageCode: "Code",
        languageLabel: "Bezeichnung",
        cefr: "GER",
        notSet: "Nicht gesetzt",
        proficiency: "Niveau",
        native: "Muttersprache",
        fluent: "Fließend",
        working: "Arbeitssicher",
        basic: "Basis",
        unknown: "Unbekannt",
        specialization: "Spezialisierung",
        remove: "Entfernen",
        noLanguages: "Noch keine strukturierten Sprachen.",
        certificates: "Zertifikate",
        medicalKnowledge: "Medizinisches Wissen",
        trainingHistory: "Schulungshistorie",
        structuredCredentials: "Strukturierte Nachweise",
        addCredential: "Nachweis hinzufügen",
        type: "Typ",
        certificate: "Zertifikat",
        swornInterpreter: "Vereidigter Dolmetscher",
        medicalTranslation: "Medizinische Übersetzung",
        training: "Schulung",
        title: "Titel",
        issuer: "Aussteller",
        validDates: "Gültigkeitsdaten",
        document: "Dokument",
        downloadDocument: "Dokument herunterladen",
        notes: "Notizen",
        noCredentials: "Noch keine strukturierten Nachweise.",
        legalCompliance: "D. Rechtliches und Compliance",
        confidentiality: "Vertraulichkeit",
        signedAt: "Unterzeichnet am",
        signed: "Unterzeichnet",
        missing: "Fehlt",
        avvWorkContract: "AVV / Arbeitsvertrag",
        pending: "Ausstehend",
        avvSignedAt: "AVV unterzeichnet am",
        avvDocument: "AVV-Dokument",
        gdprTraining: "DSGVO-Schulung",
        workPermitValidUntil: "Arbeitserlaubnis gültig bis",
        financeAccess: "E. Finanzen und Zugriff",
        hourlyRate: "Stundensatz",
        salaryClass: "Gehaltsklasse",
        billingStatus: "Abrechnungsstatus",
        unpaid: "Offen",
        paid: "Bezahlt",
        overdue: "Überfällig",
        bankDetails: "Bankdaten",
        taxNumber: "Steuernummer",
        ustIdnr: "USt-IdNr.",
        accessLevel: "Zugriffsstufe",
        appointmentOnly: "Nur Termine",
        medicalDataShared: "Medizinische Daten freigegeben",
        fullAccess: "Voller Zugriff",
        autoBlockPolicy: "Automatische Sperre",
        immediate: "Sofort",
        afterOneHour: "Nach einer Stunde",
        performanceWorkload: "F. Leistung und Live-Auslastung",
        weeklyCapacityHours: "Wochenkapazität (Stunden)",
        bookedThisWeek: "Diese Woche gebucht",
        capacity: "Kapazität",
        utilization: "Auslastung",
        averageScore: "Durchschnittsbewertung",
        feedback: "Feedback",
        next30Days: "Nächste 30 Tage",
        activeTasks: "Aktive Aufgaben",
        noActiveTasks: "Keine aktiven Aufgaben",
        overdueTasks: "Überfällige Aufgaben",
        loadingWorkload: "Auslastung wird geladen...",
        assignedPatients: "Zugewiesene Patienten",
        noAssignedPatients: "Keine zugewiesenen Patienten",
        appointments: "Termine",
        next: "nächster",
        upcomingAppointments: "Kommende Termine",
        noUpcomingAppointments: "Keine kommenden Termine",
        due: "fällig",
        recentReports: "Aktuelle Berichte",
        noReports: "Keine Berichte",
        billing: "Abrechnung",
        billingLines: "Abrechnungspositionen",
        noBillingLines: "Keine synchronisierten Abrechnungspositionen",
        internalManagement: "I. Internes Management",
        internalNotes: "Interne Notizen",
        equipment: "Ausstattung",
        retentionDeleteAt: "Löschdatum",
        erasureRequestStatus: "Löschanfrage-Status",
        loadingProfiles: "Mitarbeiterprofile werden geladen...",
      },
    };
  }

  return {
    title: "Сотрудники",
    subtitle: "Договоры, комплаенс, доступность и данные внутренних сотрудников.",
    newInternalEmployee: "Новый сотрудник",
    refresh: "Обновить",
    createAccountTitle: "Создать аккаунт сотрудника",
    createAccountDescription:
      "Внутренним сотрудникам можно создать аккаунт пользователя. Внешние подрядчики остаются вне Users.",
    createAccountInUsers: "Создать аккаунт в Users",
    externalAccountBlocked: "Внешних подрядчиков нельзя создавать как аккаунты пользователей.",
    createAccount: "Создать аккаунт",
    createStaffProfile: "Создать профиль",
    creating: "Создаётся...",
    employees: "Сотрудники",
    search: "Поиск",
    allStatuses: "Все статусы",
    allContractTypes: "Все типы договора",
    clearFilters: "Сбросить фильтры",
    noEmployees: "Сотрудники не найдены.",
    save: "Сохранить",
    saving: "Сохранение...",
    coreData: "A. Основные данные",
    status: "Статус",
    contractType: "Тип договора",
    employmentKind: "Внутренний / внешний",
    userAccount: "Аккаунт пользователя",
    existsInUsers: "Есть в пользователях",
    noUserAccount: "Без аккаунта пользователя",
    noStatus: "нет статуса",
    notSet: "Не указано",
    name: "Имя",
    email: "Электронная почта",
    temporaryPassword: "Временный пароль",
    role: "Роль",
    loadFailed: "Не удалось загрузить",
    saveFailed: "Не удалось сохранить",
    uploadSavedNotice: "Документ загружен. Сохраните профиль, чтобы закрепить ссылку.",
    uploadFailed: "Не удалось загрузить документ",
    downloadFailed: "Не удалось скачать документ",
    profileSaved: "Профиль сохранён",
    internalOnlyError: "Только внутренним сотрудникам можно создать аккаунт пользователя.",
    nameRequired: "Имя обязательно.",
    nameEmailRequired: "Имя и электронная почта обязательны для аккаунта пользователя.",
    passwordLengthError: "Пароль должен содержать минимум 8 символов.",
    accountCreated: "Аккаунт сотрудника создан",
    staffProfileCreated: "Профиль сотрудника создан",
    createAccountFailed: "Не удалось создать аккаунт сотрудника",
    createStaffProfileFailed: "Не удалось создать профиль сотрудника",
    roles: {
      interpreter: "Сотрудник",
      teamlead_interpreter: "Тимлид сотрудников",
      external_staff: "Внешний сотрудник",
      standalone_staff: "Профиль сотрудника",
    },
    statuses: {
      active: "Активен",
      vacation: "Отпуск",
      sick: "Больничный",
      training: "Обучение",
      blocked: "Заблокирован",
      terminated: "Уволен",
    },
    contractTypes: {
      employee: "Сотрудник",
      freelancer: "Фрилансер",
      hourly: "Почасовой",
    },
    employmentKinds: {
      internal: "Внутренний",
      external: "Внешний",
    },
    profile: {
      gender: "Пол",
      birthDate: "Дата рождения",
      contractDates: "Начало / конец договора",
      contactAvailability: "B. Контакты и доступность",
      phone: "Телефон",
      emailSecurity: "Безопасность электронной почты",
      secureEmailVerified: "Защищённая электронная почта подтверждена",
      address: "Адрес",
      emergencyContact: "Экстренный контакт",
      workCountries: "Страны работы",
      workLocations: "Локации работы",
      qualificationLanguages: "C. Квалификация и языки",
      structuredLanguages: "Структурированные языки",
      addLanguage: "Добавить язык",
      loadingLanguages: "Языки загружаются...",
      languageCode: "Код",
      languageLabel: "Название",
      cefr: "CEFR",
      notSet: "Не указано",
      proficiency: "Уровень",
      native: "Родной",
      fluent: "Свободно",
      working: "Рабочий",
      basic: "Базовый",
      unknown: "Неизвестно",
      specialization: "Специализация",
      remove: "Удалить",
      noLanguages: "Структурированные языки ещё не добавлены.",
      certificates: "Сертификаты",
      medicalKnowledge: "Медицинские знания",
      trainingHistory: "История обучения",
      structuredCredentials: "Структурированные документы",
      addCredential: "Добавить документ",
      type: "Тип",
      certificate: "Сертификат",
      swornInterpreter: "Присяжный переводчик",
      medicalTranslation: "Медицинский перевод",
      training: "Обучение",
      title: "Название",
      issuer: "Кем выдано",
      validDates: "Даты действия",
      document: "Документ",
      downloadDocument: "Скачать документ",
      notes: "Заметки",
      noCredentials: "Структурированные документы ещё не добавлены.",
      legalCompliance: "D. Юридические данные и комплаенс",
      confidentiality: "Конфиденциальность",
      signedAt: "Подписано",
      signed: "Подписано",
      missing: "Отсутствует",
      avvWorkContract: "AVV / трудовой договор",
      pending: "Ожидает",
      avvSignedAt: "AVV подписан",
      avvDocument: "Документ AVV",
      gdprTraining: "Обучение GDPR",
      workPermitValidUntil: "Разрешение на работу до",
      financeAccess: "E. Финансы и доступ",
      hourlyRate: "Почасовая ставка",
      salaryClass: "Класс оплаты",
      billingStatus: "Статус оплаты",
      unpaid: "Не оплачено",
      paid: "Оплачено",
      overdue: "Просрочено",
      bankDetails: "Банковские данные",
      taxNumber: "Налоговый номер",
      ustIdnr: "USt-IdNr.",
      accessLevel: "Уровень доступа",
      appointmentOnly: "Только приёмы",
      medicalDataShared: "Медицинские данные доступны",
      fullAccess: "Полный доступ",
      autoBlockPolicy: "Автоблокировка",
      immediate: "Сразу",
      afterOneHour: "Через час",
      performanceWorkload: "F. Производительность и текущая нагрузка",
      weeklyCapacityHours: "Недельная ёмкость (часы)",
      bookedThisWeek: "Забронировано на этой неделе",
      capacity: "Ёмкость",
      utilization: "Загрузка",
      averageScore: "Средняя оценка",
      feedback: "Отзывы",
      next30Days: "Следующие 30 дней",
      activeTasks: "Активные задачи",
      noActiveTasks: "Нет активных задач",
      overdueTasks: "Просроченные задачи",
      loadingWorkload: "Нагрузка загружается...",
      assignedPatients: "Привязанные пациенты",
      noAssignedPatients: "Нет привязанных пациентов",
      appointments: "приёмов",
      next: "следующий",
      upcomingAppointments: "Ближайшие приёмы",
      noUpcomingAppointments: "Нет ближайших приёмов",
      due: "срок",
      recentReports: "Последние отчёты",
      noReports: "Нет отчётов",
      billing: "биллинг",
      billingLines: "Строки биллинга",
      noBillingLines: "Нет синхронизированных строк биллинга",
      internalManagement: "I. Внутреннее управление",
      internalNotes: "Внутренние заметки",
      equipment: "Оборудование",
      retentionDeleteAt: "Дата удаления",
      erasureRequestStatus: "Статус запроса на удаление",
      loadingProfiles: "Профили сотрудников загружаются...",
    },
  };
}

function staffRoleLabel(role: string, copy: StaffPageCopy) {
  switch (role) {
    case "teamlead_interpreter":
      return copy.roles.teamlead_interpreter;
    case "interpreter":
      return copy.roles.interpreter;
    case "external_staff":
      return copy.roles.external_staff;
    case "standalone_staff":
      return copy.roles.standalone_staff;
    default:
      return role;
  }
}

function compactDate(value: unknown) {
  return typeof value === "string" && value ? value : "-";
}

function emptyCredential(): CredentialForm {
  return {
    credentialType: "certificate",
    title: "",
    issuer: "",
    issuedAt: "",
    expiresAt: "",
    documentUrl: "",
    documentId: "",
    documentName: "",
    notes: "",
  };
}

function emptyCreateInterpreterAccountForm(): CreateInterpreterAccountForm {
  return {
    name: "",
    email: "",
    password: "",
    role: "interpreter",
    status: "active",
    contractType: "employee",
    employmentKind: "internal",
    createUserAccount: true,
  };
}

function credentialsToForm(value: unknown): CredentialForm[] {
  return Array.isArray(value)
    ? value
        .map((item) => asProfile(item))
        .map((item) => ({
          credentialType: text(item.credentialType) || "certificate",
          title: text(item.title),
          issuer: text(item.issuer),
          issuedAt: text(item.issuedAt),
          expiresAt: text(item.expiresAt),
          documentUrl: text(item.documentUrl),
          documentId: text(item.documentId),
          documentName: text(item.documentName),
          notes: text(item.notes),
        }))
        .filter(
          (item) =>
            item.title || item.issuer || item.documentUrl || item.documentId,
        )
    : [];
}

function credentialsToProfile(credentials: CredentialForm[]) {
  return credentials
    .filter((credential) => credential.title.trim())
    .map((credential) => ({
      credentialType: credential.credentialType || "certificate",
      title: credential.title.trim(),
      issuer: credential.issuer.trim(),
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
      documentUrl: credential.documentUrl.trim(),
      documentId: credential.documentId,
      notes: credential.notes.trim(),
    }));
}

function profileToForm(profile: InterpreterProfile): InterpreterProfileForm {
  const contact = nested(profile, "contact");
  const compliance = nested(profile, "compliance");
  const finance = nested(profile, "finance");
  const access = nested(profile, "access");

  return {
    gender: text(profile.gender),
    birthDate: text(profile.birthDate),
    status: text(profile.status) || "active",
    contractType: text(profile.contractType),
    contractStartDate: text(profile.contractStartDate),
    contractEndDate: text(profile.contractEndDate),
    employmentKind: text(profile.employmentKind),
    phone: text(profile.phone) || text(contact.phone),
    emailSecure: bool(profile.emailSecure ?? contact.emailSecure),
    address: text(profile.address) || text(contact.address),
    emergencyContact:
      text(profile.emergencyContact) || text(contact.emergencyContact),
    workCountries: listText(profile.workCountries),
    workLocations: listText(profile.workLocations),
    languageProfile: text(profile.languageProfile),
    certificates: text(profile.certificates),
    credentials: credentialsToForm(profile.credentials),
    medicalKnowledge: text(profile.medicalKnowledge),
    trainingHistory: text(profile.trainingHistory),
    confidentialityStatus:
      text(profile.confidentialityStatus) ||
      text(compliance.confidentialityStatus),
    confidentialitySignedAt:
      text(profile.confidentialitySignedAt) ||
      text(compliance.confidentialitySignedAt),
    confidentialityDocumentUrl:
      text(profile.confidentialityDocumentUrl) ||
      text(compliance.confidentialityDocumentUrl),
    confidentialityDocumentId:
      text(profile.confidentialityDocumentId) ||
      text(compliance.confidentialityDocumentId),
    confidentialityDocumentName:
      text(profile.confidentialityDocumentName) ||
      text(compliance.confidentialityDocumentName),
    avvStatus: text(profile.avvStatus) || text(compliance.avvStatus),
    avvSignedAt: text(profile.avvSignedAt) || text(compliance.avvSignedAt),
    avvDocumentUrl:
      text(profile.avvDocumentUrl) || text(compliance.avvDocumentUrl),
    avvDocumentId: text(profile.avvDocumentId) || text(compliance.avvDocumentId),
    avvDocumentName:
      text(profile.avvDocumentName) || text(compliance.avvDocumentName),
    gdprTrainingAt:
      text(profile.gdprTrainingAt) || text(compliance.gdprTrainingAt),
    workPermitValidUntil: text(profile.workPermitValidUntil),
    hourlyRate: text(profile.hourlyRate) || text(finance.hourlyRate),
    salaryClass: text(profile.salaryClass) || text(finance.salaryClass),
    bankDetails: text(profile.bankDetails) || text(finance.bankDetails),
    taxNumber: text(profile.taxNumber) || text(finance.taxNumber),
    ustIdnr: text(profile.ustIdnr) || text(finance.ustIdnr),
    billingStatus: text(profile.billingStatus) || text(finance.billingStatus),
    weeklyCapacityHours: text(profile.weeklyCapacityHours),
    accessLevel: text(profile.accessLevel) || text(access.level),
    autoBlockPolicy:
      text(profile.autoBlockPolicy) || text(access.autoBlockPolicy),
    internalNotes: text(profile.internalNotes),
    equipment: listText(profile.equipment),
    retentionDeleteAt: text(profile.retentionDeleteAt),
    erasureRequestStatus: text(profile.erasureRequestStatus),
  };
}

function formToProfile(form: InterpreterProfileForm) {
  return {
    gender: form.gender,
    birthDate: form.birthDate,
    status: form.status,
    contractType: form.contractType,
    contractStartDate: form.contractStartDate,
    contractEndDate: form.contractEndDate,
    employmentKind: form.employmentKind,
    phone: form.phone,
    emailSecure: form.emailSecure,
    address: form.address,
    emergencyContact: form.emergencyContact,
    workCountries: parseList(form.workCountries),
    workLocations: parseList(form.workLocations),
    languageProfile: form.languageProfile,
    certificates: form.certificates,
    credentials: credentialsToProfile(form.credentials),
    medicalKnowledge: form.medicalKnowledge,
    trainingHistory: form.trainingHistory,
    compliance: {
      confidentialityStatus: form.confidentialityStatus,
      confidentialitySignedAt: form.confidentialitySignedAt,
      confidentialityDocumentUrl: form.confidentialityDocumentUrl,
      confidentialityDocumentId: form.confidentialityDocumentId,
      avvStatus: form.avvStatus,
      avvSignedAt: form.avvSignedAt,
      avvDocumentUrl: form.avvDocumentUrl,
      avvDocumentId: form.avvDocumentId,
      gdprTrainingAt: form.gdprTrainingAt,
    },
    workPermitValidUntil: form.workPermitValidUntil,
    finance: {
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
      salaryClass: form.salaryClass,
      bankDetails: form.bankDetails,
      taxNumber: form.taxNumber,
      ustIdnr: form.ustIdnr,
      billingStatus: form.billingStatus,
    },
    weeklyCapacityHours: form.weeklyCapacityHours
      ? Number(form.weeklyCapacityHours)
      : null,
    access: {
      level: form.accessLevel,
      autoBlockPolicy: form.autoBlockPolicy,
    },
    internalNotes: form.internalNotes,
    equipment: parseList(form.equipment),
    retentionDeleteAt: form.retentionDeleteAt,
    erasureRequestStatus: form.erasureRequestStatus,
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block text-base font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

function OperationsList({
  title,
  items,
  empty,
  renderItem,
}: {
  title: string;
  items: Record<string, unknown>[];
  empty: string;
  renderItem: (item: Record<string, unknown>) => ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-2">
        {items.length > 0 ? (
          items.slice(0, 4).map((item, index) => (
            <div
              key={text(item.id) || `${title}-${index}`}
              className="rounded-md bg-muted/35 px-3 py-2 text-xs text-foreground"
            >
              {renderItem(item)}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

export function InterpretersPage() {
  const { lang } = useLang();
  const copy = useMemo(() => staffPageCopy(lang), [lang]);
  const profileCopy = copy.profile;
  const { interpreterId } = useParams();
  const [items, setItems] = useState<InterpreterRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operations, setOperations] = useState<InterpreterOperations | null>(
    null,
  );
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [languages, setLanguages] = useState<InterpreterLanguageForm[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [uploadingDocumentKey, setUploadingDocumentKey] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [contractFilter, setContractFilter] = useState("");
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [createAccountSaving, setCreateAccountSaving] = useState(false);
  const [createAccountError, setCreateAccountError] = useState("");
  const [createAccountForm, setCreateAccountForm] =
    useState<CreateInterpreterAccountForm>(() =>
      emptyCreateInterpreterAccountForm(),
    );
  const deferredSearch = useDeferredValue(search);
  const filtersActive =
    search.trim() !== "" || statusFilter !== "" || contractFilter !== "";
  const createUserAccountAllowed =
    canCreateInterpreterUserAccount(createAccountForm);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );
  const [form, setForm] = useState<InterpreterProfileForm>(() =>
    profileToForm({}),
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<InterpreterRecord[]>(
        buildInterpreterListPath({
          search: deferredSearch,
          status: statusFilter,
          contractType: contractFilter,
        }),
      );
      setItems(data);
      setSelectedId((current) => {
        if (interpreterId && data.some((item) => item.id === interpreterId)) {
          return interpreterId;
        }
        if (data.some((item) => item.id === current)) {
          return current;
        }
        return data[0]?.id || "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [contractFilter, copy.loadFailed, deferredSearch, interpreterId, statusFilter]);

  const loadOperations = useCallback(async (id: string) => {
    setOperationsLoading(true);
    try {
      const data = await apiFetch<InterpreterOperations>(
        `/interpreters/${id}/profile/operations`,
      );
      setOperations(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setOperationsLoading(false);
    }
  }, [copy.loadFailed]);

  const loadLanguages = useCallback(async (id: string) => {
    setLanguagesLoading(true);
    try {
      const data = await apiFetch<InterpreterLanguageRecord[]>(
        buildInterpreterLanguagesPath(id),
      );
      setLanguages(
        data
          .filter((item) => item.is_active)
          .map(interpreterLanguageRecordToForm),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
      setLanguages([]);
    } finally {
      setLanguagesLoading(false);
    }
  }, [copy.loadFailed]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (selected) {
      setForm(profileToForm(selected.profile));
      setNotice("");
      void loadOperations(selected.id);
      void loadLanguages(selected.id);
    } else {
      setOperations(null);
      setLanguages([]);
    }
  }, [loadLanguages, loadOperations, selected]);

  function patchForm(patch: Partial<InterpreterProfileForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function patchCreateAccountForm(patch: Partial<CreateInterpreterAccountForm>) {
    setCreateAccountForm((current) =>
      normalizeInterpreterAccountDraft({ ...current, ...patch }),
    );
  }

  function closeCreateAccountForm() {
    setCreateAccountOpen(false);
    setCreateAccountError("");
    setCreateAccountForm(emptyCreateInterpreterAccountForm());
  }

  function patchCredential(index: number, patch: Partial<CredentialForm>) {
    setForm((current) => ({
      ...current,
      credentials: current.credentials.map((credential, itemIndex) =>
        itemIndex === index ? { ...credential, ...patch } : credential,
      ),
    }));
  }

  function addCredential() {
    setForm((current) => ({
      ...current,
      credentials: [...current.credentials, emptyCredential()],
    }));
  }

  function removeCredential(index: number) {
    setForm((current) => ({
      ...current,
      credentials: current.credentials.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function patchLanguage(index: number, patch: Partial<InterpreterLanguageForm>) {
    setLanguages((current) =>
      current.map((language, itemIndex) =>
        itemIndex === index ? { ...language, ...patch } : language,
      ),
    );
  }

  function addLanguage() {
    setLanguages((current) => [...current, emptyInterpreterLanguage()]);
  }

  function removeLanguage(index: number) {
    setLanguages((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function uploadProfileDocument(
    documentKind: string,
    file: File | null | undefined,
    onUploaded: (document: UploadedProfileDocument) => void,
    uploadKey: string,
  ) {
    if (!selected || !file) return;
    setUploadingDocumentKey(uploadKey);
    setError("");
    setNotice("");
    try {
      const formData = new FormData();
      formData.append("documentKind", documentKind);
      formData.append("file", file);
      const document = await apiFetch<UploadedProfileDocument>(
        buildInterpreterProfileDocumentsPath(selected.id),
        {
          method: "POST",
          body: formData,
          timeoutMs: 60_000,
        },
      );
      onUploaded(document);
      setNotice(copy.uploadSavedNotice);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : copy.uploadFailed,
      );
    } finally {
      setUploadingDocumentKey("");
    }
  }

  async function downloadProfileDocument(documentId: string, fallbackName: string) {
    if (!selected || !documentId) return;
    setError("");
    try {
      await downloadApiFile(
        buildInterpreterProfileDocumentDownloadPath(selected.id, documentId),
        fallbackName || "interpreter-profile-document",
        { timeoutMs: 60_000 },
      );
    } catch (downloadError) {
      setError(
        downloadError instanceof Error ? downloadError.message : copy.downloadFailed,
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ profile: InterpreterProfile }>(
        `/interpreters/${selected.id}/profile`,
        {
          method: "PUT",
          body: JSON.stringify(formToProfile(form)),
        },
      );
      setItems((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, profile: result.profile } : item,
        ),
      );
      await apiFetch(buildInterpreterLanguagesPath(selected.id), {
        method: "POST",
        body: JSON.stringify({
          languages: interpreterLanguagesToPayload(languages),
        }),
      });
      await loadLanguages(selected.id);
      await loadOperations(selected.id);
      setNotice(copy.profileSaved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateInterpreterAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountDraft = normalizeInterpreterAccountDraft(createAccountForm);
    const shouldCreateUserAccount =
      accountDraft.createUserAccount && canCreateInterpreterUserAccount(accountDraft);
    if (!accountDraft.name.trim()) {
      setCreateAccountError(copy.nameRequired);
      return;
    }
    if (shouldCreateUserAccount && !accountDraft.email.trim()) {
      setCreateAccountError(copy.nameEmailRequired);
      return;
    }
    if (shouldCreateUserAccount && accountDraft.password.length < 8) {
      setCreateAccountError(copy.passwordLengthError);
      return;
    }

    setCreateAccountSaving(true);
    setCreateAccountError("");
    setError("");
    setNotice("");
    try {
      const profile = {
        status: accountDraft.status,
        contractType: accountDraft.contractType || "employee",
        employmentKind: accountDraft.employmentKind,
        access: {
          level: "appointment_only",
          autoBlockPolicy: "manual",
        },
      };

      if (!shouldCreateUserAccount) {
        const created = await apiFetch<InterpreterRecord>("/interpreters", {
          method: "POST",
          body: JSON.stringify({
            name: accountDraft.name.trim(),
            email: accountDraft.email.trim() || null,
            profile,
          }),
        });
        setItems((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ]);
        setSelectedId(created.id);
        closeCreateAccountForm();
        setNotice(copy.staffProfileCreated);
        return;
      }

      const created = await apiFetch<CreatedInterpreterUser>("/users", {
        method: "POST",
        body: JSON.stringify({
          name: accountDraft.name.trim(),
          email: accountDraft.email.trim(),
          password: accountDraft.password,
          role: accountDraft.role,
        }),
      });
      const result = await apiFetch<{ profile: InterpreterProfile }>(
        `/interpreters/${created.id}/profile`,
        {
          method: "PUT",
          body: JSON.stringify(profile),
        },
      );
      setItems((current) => [
        {
          id: created.id,
          name: created.name,
          email: created.email,
          role: created.role,
          is_active: created.is_active,
          profile_source: "user",
          profile: result.profile,
          profile_updated_at: null,
        },
        ...current.filter((item) => item.id !== created.id),
      ]);
      setSelectedId(created.id);
      closeCreateAccountForm();
      setNotice(copy.accountCreated);
    } catch (createError) {
      setCreateAccountError(
        createError instanceof Error
          ? createError.message
          : shouldCreateUserAccount
            ? copy.createAccountFailed
            : copy.createStaffProfileFailed,
      );
    } finally {
      setCreateAccountSaving(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">
              {copy.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateAccountOpen(true)}
	            >
	              <Plus className="size-4" />
	              {copy.newInternalEmployee}
	            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadItems()}
              disabled={loading}
	            >
	              <RefreshCcw className="size-4" />
	              {copy.refresh}
	            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {createAccountOpen ? (
          <form
            onSubmit={handleCreateInterpreterAccount}
            className="space-y-4 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <h2 className="text-sm font-semibold text-foreground">
	                  {copy.createAccountTitle}
	                </h2>
	                <p className="mt-1 text-xs text-muted-foreground">
	                  {copy.createAccountDescription}
	                </p>
	              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-8 px-2"
                onClick={closeCreateAccountForm}
              >
                <X className="size-4" />
              </Button>
            </div>
            {createAccountError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createAccountError}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
	              <Field label={copy.name}>
                <Input
                  className={inputClass}
                  value={createAccountForm.name}
                  onChange={(event) =>
                    patchCreateAccountForm({ name: event.target.value })
                  }
                  required
                />
              </Field>
	              <Field label={copy.email}>
                <Input
                  type="email"
                  className={inputClass}
                  value={createAccountForm.email}
                  onChange={(event) =>
                    patchCreateAccountForm({ email: event.target.value })
                  }
                  required={createAccountForm.createUserAccount}
                />
              </Field>
	              <Field label={copy.temporaryPassword}>
                <Input
                  type="password"
                  className={inputClass}
                  value={createAccountForm.password}
                  disabled={!createAccountForm.createUserAccount}
                  onChange={(event) =>
                    patchCreateAccountForm({ password: event.target.value })
                  }
                  required={createAccountForm.createUserAccount}
                />
              </Field>
	              <Field label={copy.role}>
                <select
                  className={selectClass}
                  value={createAccountForm.role}
                  disabled={!createAccountForm.createUserAccount}
                  onChange={(event) =>
                    patchCreateAccountForm({
                      role: event.target.value as CreateInterpreterAccountForm["role"],
                    })
                  }
                >
	                  <option value="interpreter">{copy.roles.interpreter}</option>
	                  <option value="teamlead_interpreter">{copy.roles.teamlead_interpreter}</option>
	                </select>
	              </Field>
	              <Field label={copy.contractType}>
                <select
                  className={selectClass}
                  value={createAccountForm.contractType}
                  onChange={(event) =>
                    patchCreateAccountForm({ contractType: event.target.value })
                  }
                >
	                  <option value="employee">{copy.contractTypes.employee}</option>
	                  <option value="freelancer">{copy.contractTypes.freelancer}</option>
	                  <option value="hourly">{copy.contractTypes.hourly}</option>
	                </select>
	              </Field>
	              <Field label={copy.employmentKind}>
                <select
                  className={selectClass}
                  value={createAccountForm.employmentKind}
                  onChange={(event) =>
                    patchCreateAccountForm({
                      employmentKind: event.target.value,
                    })
                  }
                >
	                  <option value="internal">{copy.employmentKinds.internal}</option>
	                  <option value="external">{copy.employmentKinds.external}</option>
	                </select>
	              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={createAccountForm.createUserAccount}
                  disabled={!createUserAccountAllowed}
                  onChange={(event) =>
                    patchCreateAccountForm({
                      createUserAccount: event.target.checked,
                    })
                  }
                />
	                {copy.createAccountInUsers}
	              </label>
	              {!createUserAccountAllowed ? (
	                <p className="text-xs text-amber-700">
	                  {copy.externalAccountBlocked}
	                </p>
	              ) : null}
              <Button
                type="submit"
                disabled={createAccountSaving}
	              >
	                <Plus className="size-4" />
	                {createAccountSaving
                    ? copy.creating
                    : createAccountForm.createUserAccount
                      ? copy.createAccount
                      : copy.createStaffProfile}
	              </Button>
            </div>
          </form>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
	          <aside className="space-y-3">
	            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
	              <UsersRound className="size-4 text-primary" />
	              {copy.employees}
	            </div>
            <div className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className={`${inputClass} w-full pl-8`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
	                  placeholder={copy.search}
	                />
	              </div>
              <select
                className={selectClass}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
	                <option value="">{copy.allStatuses}</option>
	                <option value="active">{copy.statuses.active}</option>
	                <option value="vacation">{copy.statuses.vacation}</option>
	                <option value="sick">{copy.statuses.sick}</option>
	                <option value="training">{copy.statuses.training}</option>
	                <option value="blocked">{copy.statuses.blocked}</option>
	                <option value="terminated">{copy.statuses.terminated}</option>
	              </select>
              <select
                className={selectClass}
                value={contractFilter}
                onChange={(event) => setContractFilter(event.target.value)}
              >
	                <option value="">{copy.allContractTypes}</option>
	                <option value="employee">{copy.contractTypes.employee}</option>
	                <option value="freelancer">{copy.contractTypes.freelancer}</option>
	                <option value="hourly">{copy.contractTypes.hourly}</option>
	              </select>
              {filtersActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 w-full justify-start px-2 text-xs"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setContractFilter("");
                  }}
                >
	                  <X className="size-3.5" />
	                  {copy.clearFilters}
	                </Button>
              ) : null}
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                    selected?.id === item.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
	                    {staffRoleLabel(item.role, copy)} ·{" "}
	                    {text(item.profile.status) || copy.noStatus}
	                  </span>
                </button>
              ))}
              {!loading && items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
	                  {copy.noEmployees}
	                </div>
              ) : null}
            </div>
          </aside>

          {selected ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-6 rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">
                      {selected.name}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.email} · {selected.id}
                  </p>
                </div>
	                <Button type="submit" disabled={saving}>
	                  <Save className="size-4" />
	                  {saving ? copy.saving : copy.save}
	                </Button>
	              </div>

	              <Section title={copy.coreData}>
	                <div className="grid gap-3 md:grid-cols-3">
	                  <Field label={copy.status}>
                    <select
                      className={selectClass}
                      value={form.status}
                      onChange={(event) => patchForm({ status: event.target.value })}
                    >
	                      <option value="active">{copy.statuses.active}</option>
	                      <option value="vacation">{copy.statuses.vacation}</option>
	                      <option value="sick">{copy.statuses.sick}</option>
	                      <option value="training">{copy.statuses.training}</option>
	                      <option value="blocked">{copy.statuses.blocked}</option>
	                      <option value="terminated">{copy.statuses.terminated}</option>
	                    </select>
	                  </Field>
	                  <Field label={copy.contractType}>
                    <select
                      className={selectClass}
                      value={form.contractType}
                      onChange={(event) =>
                        patchForm({ contractType: event.target.value })
                      }
                    >
	                      <option value="">{copy.notSet}</option>
	                      <option value="employee">{copy.contractTypes.employee}</option>
	                      <option value="freelancer">{copy.contractTypes.freelancer}</option>
	                      <option value="hourly">{copy.contractTypes.hourly}</option>
	                    </select>
	                  </Field>
	                  <Field label={copy.employmentKind}>
                    <select
                      className={selectClass}
                      value={form.employmentKind}
                      onChange={(event) =>
                        patchForm({ employmentKind: event.target.value })
                      }
                    >
	                      <option value="">{copy.notSet}</option>
	                      <option value="internal">{copy.employmentKinds.internal}</option>
	                      <option value="external">{copy.employmentKinds.external}</option>
	                    </select>
	                  </Field>
	                  <Field label={copy.userAccount}>
                    <div className="flex min-h-9 flex-col justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={selected.profile_source !== "standalone"}
                          readOnly
                          disabled
                        />
	                        {selected.profile_source !== "standalone"
                          ? copy.existsInUsers
                          : form.employmentKind === "external"
                            ? copy.externalAccountBlocked
                            : copy.noUserAccount}
	                      </label>
	                      {form.employmentKind === "external" &&
                        selected.profile_source !== "standalone" ? (
	                        <span className="text-xs text-amber-700">
	                          {copy.externalAccountBlocked}
	                        </span>
	                      ) : null}
                    </div>
                  </Field>
                  <Field label={profileCopy.gender}>
                    <Input
                      className={inputClass}
                      value={form.gender}
                      onChange={(event) => patchForm({ gender: event.target.value })}
                    />
                  </Field>
                  <Field label={profileCopy.birthDate}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.birthDate}
                      onChange={(event) =>
                        patchForm({ birthDate: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.contractDates}>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="date"
                        className={inputClass}
                        value={form.contractStartDate}
                        onChange={(event) =>
                          patchForm({ contractStartDate: event.target.value })
                        }
                      />
                      <Input
                        type="date"
                        className={inputClass}
                        value={form.contractEndDate}
                        onChange={(event) =>
                          patchForm({ contractEndDate: event.target.value })
                        }
                      />
                    </div>
                  </Field>
                </div>
              </Section>

              <Section title={profileCopy.contactAvailability}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={profileCopy.phone}>
                    <Input
                      className={inputClass}
                      value={form.phone}
                      onChange={(event) => patchForm({ phone: event.target.value })}
                    />
                  </Field>
                  <Field label={profileCopy.emailSecurity}>
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.emailSecure}
                        onChange={(event) =>
                          patchForm({ emailSecure: event.target.checked })
                        }
                      />
                      {profileCopy.secureEmailVerified}
                    </label>
                  </Field>
                  <Field label={profileCopy.address}>
                    <Input
                      className={inputClass}
                      value={form.address}
                      onChange={(event) => patchForm({ address: event.target.value })}
                    />
                  </Field>
                  <Field label={profileCopy.emergencyContact}>
                    <Input
                      className={inputClass}
                      value={form.emergencyContact}
                      onChange={(event) =>
                        patchForm({ emergencyContact: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.workCountries}>
                    <Input
                      className={inputClass}
                      value={form.workCountries}
                      onChange={(event) =>
                        patchForm({ workCountries: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.workLocations}>
                    <Input
                      className={inputClass}
                      value={form.workLocations}
                      onChange={(event) =>
                        patchForm({ workLocations: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section title={profileCopy.qualificationLanguages}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {profileCopy.structuredLanguages}
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={addLanguage}
                    >
                      <Plus className="size-3.5" />
                      {profileCopy.addLanguage}
                    </Button>
                  </div>
                  {languagesLoading ? (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      {profileCopy.loadingLanguages}
                    </p>
                  ) : languages.length > 0 ? (
                    languages.map((language, index) => (
                      <div
                        key={index}
                        className="grid gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-[minmax(80px,0.7fr)_minmax(0,1.1fr)_minmax(90px,0.7fr)_minmax(120px,0.9fr)_minmax(0,1.2fr)_auto]"
                      >
                        <Field label={profileCopy.languageCode}>
                          <Input
                            className={inputClass}
                            value={language.languageCode}
                            onChange={(event) =>
                              patchLanguage(index, {
                                languageCode: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label={profileCopy.languageLabel}>
                          <Input
                            className={inputClass}
                            value={language.languageLabel}
                            onChange={(event) =>
                              patchLanguage(index, {
                                languageLabel: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label={profileCopy.cefr}>
                          <select
                            className={selectClass}
                            value={language.cefrLevel}
                            onChange={(event) =>
                              patchLanguage(index, {
                                cefrLevel: event.target.value,
                              })
                            }
                          >
                            <option value="">{profileCopy.notSet}</option>
                            <option value="A1">A1</option>
                            <option value="A2">A2</option>
                            <option value="B1">B1</option>
                            <option value="B2">B2</option>
                            <option value="C1">C1</option>
                            <option value="C2">C2</option>
                          </select>
                        </Field>
                        <Field label={profileCopy.proficiency}>
                          <select
                            className={selectClass}
                            value={language.proficiency}
                            onChange={(event) =>
                              patchLanguage(index, {
                                proficiency: event.target.value,
                              })
                            }
                          >
                            <option value="native">{profileCopy.native}</option>
                            <option value="fluent">{profileCopy.fluent}</option>
                            <option value="working">{profileCopy.working}</option>
                            <option value="basic">{profileCopy.basic}</option>
                            <option value="unknown">{profileCopy.unknown}</option>
                          </select>
                        </Field>
                        <Field label={profileCopy.specialization}>
                          <Input
                            className={inputClass}
                            value={language.specialization}
                            onChange={(event) =>
                              patchLanguage(index, {
                                specialization: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 px-2 text-xs"
                            onClick={() => removeLanguage(index)}
                          >
                            <Trash2 className="size-3.5" />
                            {profileCopy.remove}
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      {profileCopy.noLanguages}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={profileCopy.certificates}>
                    <textarea
                      className={textareaClass}
                      value={form.certificates}
                      onChange={(event) =>
                        patchForm({ certificates: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.medicalKnowledge}>
                    <Input
                      className={inputClass}
                      value={form.medicalKnowledge}
                      onChange={(event) =>
                        patchForm({ medicalKnowledge: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.trainingHistory}>
                    <Input
                      className={inputClass}
                      value={form.trainingHistory}
                      onChange={(event) =>
                        patchForm({ trainingHistory: event.target.value })
                      }
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {profileCopy.structuredCredentials}
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={addCredential}
                    >
                      <Plus className="size-3.5" />
                      {profileCopy.addCredential}
                    </Button>
                  </div>
                  {form.credentials.length > 0 ? (
                    form.credentials.map((credential, index) => (
                      <div
                        key={index}
                        className="grid gap-3 border-t border-border pt-3 md:grid-cols-4"
                      >
                        <Field label={profileCopy.type}>
                          <select
                            className={selectClass}
                            value={credential.credentialType}
                            onChange={(event) =>
                              patchCredential(index, {
                                credentialType: event.target.value,
                              })
                            }
                          >
                            <option value="certificate">{profileCopy.certificate}</option>
                            <option value="sworn_interpreter">
                              {profileCopy.swornInterpreter}
                            </option>
                            <option value="medical_translation">
                              {profileCopy.medicalTranslation}
                            </option>
                            <option value="training">{profileCopy.training}</option>
                          </select>
                        </Field>
                        <Field label={profileCopy.title}>
                          <Input
                            className={inputClass}
                            value={credential.title}
                            onChange={(event) =>
                              patchCredential(index, {
                                title: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label={profileCopy.issuer}>
                          <Input
                            className={inputClass}
                            value={credential.issuer}
                            onChange={(event) =>
                              patchCredential(index, {
                                issuer: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label={profileCopy.validDates}>
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              type="date"
                              className={inputClass}
                              value={credential.issuedAt}
                              onChange={(event) =>
                                patchCredential(index, {
                                  issuedAt: event.target.value,
                                })
                              }
                            />
                            <Input
                              type="date"
                              className={inputClass}
                              value={credential.expiresAt}
                              onChange={(event) =>
                                patchCredential(index, {
                                  expiresAt: event.target.value,
                                })
                              }
                            />
                          </div>
                        </Field>
                        <Field label={profileCopy.document}>
                          <div className="grid gap-2">
                            {credential.documentId ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 justify-start px-2 text-xs"
                                onClick={() =>
                                  void downloadProfileDocument(
                                    credential.documentId,
                                    credential.documentName || credential.title,
                                  )
                                }
                              >
                                {credential.documentName || profileCopy.downloadDocument}
                              </Button>
                            ) : null}
                            <Input
                              type="file"
                              className={inputClass}
                              disabled={
                                uploadingDocumentKey === `credential-${index}`
                              }
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                void uploadProfileDocument(
                                  "credential",
                                  file,
                                  (document) =>
                                    patchCredential(index, {
                                      documentId: document.id,
                                      documentName: document.original_filename,
                                    }),
                                  `credential-${index}`,
                                );
                              }}
                            />
                          </div>
                        </Field>
                        <Field label={profileCopy.notes}>
                          <Input
                            className={inputClass}
                            value={credential.notes}
                            onChange={(event) =>
                              patchCredential(index, {
                                notes: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-9 px-2 text-xs"
                            onClick={() => removeCredential(index)}
                          >
                            <Trash2 className="size-3.5" />
                            {profileCopy.remove}
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                      {profileCopy.noCredentials}
                    </p>
                  )}
                </div>
              </Section>

              <Section title={profileCopy.legalCompliance}>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={profileCopy.confidentiality}>
                    <select
                      className={selectClass}
                      value={form.confidentialityStatus}
                      onChange={(event) =>
                        patchForm({ confidentialityStatus: event.target.value })
                      }
                    >
                      <option value="">{profileCopy.notSet}</option>
                      <option value="signed">{profileCopy.signed}</option>
                      <option value="missing">{profileCopy.missing}</option>
                    </select>
                  </Field>
                  <Field label={profileCopy.signedAt}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.confidentialitySignedAt}
                      onChange={(event) =>
                        patchForm({ confidentialitySignedAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.document}>
                    <div className="grid gap-2">
                      {form.confidentialityDocumentId ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 justify-start px-2 text-xs"
                          onClick={() =>
                            void downloadProfileDocument(
                              form.confidentialityDocumentId,
                              form.confidentialityDocumentName ||
                                "confidentiality-document",
                            )
                          }
                        >
                          {form.confidentialityDocumentName ||
                            profileCopy.downloadDocument}
                        </Button>
                      ) : null}
                      <Input
                        type="file"
                        className={inputClass}
                        disabled={
                          uploadingDocumentKey === "confidentiality-document"
                        }
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          void uploadProfileDocument(
                            "confidentiality",
                            file,
                            (document) =>
                              patchForm({
                                confidentialityDocumentId: document.id,
                                confidentialityDocumentName:
                                  document.original_filename,
                              }),
                            "confidentiality-document",
                          );
                        }}
                      />
                    </div>
                  </Field>
                  <Field label={profileCopy.avvWorkContract}>
                    <select
                      className={selectClass}
                      value={form.avvStatus}
                      onChange={(event) =>
                        patchForm({ avvStatus: event.target.value })
                      }
                    >
                      <option value="">{profileCopy.notSet}</option>
                      <option value="signed">{profileCopy.signed}</option>
                      <option value="pending">{profileCopy.pending}</option>
                    </select>
                  </Field>
                  <Field label={profileCopy.avvSignedAt}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.avvSignedAt}
                      onChange={(event) =>
                        patchForm({ avvSignedAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.avvDocument}>
                    <div className="grid gap-2">
                      {form.avvDocumentId ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 justify-start px-2 text-xs"
                          onClick={() =>
                            void downloadProfileDocument(
                              form.avvDocumentId,
                              form.avvDocumentName || "avv-document",
                            )
                          }
                        >
                          {form.avvDocumentName || profileCopy.downloadDocument}
                        </Button>
                      ) : null}
                      <Input
                        type="file"
                        className={inputClass}
                        disabled={uploadingDocumentKey === "avv-document"}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          void uploadProfileDocument(
                            "avv",
                            file,
                            (document) =>
                              patchForm({
                                avvDocumentId: document.id,
                                avvDocumentName: document.original_filename,
                              }),
                            "avv-document",
                          );
                        }}
                      />
                    </div>
                  </Field>
                  <Field label={profileCopy.gdprTraining}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.gdprTrainingAt}
                      onChange={(event) =>
                        patchForm({ gdprTrainingAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.workPermitValidUntil}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.workPermitValidUntil}
                      onChange={(event) =>
                        patchForm({ workPermitValidUntil: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>

              <Section title={profileCopy.financeAccess}>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={profileCopy.hourlyRate}>
                    <Input
                      type="number"
                      className={inputClass}
                      value={form.hourlyRate}
                      onChange={(event) =>
                        patchForm({ hourlyRate: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.salaryClass}>
                    <Input
                      className={inputClass}
                      value={form.salaryClass}
                      onChange={(event) =>
                        patchForm({ salaryClass: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.billingStatus}>
                    <select
                      className={selectClass}
                      value={form.billingStatus}
                      onChange={(event) =>
                        patchForm({ billingStatus: event.target.value })
                      }
                    >
                      <option value="">{profileCopy.notSet}</option>
                      <option value="unpaid">{profileCopy.unpaid}</option>
                      <option value="paid">{profileCopy.paid}</option>
                      <option value="overdue">{profileCopy.overdue}</option>
                    </select>
                  </Field>
                  <Field label={profileCopy.bankDetails}>
                    <Input
                      className={inputClass}
                      value={form.bankDetails}
                      onChange={(event) =>
                        patchForm({ bankDetails: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.taxNumber}>
                    <Input
                      className={inputClass}
                      value={form.taxNumber}
                      onChange={(event) =>
                        patchForm({ taxNumber: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.ustIdnr}>
                    <Input
                      className={inputClass}
                      value={form.ustIdnr}
                      onChange={(event) => patchForm({ ustIdnr: event.target.value })}
                    />
                  </Field>
                  <Field label={profileCopy.accessLevel}>
                    <select
                      className={selectClass}
                      value={form.accessLevel}
                      onChange={(event) =>
                        patchForm({ accessLevel: event.target.value })
                      }
                    >
                      <option value="">{profileCopy.notSet}</option>
                      <option value="appointment_only">{profileCopy.appointmentOnly}</option>
                      <option value="medical_shared">{profileCopy.medicalDataShared}</option>
                      <option value="full">{profileCopy.fullAccess}</option>
                    </select>
                  </Field>
                  <Field label={profileCopy.autoBlockPolicy}>
                    <select
                      className={selectClass}
                      value={form.autoBlockPolicy}
                      onChange={(event) =>
                        patchForm({ autoBlockPolicy: event.target.value })
                      }
                    >
                      <option value="">{profileCopy.notSet}</option>
                      <option value="immediate">{profileCopy.immediate}</option>
                      <option value="after_one_hour">{profileCopy.afterOneHour}</option>
                    </select>
                  </Field>
                </div>
              </Section>

              <Section title={profileCopy.performanceWorkload}>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label={profileCopy.weeklyCapacityHours}>
                    <Input
                      type="number"
                      className={inputClass}
                      value={form.weeklyCapacityHours}
                      onChange={(event) =>
                        patchForm({ weeklyCapacityHours: event.target.value })
                      }
                    />
                  </Field>
                  <Metric
                    label={profileCopy.bookedThisWeek}
                    value={displayNumber(
                      operations?.summary.booked_hours_week,
                      " h",
                    )}
                  />
                  <Metric
                    label={profileCopy.capacity}
                    value={displayNumber(
                      operations?.summary.capacity_hours_week,
                      " h",
                    )}
                  />
                  <Metric
                    label={profileCopy.utilization}
                    value={displayNumber(
                      operations?.summary.utilization_percent,
                      "%",
                    )}
                  />
                  <Metric
                    label={profileCopy.averageScore}
                    value={`${displayNumber(
                      operations?.summary.average_feedback_score,
                    )}/5`}
                  />
                  <Metric
                    label={profileCopy.feedback}
                    value={displayNumber(operations?.summary.feedback_count)}
                  />
                  <Metric
                    label={profileCopy.next30Days}
                    value={displayNumber(
                      operations?.summary.appointments_next_30_days,
                    )}
                  />
                  <Metric
                    label={profileCopy.activeTasks}
                    value={displayNumber(operations?.summary.active_tasks)}
                  />
                  <Metric
                    label={profileCopy.overdueTasks}
                    value={displayNumber(operations?.summary.overdue_tasks)}
                  />
                </div>

                {operationsLoading ? (
                  <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    {profileCopy.loadingWorkload}
                  </div>
                ) : operations ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <OperationsList
                      title={profileCopy.assignedPatients}
                      items={operations.patients}
                      empty={profileCopy.noAssignedPatients}
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.patient_code)} ·{" "}
                            {displayValue(item.patient_name)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.appointment_count)} {profileCopy.appointments} ·
                            {profileCopy.next} {compactDate(item.next_appointment_date)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title={profileCopy.upcomingAppointments}
                      items={operations.upcoming_appointments}
                      empty={profileCopy.noUpcomingAppointments}
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {compactDate(item.date)} ·{" "}
                            {displayValue(item.time_start)}-
                            {displayValue(item.time_end)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.patient_code)} ·{" "}
                            {displayValue(item.title)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title={profileCopy.activeTasks}
                      items={operations.active_tasks}
                      empty={profileCopy.noActiveTasks}
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.priority)} ·{" "}
                            {displayValue(item.title)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {profileCopy.due} {compactDate(item.due_date)} ·{" "}
                            {displayValue(item.order_number)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title={profileCopy.recentReports}
                      items={operations.recent_reports}
                      empty={profileCopy.noReports}
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayNumber(item.hours, " h")} ·{" "}
                            {displayValue(item.approval_status)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {compactDate(item.appointment_date)} ·{" "}
                            {displayValue(item.patient_code)} · {profileCopy.billing}{" "}
                            {displayValue(item.billing_status)}
                          </span>
                        </div>
                      )}
                    />
                    <OperationsList
                      title={profileCopy.billingLines}
                      items={operations.billing_lines}
                      empty={profileCopy.noBillingLines}
                      renderItem={(item) => (
                        <div>
                          <span className="font-medium">
                            {displayValue(item.order_number)} ·{" "}
                            {displayValue(item.status)}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {displayValue(item.description)} ·{" "}
                            {displayNumber(item.unit_price)}{" "}
                            {displayValue(item.currency)}
                          </span>
                        </div>
                      )}
                    />
                  </div>
                ) : null}
              </Section>

              <Section title={profileCopy.internalManagement}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={profileCopy.internalNotes}>
                    <textarea
                      className={textareaClass}
                      value={form.internalNotes}
                      onChange={(event) =>
                        patchForm({ internalNotes: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.equipment}>
                    <Input
                      className={inputClass}
                      value={form.equipment}
                      onChange={(event) => patchForm({ equipment: event.target.value })}
                    />
                  </Field>
                  <Field label={profileCopy.retentionDeleteAt}>
                    <Input
                      type="date"
                      className={inputClass}
                      value={form.retentionDeleteAt}
                      onChange={(event) =>
                        patchForm({ retentionDeleteAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={profileCopy.erasureRequestStatus}>
                    <Input
                      className={inputClass}
                      value={form.erasureRequestStatus}
                      onChange={(event) =>
                        patchForm({ erasureRequestStatus: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </Section>
            </form>
          ) : loading ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              {profileCopy.loadingProfiles}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
