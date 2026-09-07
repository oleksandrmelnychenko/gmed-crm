export type SignaturePreviewError = "load" | "render" | "access" | "session" | "missing" | "password" | "invalid";

export function signaturePreviewError(error: unknown, fallback: "load" | "render"): SignaturePreviewError {
  if (typeof error !== "object" || error === null) return fallback;
  const details = error as { status?: number; name?: string };
  if (details.status === 401) return "session";
  if (details.status === 403) return "access";
  if (details.status === 404 || details.status === 410) return "missing";
  if (details.name === "PasswordException") return "password";
  if (details.name === "InvalidPDFException") return "invalid";
  return fallback;
}

export function signaturePreviewErrorMessage(error: SignaturePreviewError, lang: string) {
  const messages: Record<SignaturePreviewError, [string, string]> = {
    load: ["Не удалось загрузить файл PDF. Повторите загрузку.", "Die PDF-Datei konnte nicht geladen werden. Versuchen Sie es erneut."],
    render: ["Не удалось отобразить страницу PDF. Повторите загрузку документа.", "Die PDF-Seite konnte nicht angezeigt werden. Laden Sie das Dokument erneut."],
    access: ["Нет доступа к файлу этого документа. Проверьте права доступа к документу.", "Kein Zugriff auf die Datei dieses Dokuments. Prüfen Sie die Dokumentberechtigungen."],
    session: ["Сессия истекла. Войдите в систему и откройте документ снова.", "Die Sitzung ist abgelaufen. Melden Sie sich an und öffnen Sie das Dokument erneut."],
    missing: ["Файл этого документа не найден или удалён. Загрузите файл или создайте новую версию документа.", "Die Datei dieses Dokuments fehlt oder wurde gelöscht. Laden Sie die Datei hoch oder erstellen Sie eine neue Dokumentversion."],
    password: ["PDF защищён паролем. Для подписи загрузите версию без пароля.", "Die PDF ist passwortgeschützt. Laden Sie zum Unterschreiben eine Version ohne Passwort hoch."],
    invalid: ["Файл пуст, повреждён или не является PDF. Загрузите исправный PDF для подписи.", "Die Datei ist leer, beschädigt oder keine PDF. Laden Sie eine gültige PDF zum Unterschreiben hoch."],
  };
  return messages[error][lang === "de" ? 1 : 0];
}
