import type { FormEvent } from "react";

/**
 * Browser validation bubbles of number fields come in the browser's language
 * (a Ukrainian browser says «Значення має бути меншим…» inside the Russian
 * interface, QA C-09). These props replace them with a message in the
 * interface language; the bound itself still comes from `min`/`max`.
 */
type ValidityLang = "de" | "ru" | string;

export function numberValidityMessage(
  validity: Pick<ValidityState, "valueMissing" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput">,
  bounds: { min?: string; max?: string },
  lang: ValidityLang,
): string {
  const de = lang === "de";
  const min = bounds.min?.trim() ?? "";
  const max = bounds.max?.trim() ?? "";
  if (validity.valueMissing) {
    return de ? "Bitte füllen Sie dieses Feld aus." : "Заполните это поле.";
  }
  if (validity.badInput) {
    return de ? "Bitte eine Zahl eingeben." : "Введите число.";
  }
  if (validity.rangeOverflow || validity.rangeUnderflow) {
    if (min && max) {
      return de ? `Der Wert muss zwischen ${min} und ${max} liegen.` : `Значение должно быть от ${min} до ${max}.`;
    }
    if (validity.rangeOverflow && max) {
      return de ? `Der Wert darf höchstens ${max} sein.` : `Значение должно быть не больше ${max}.`;
    }
    if (min) {
      return de ? `Der Wert muss mindestens ${min} sein.` : `Значение должно быть не меньше ${min}.`;
    }
  }
  if (validity.stepMismatch) {
    return de ? "Dieser Wert ist nicht zulässig." : "Недопустимое значение.";
  }
  return "";
}

export function numberValidityProps(lang: ValidityLang) {
  return {
    onInvalid: (event: FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      input.setCustomValidity("");
      const message = numberValidityMessage(
        input.validity,
        { min: input.getAttribute("min") ?? undefined, max: input.getAttribute("max") ?? undefined },
        lang,
      );
      if (message) input.setCustomValidity(message);
    },
    onInput: (event: FormEvent<HTMLInputElement>) => {
      event.currentTarget.setCustomValidity("");
    },
  };
}
