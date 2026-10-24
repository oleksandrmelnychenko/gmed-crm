import { describe, expect, it } from "vitest";

import { createRequestQueue, enqueueUploadBatch, readAfterWrites } from "./lead-request-parts";

function held() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lead request queue", () => {
  it("a read waits for a save still in flight", async () => {
    const enqueue = createRequestQueue();
    const save = held();
    const order: string[] = [];
    void enqueue(async () => { await save.promise; order.push("save"); });
    const read = readAfterWrites(enqueue, async () => { order.push("read"); return 1; });
    await settle();
    expect(order).toEqual([]);
    save.release();
    await expect(read).resolves.toEqual({ result: 1, uploadsPending: false });
    expect(order).toEqual(["save", "read"]);
  });

  it("a read passes an upload batch, a write and a submit do not", async () => {
    const enqueue = createRequestQueue();
    const batch = held();
    const order: string[] = [];
    void enqueueUploadBatch(enqueue, async () => { await batch.promise; order.push("batch"); });
    const read = await readAfterWrites(enqueue, async () => { order.push("read"); return 2; });
    expect(read).toEqual({ result: 2, uploadsPending: true });
    const submit = enqueue(async () => { order.push("submit"); });
    await settle();
    expect(order).toEqual(["read"]);
    batch.release();
    await submit;
    expect(order).toEqual(["read", "batch", "submit"]);
    expect((await readAfterWrites(enqueue, async () => 3)).uploadsPending).toBe(false);
  });

  it("a read waits for a save queued behind an upload batch", async () => {
    const enqueue = createRequestQueue();
    const batch = held();
    const order: string[] = [];
    void enqueueUploadBatch(enqueue, async () => { await batch.promise; order.push("batch"); });
    void enqueue(async () => { order.push("save"); });
    const read = readAfterWrites(enqueue, async () => { order.push("read"); });
    await settle();
    expect(order).toEqual([]);
    batch.release();
    await read;
    expect(order).toEqual(["batch", "save", "read"]);
  });

  it("a plain queue runs the read in turn", async () => {
    const enqueue = <Result,>(task: () => Promise<Result>) => task();
    await expect(readAfterWrites(enqueue, async () => 4)).resolves.toEqual({ result: 4, uploadsPending: false });
    await expect(enqueueUploadBatch(enqueue, async () => 5)).resolves.toBe(5);
  });
});
