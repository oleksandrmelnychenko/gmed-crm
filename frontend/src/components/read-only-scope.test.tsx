import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InfoRow } from "@/components/record-workspace";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";

import { ReadOnlyScope, WritableScope, readOnlyDisables, useReadOnly } from "./read-only-scope";

function Probe() {
  return <span data-read-only={useReadOnly() ? "yes" : "no"} />;
}

const form = (
  <>
    <Input aria-label="name" value="x" onChange={() => {}} />
    <Input aria-label="birth" type="date" value="2026-01-01" onChange={() => {}} />
    <Input aria-label="search" type="search" value="" onChange={() => {}} />
    <Input aria-label="exempt" data-readonly="exempt" value="" onChange={() => {}} />
    <SelectField aria-label="status" value="a" options={[{ value: "a", label: "A" }]} onValueChange={() => {}} />
    <NativeComboboxSelect aria-label="patient" value="p1" onChange={() => {}}>
      <option value="p1">P1</option>
    </NativeComboboxSelect>
    <Button type="submit">Save</Button>
    <Button type="button" data-action="write">Create</Button>
    <Button type="button">Close</Button>
    <InfoRow label="Nationality" value="DE" onEdit={() => {}} />
    <Probe />
  </>
);

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <LocalizationProvider dateAdapter={AdapterDayjs}>{node}</LocalizationProvider>,
  );
}

/** Whether the element carrying `aria-label` renders the `disabled` attribute. */
function isDisabled(html: string, ariaLabel: string) {
  const match = new RegExp(`<[^>]*aria-label="${ariaLabel}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no element with aria-label="${ariaLabel}"`);
  return /\sdisabled(=""|\s|>|\/)/.test(match[0]);
}

function isButtonDisabled(html: string, text: string) {
  const match = new RegExp(`<button[^>]*>${text}</button>`).exec(html);
  if (!match) throw new Error(`no button "${text}"`);
  return /\sdisabled(=""|\s|>)/.test(match[0]);
}

describe("ReadOnlyScope", () => {
  it("disables form controls, write buttons and edit pencils inside an active scope", () => {
    const html = render(<ReadOnlyScope>{form}</ReadOnlyScope>);

    expect(isDisabled(html, "name")).toBe(true);
    expect(isDisabled(html, "birth")).toBe(true);
    expect(isDisabled(html, "status")).toBe(true);
    expect(isDisabled(html, "patient")).toBe(true);
    expect(isButtonDisabled(html, "Save")).toBe(true);
    expect(isButtonDisabled(html, "Create")).toBe(true);
    expect(html).toContain('data-read-only="yes"');
    expect(html).not.toContain('aria-label="Изменить Nationality"');
  });

  it("keeps search boxes, exempt fields and plain buttons enabled", () => {
    const html = render(<ReadOnlyScope>{form}</ReadOnlyScope>);

    expect(isDisabled(html, "search")).toBe(false);
    expect(isDisabled(html, "exempt")).toBe(false);
    expect(isButtonDisabled(html, "Close")).toBe(false);
  });

  it("leaves everything writable when inactive or outside a scope", () => {
    for (const html of [
      render(form),
      render(<ReadOnlyScope active={false}>{form}</ReadOnlyScope>),
    ]) {
      expect(isDisabled(html, "name")).toBe(false);
      expect(isDisabled(html, "birth")).toBe(false);
      expect(isDisabled(html, "status")).toBe(false);
      expect(isButtonDisabled(html, "Save")).toBe(false);
      expect(isButtonDisabled(html, "Create")).toBe(false);
      expect(html).toContain('data-read-only="no"');
      expect(html).toContain('aria-label="Изменить Nationality"');
      expect(html).not.toContain('data-testid="read-only-banner"');
    }
  });

  it("shows one banner per page and none for nested scopes", () => {
    const html = render(
      <ReadOnlyScope>
        <ReadOnlyScope>
          <Probe />
        </ReadOnlyScope>
      </ReadOnlyScope>,
    );

    expect(html.split('data-testid="read-only-banner"').length - 1).toBe(1);
    expect(html).toContain("Только просмотр");
  });

  it("can hide the banner while still disabling controls", () => {
    const html = render(
      <ReadOnlyScope banner={false}>
        <Button type="submit">Save</Button>
      </ReadOnlyScope>,
    );

    expect(html).not.toContain('data-testid="read-only-banner"');
    expect(isButtonDisabled(html, "Save")).toBe(true);
  });

  it("re-enables controls inside a writable pocket", () => {
    const html = render(
      <ReadOnlyScope>
        <WritableScope>
          <Input aria-label="name" value="x" onChange={() => {}} />
          <Probe />
        </WritableScope>
      </ReadOnlyScope>,
    );

    expect(isDisabled(html, "name")).toBe(false);
    expect(html).toContain('data-read-only="no"');
  });

  it("readOnlyDisables honours search inputs and the exempt marker", () => {
    expect(readOnlyDisables(false, {})).toBe(false);
    expect(readOnlyDisables(true, {})).toBe(true);
    expect(readOnlyDisables(true, { type: "text" })).toBe(true);
    expect(readOnlyDisables(true, { type: "search" })).toBe(false);
    expect(readOnlyDisables(true, { "data-readonly": "exempt" })).toBe(false);
  });
});
