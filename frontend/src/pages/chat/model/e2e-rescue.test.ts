import { describe, expect, it, vi } from "vitest";

import { createE2ERescueQueue, type E2ERescueJob } from "./e2e-rescue";

function setup(overrides: Partial<Parameters<typeof createE2ERescueQueue>[0]> = {}) {
  const calls: string[] = [];
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
  const convertText = vi.fn(async (messageId: string, text: string) => { calls.push(`text:${messageId}:${text}`); });
  const convertAttachment = vi.fn(async (messageId: string, bytes: Uint8Array, filename: string) => {
    calls.push(`attachment:${messageId}:${filename}:${new TextDecoder().decode(bytes)}`);
  });
  const onConverted = vi.fn<(job: E2ERescueJob) => void>();
  const queue = createE2ERescueQueue({
    convertText, convertAttachment, onConverted, sleep,
    textIntervalMs: 10, attachmentIntervalMs: 50, ...overrides,
  });
  return { queue, calls, sleep, convertText, convertAttachment, onConverted };
}

describe("rescue of old end-to-end chat history", () => {
  it("converts every message once per page session, however often it is opened", async () => {
    const { queue, convertText } = setup();
    expect(queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "Old text" })).toBe(true);
    expect(queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "Old text" })).toBe(false);
    await queue.idle();
    expect(queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "Old text" })).toBe(false);
    expect(convertText).toHaveBeenCalledTimes(1);
    expect(convertText).toHaveBeenCalledWith("m1", "Old text");
  });

  it("runs one request at a time with a pause in between, caption before attachment", async () => {
    const { queue, calls, sleep, onConverted } = setup();
    queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "Caption" });
    queue.enqueue({
      kind: "attachment", peerId: "peer", messageId: "m1", filename: "lab.txt",
      load: async () => new TextEncoder().encode("decrypted bytes"),
    });
    queue.enqueue({ kind: "text", peerId: "peer", messageId: "m2", text: "Second" });
    await queue.idle();
    expect(calls).toEqual([
      "text:m1:Caption",
      "attachment:m1:lab.txt:decrypted bytes",
      "text:m2:Second",
    ]);
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([10, 50]);
    expect(onConverted.mock.calls.map(([job]) => `${job.kind}:${job.messageId}`)).toEqual([
      "text:m1", "attachment:m1", "text:m2",
    ]);
  });

  it("does not retry a failed conversion in the same session and keeps going", async () => {
    const convertText = vi.fn(async (messageId: string) => {
      if (messageId === "m1") throw new Error("409 Conflict");
    });
    const { queue, onConverted } = setup({ convertText });
    queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "Already converted by the peer" });
    queue.enqueue({ kind: "text", peerId: "peer", messageId: "m2", text: "Still end-to-end" });
    await queue.idle();
    expect(queue.enqueue({ kind: "text", peerId: "peer", messageId: "m1", text: "again" })).toBe(false);
    expect(convertText).toHaveBeenCalledTimes(2);
    expect(onConverted).toHaveBeenCalledTimes(1);
  });

  it("does not upload an attachment it could not decrypt", async () => {
    const { queue, convertAttachment } = setup();
    queue.enqueue({
      kind: "attachment", peerId: "peer", messageId: "m3", filename: "scan.pdf",
      load: async () => { throw new Error("key unavailable"); },
    });
    await queue.idle();
    expect(convertAttachment).not.toHaveBeenCalled();
  });
});
