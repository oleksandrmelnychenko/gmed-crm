import { describe, expect, it } from "vitest";

import { assignableInterpreterOptions, type InterpreterOption } from "./types";

const options: InterpreterOption[] = [
  { id: "a", name: "Active", role: "interpreter", assignable: true },
  { id: "b", name: "Blocked", role: "interpreter", assignable: false },
  { id: "c", name: "Older server", role: "teamlead_interpreter" },
];

describe("assignableInterpreterOptions", () => {
  it("hides blocked interpreters but keeps the one already booked", () => {
    expect(assignableInterpreterOptions(options).map((option) => option.id)).toEqual(["a", "c"]);
    expect(assignableInterpreterOptions(options, "b").map((option) => option.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(assignableInterpreterOptions(options, "").map((option) => option.id)).toEqual(["a", "c"]);
  });
});
