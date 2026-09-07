import { describe, expect, it } from "vitest";
import { mergeOrderDraft } from "./order-draft";

describe("order form refresh", () => {
  it("keeps local edits and refreshes unrelated server fields", () => {
    expect(mergeOrderDraft(
      {note:"Local edit", status:"pending"},
      {note:"Saved", status:"pending"},
      {note:"Changed remotely", status:"granted"},
    )).toEqual({note:"Local edit", status:"granted"});
  });

  it("becomes clean when the server acknowledges the saved draft", () => {
    const saved = {note:"Local edit", status:"granted"};
    expect(mergeOrderDraft(saved, {note:"Saved", status:"pending"}, saved)).toEqual(saved);
  });

  it("refreshes reverted edits normally", () => {
    const previous = {note:"Saved"};
    expect(mergeOrderDraft(previous, previous, {note:"Updated remotely"})).toEqual({note:"Updated remotely"});
  });

  it("accepts server normalization after saving a note", () => {
    expect(mergeOrderDraft({note:"  Saved note  "}, {note:"Before"}, {note:"Saved note"}))
      .toEqual({note:"Saved note"});
  });
});
