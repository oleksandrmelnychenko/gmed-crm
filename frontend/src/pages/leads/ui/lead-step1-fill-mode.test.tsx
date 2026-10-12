import type { KeyboardEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Step1FillMode } from "../data/lead-portal-intake-api";
import { Step1FillModeSwitch } from "./lead-wizard-portal-intake";

const tx = (ru: string) => ru;
type RadioProps = { onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void };

function options(mode: Step1FillMode, disabled = false) {
  const onChange = vi.fn();
  const group = Step1FillModeSwitch({ mode, disabled, tx, onChange }) as ReactElement<{ children: ReactElement<RadioProps>[] }>;
  return { onChange, radios: group.props.children };
}

function keyEvent(key: string) {
  const focused = [vi.fn(), vi.fn()];
  const preventDefault = vi.fn();
  const event = { key, preventDefault, currentTarget: {
    parentElement: { querySelectorAll: () => focused.map((focus) => ({ focus })) },
  } } as unknown as KeyboardEvent<HTMLButtonElement>;
  return { event, focused, preventDefault };
}

describe("step 1 fill-mode radio control", () => {
  it("keeps one tab stop on the selected radio", () => {
    const html = renderToStaticMarkup(<Step1FillModeSwitch mode="patient" tx={tx} onChange={() => {}} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it.each(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"])("selects and focuses the other mode with %s", (key) => {
    const { radios, onChange } = options("staff");
    const { event, focused, preventDefault } = keyEvent(key);
    radios[0].props.onKeyDown(event);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("patient");
    expect(focused[1]).toHaveBeenCalledOnce();
    expect(focused[0]).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("wraps back and supports Home/End without resubmitting the selected mode", () => {
    const selectedPatient = options("patient");
    const right = keyEvent("ArrowRight");
    selectedPatient.radios[1].props.onKeyDown(right.event);
    expect(selectedPatient.onChange).toHaveBeenCalledExactlyOnceWith("staff");
    expect(right.focused[0]).toHaveBeenCalledOnce();
    const selectedStaff = options("staff");
    const home = keyEvent("Home");
    selectedStaff.radios[0].props.onKeyDown(home.event);
    expect(selectedStaff.onChange).not.toHaveBeenCalled();
    expect(home.focused[0]).toHaveBeenCalledOnce();
    selectedStaff.radios[0].props.onKeyDown(keyEvent("End").event);
    expect(selectedStaff.onChange).toHaveBeenCalledExactlyOnceWith("patient");
  });

  it("leaves Tab and disabled controls alone", () => {
    for (const [disabled, key] of [[false, "Tab"], [true, "ArrowRight"]] as const) {
      const { radios, onChange } = options("staff", disabled);
      const { event, focused, preventDefault } = keyEvent(key);
      radios[0].props.onKeyDown(event);
      expect(onChange).not.toHaveBeenCalled();
      expect(preventDefault).not.toHaveBeenCalled();
      for (const focus of focused) expect(focus).not.toHaveBeenCalled();
    }
  });
});
