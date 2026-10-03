import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./copy-text";

type FakeTextarea = {
  value: string;
  style: Record<string, string>;
  parent: FakeContainer | null;
  setAttribute: () => void;
  focus: () => void;
  select: () => void;
  setSelectionRange: () => void;
  remove: () => void;
};

type FakeContainer = { children: FakeTextarea[]; appendChild: (node: FakeTextarea) => void };

function fakeContainer(): FakeContainer {
  const container: FakeContainer = {
    children: [],
    appendChild(node) {
      node.parent = container;
      container.children.push(node);
    },
  };
  return container;
}

function stubDocument(execCommand: (command: string) => boolean) {
  const body = fakeContainer();
  vi.stubGlobal("document", {
    body,
    activeElement: null,
    execCommand,
    createElement: (): FakeTextarea => {
      const textarea: FakeTextarea = {
        value: "",
        style: {},
        parent: null,
        setAttribute: () => undefined,
        focus: () => undefined,
        select: () => undefined,
        setSelectionRange: () => undefined,
        remove: () => {
          if (textarea.parent) {
            textarea.parent.children = textarea.parent.children.filter((child) => child !== textarea);
          }
        },
      };
      return textarea;
    },
  });
  return body;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("uses the Clipboard API when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("secret")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("falls back to execCommand inside the given container when the API is refused", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    const container = fakeContainer();
    let copiedFromInsideContainer = false;
    stubDocument((command) => {
      copiedFromInsideContainer = command === "copy" && container.children[0]?.value === "secret";
      return true;
    });

    await expect(copyText("secret", container as unknown as Element)).resolves.toBe(true);
    expect(copiedFromInsideContainer).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it("reports failure when nothing can copy", async () => {
    vi.stubGlobal("navigator", {});
    stubDocument(() => false);
    await expect(copyText("secret")).resolves.toBe(false);
  });
});
