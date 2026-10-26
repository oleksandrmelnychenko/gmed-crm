import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PatientDataPendingNotice,
  PENDING_BIRTH_DATE_ID,
  PENDING_LEGAL_SEX_ID,
} from "./lead-wizard-portal-intake";

const tx = (ru: string) => ru;
const render = (node: ReactNode) =>
  renderToStaticMarkup(<LocalizationProvider dateAdapter={AdapterDayjs}>{node}</LocalizationProvider>);
const txDe = (_ru: string, de: string) => de;

type AnyProps = { id?: string; children?: ReactNode; onChange?: (event: { target: { value: string } }) => void };

/** The element with this id in the notice's own tree (the notice has no hooks). */
function findById(node: ReactNode, id: string): ReactElement<AnyProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findById(child, id);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<AnyProps>(node)) return null;
  if (node.props.id === id) return node;
  return findById(node.props.children, id);
}

describe("PatientDataPendingNotice", () => {
  it("asks for the legal sex in the banner when it is missing", () => {
    const html = render(
      <PatientDataPendingNotice onOpenStep1={() => {}} tx={tx} missing={["legalSex"]} onLegalSexChange={() => {}} />,
    );
    expect(html).toContain("Чтобы открыть медицинскую часть (анамнез, диагнозы, аллергии, препараты), укажите пол согласно документам.");
    expect(html).toContain("Пациент может указать его и сам в портале.");
    expect(html).toContain("Пол согласно документам");
    expect(html).toContain(PENDING_LEGAL_SEX_ID);
    expect(html).not.toContain(PENDING_BIRTH_DATE_ID);
    expect(html).toContain("К данным клиента");
  });

  it("passes the chosen legal sex to the wizard", () => {
    const onLegalSexChange = vi.fn();
    const tree = PatientDataPendingNotice({ onOpenStep1: () => {}, tx, missing: ["legalSex"], onLegalSexChange });
    const select = findById(tree, PENDING_LEGAL_SEX_ID);
    expect(select).not.toBeNull();
    select!.props.onChange!({ target: { value: "female" } });
    expect(onLegalSexChange).toHaveBeenCalledExactlyOnceWith("female");
  });

  it("asks for both fields when both are missing and passes the birth date", () => {
    const onBirthDateChange = vi.fn();
    const tree = PatientDataPendingNotice({
      onOpenStep1: () => {},
      tx,
      onLegalSexChange: () => {},
      onBirthDateChange,
      birthDateError: "Дата рождения не может быть в будущем",
    });
    const picker = findById(tree, PENDING_BIRTH_DATE_ID);
    expect(findById(tree, PENDING_LEGAL_SEX_ID)).not.toBeNull();
    picker!.props.onChange!({ target: { value: "1985-05-12" } });
    expect(onBirthDateChange).toHaveBeenCalledExactlyOnceWith("1985-05-12");
    const html = render(tree);
    expect(html).toContain("укажите дату рождения и пол согласно документам.");
    expect(html).toContain("Пациент может указать их и сам в портале.");
    expect(html).toContain("Дата рождения не может быть в будущем");
  });

  it("says it in German and leaves out the portal line when staff fill the data", () => {
    const html = render(
      <PatientDataPendingNotice onOpenStep1={() => {}} tx={txDe} missing={["legalSex"]} patientCanFill={false} onLegalSexChange={() => {}} />,
    );
    expect(html).toContain("Um den medizinischen Teil (Anamnese, Diagnosen, Allergien, Medikamente) zu öffnen, geben Sie das Geschlecht laut Dokument an.");
    expect(html).toContain("Geschlecht laut Dokument");
    expect(html).not.toContain("im Portal");
  });
});
