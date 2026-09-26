import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  formatNextActionKind,
  nextActionButtonLabel,
  nextActionDescription,
} from "./portal-next-actions";
import { portalDocumentValueLabel } from "./portal-shared";

describe("portal next actions", () => {
  it("labels every kind the server sends", () => {
    for (const kind of [
      "upcoming_appointment",
      "recommendation",
      "document_confirmation",
      "invoice_payment",
      "package_approval",
    ]) {
      expect(formatNextActionKind(kind, ru)).not.toBe(ru.common_unknown_value);
    }
    expect(formatNextActionKind("upcoming_appointment", ru)).toBe("Предстоящий визит");
    expect(formatNextActionKind("upcoming_appointment", de)).toBe("Anstehender Termin");
  });

  it("replaces the server's English button labels and hints", () => {
    expect(
      nextActionButtonLabel({ kind: "upcoming_appointment", action_label: "Open appointments" }, ru),
    ).toBe("Открыть визиты");
    expect(
      nextActionButtonLabel({ kind: "invoice_payment", action_label: "Open invoices" }, de),
    ).toBe("Rechnungen öffnen");
    expect(
      nextActionDescription(
        { kind: "document_confirmation", description: "Please confirm receipt of this document." },
        ru,
      ),
    ).toBe("Подтвердите, пожалуйста, получение документа.");
  });

  it("labels the preparation sheet generated from a provider template", () => {
    const labels = [
      ru.portal_document_label_provider_instructions,
      de.portal_document_label_provider_instructions,
    ];
    expect(labels).toContain(portalDocumentValueLabel("provider_template_instruction"));
    expect(labels).toContain(portalDocumentValueLabel("provider_template"));
  });

  it("keeps patient data descriptions such as the visit location", () => {
    expect(
      nextActionDescription({ kind: "upcoming_appointment", description: "Clinic Berlin" }, ru),
    ).toBe("Clinic Berlin");
    expect(
      nextActionButtonLabel({ kind: "future_kind", action_label: "Open" }, ru),
    ).toBe("Open");
  });
});
