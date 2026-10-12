import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  activityActorLabel,
  activityContextEntries,
  activityContextSummary,
} from "./admin-activity-context";

const CYRILLIC_OR_MARK = /^[^A-Za-z]*$|[А-Яа-яЁё]/;

describe("activity log details (QA E2-03)", () => {
  it("drops empty values instead of printing null", () => {
    expect(
      activityContextSummary(
        { device: null, ip: null, sessions_ended_by_limit: [] },
        ru,
      ),
    ).toBe("—");
  });

  it("translates sign-in reasons and leaves out empty keys", () => {
    expect(activityContextSummary({ reason: "unknown_email" }, ru)).toBe(
      "Причина: Неизвестный e-mail",
    );
    expect(activityContextSummary({ locked_until: null, reason: "throttled" }, de)).toBe(
      "Grund: Zu viele Versuche – vorübergehend ausgesetzt",
    );
  });

  it("formats instants as DD.MM.YYYY HH:MM in Berlin time, nanoseconds included", () => {
    const entries = activityContextEntries(
      {
        executed_at: "2026-10-12T08:49:42.241514687+00:00",
        execution: { anonymized_at: "2026-10-12T08:49:42Z" },
      },
      ru,
    );
    expect(entries).toEqual([
      { key: "executed_at", label: "Исполнено", value: "12.10.2026 10:49" },
    ]);
  });

  it("names roles, counts field lists and skips record ids", () => {
    const summary = activityContextSummary(
      {
        role: "ceo",
        visible_fields: ["birth_date", "country", "insurance"],
        patient_id: "84504b42-1111-4222-8333-944445555666",
      },
      ru,
    );
    expect(summary).toBe("Роль: Генеральный директор · Видимые поля: 3");
    expect(activityContextSummary({ access_kind: "self", fields: ["country"] }, de)).toBe(
      "Zugriff: Eigene Angaben · Geänderte Felder: 1",
    );
  });

  it("never prints a raw English key in Russian", () => {
    const summary = activityContextSummary(
      {
        reason: "wrong_password",
        failed_attempts: 2,
        password_change_required: false,
        unknown_internal_flag: "x",
        method: "POST",
        route: "/api/v1/auth/login",
        status: 401,
      },
      ru,
    );
    expect(summary).toBe("Причина: Неверный пароль · Неудачных попыток: 2 · Нужна смена пароля: Нет");
    for (const part of summary.split(" · ")) {
      expect(part.split(":")[0]).toMatch(CYRILLIC_OR_MARK);
    }
  });

  it("labels the payer's token link neutrally, system jobs as the system", () => {
    expect(activityActorLabel({ user_name: "", actor_role: null, action: "payer_link_verified" }, ru)).toBe(
      "Запрос по ссылке плательщика",
    );
    expect(
      activityActorLabel({ user_name: "", action: "payer_questionnaire_submitted", entity_type: "lead" }, de),
    ).toBe("Anfrage über den Zahler-Link");
    expect(activityActorLabel({ user_name: "", action: "sessions_expired", entity_type: "session" }, ru)).toBe(
      "Система",
    );
    expect(activityActorLabel({ user_name: "", action: "login_failure", entity_type: "auth" }, ru)).toBe(
      ru.activity_anonymous_actor,
    );
    expect(activityActorLabel({ user_name: "", actor_role: "patient", action: "payer_assigned" }, ru)).toBe(
      ru.activity_portal_actor,
    );
    expect(activityActorLabel({ user_name: "Mia Muster", action: "payer_link_sent" }, ru)).toBe("Mia Muster");
  });
});
