import { describe, expect, it } from "vitest";

import { resolveLoginDefaults } from "./login-defaults";

describe("login defaults", () => {
  it("keeps credentials empty when dev defaults are disabled", () => {
    expect(
      resolveLoginDefaults({
        enabled: false,
        email: "admin@gmed.de",
        password: "admin123",
      }),
    ).toEqual({ email: "", password: "" });
  });

  it("prefills the configured credentials in development", () => {
    expect(
      resolveLoginDefaults({
        enabled: true,
        email: "admin@gmed.de",
        password: "admin123",
      }),
    ).toEqual({ email: "admin@gmed.de", password: "admin123" });
  });

  it("does not invent defaults when dev values are missing", () => {
    expect(resolveLoginDefaults({ enabled: true })).toEqual({
      email: "",
      password: "",
    });
  });
});
