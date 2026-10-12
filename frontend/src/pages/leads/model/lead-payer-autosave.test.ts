import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_PAYER_DECLARATION_FORM, payerDeclarationPayload, type PayerDeclarationForm } from "./lead-payer";
import { createPayerAutosave, type PayerAutosaveState } from "./lead-payer-autosave";

const initial: PayerDeclarationForm = { ...EMPTY_PAYER_DECLARATION_FORM, kind: "self", actsOnOwnAccount: true };
const draft = (patch: Partial<PayerDeclarationForm> = {}) => ({ ...initial, ...patch });

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("payer declaration autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never writes initial data, reloads or unchanged inputs; debounces the latest edit", async () => {
    const save = vi.fn(async () => undefined);
    const onState = vi.fn();
    const queue = createPayerAutosave(initial, onState);
    queue.setEnabled(true);
    queue.setBaseline(initial);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    queue.schedule(draft({ actsOnOwnAccount: false }), save);
    await vi.advanceTimersByTimeAsync(350);
    queue.schedule(draft({ actsOnOwnAccount: false, beneficialOwnerName: "Marta Beispiel" }), save);
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ actsOnOwnAccount: false, beneficialOwnerName: "Marta Beispiel" }));
    expect(onState).toHaveBeenLastCalledWith({ status: "saved", dirty: false, error: null });
    queue.schedule(draft({ actsOnOwnAccount: false, beneficialOwnerName: "Marta Beispiel" }), save);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledOnce();
    await queue.dispose(false);
  });

  it("serializes slow writes and preserves only the latest draft that arrived meanwhile", async () => {
    const first = deferred();
    const second = deferred();
    const save = vi.fn<(form: PayerDeclarationForm) => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const states: PayerAutosaveState[] = [];
    const queue = createPayerAutosave(initial, (state) => states.push(state));
    queue.setEnabled(true);
    queue.schedule(draft({ sourceOfFundsDescription: "First" }), save);
    await vi.advanceTimersByTimeAsync(600);
    queue.schedule(draft({ sourceOfFundsDescription: "Intermediate" }), save);
    queue.schedule(draft({ sourceOfFundsDescription: "Latest" }), save);
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledOnce();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].sourceOfFundsDescription).toBe("Latest");
    expect(states.at(-1)).toEqual({ status: "saving", dirty: true, error: null });
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: "saved", dirty: false, error: null });
    await queue.dispose(false);
  });

  it("flushes a last keystroke before the debounce on a step change with its captured lead callback", async () => {
    const oldLeadSave = vi.fn(async () => undefined);
    const otherLeadSave = vi.fn(async () => undefined);
    const onState = vi.fn();
    const queue = createPayerAutosave(initial, onState);
    queue.setEnabled(true);
    queue.schedule(draft({ sourceOfFundsDescription: "Last keystroke" }), oldLeadSave);
    const count = onState.mock.calls.length;
    await queue.dispose(true);
    expect(oldLeadSave).toHaveBeenCalledOnce();
    expect(oldLeadSave.mock.calls[0]).toEqual([expect.objectContaining({ sourceOfFundsDescription: "Last keystroke" })]);
    expect(onState).toHaveBeenCalledTimes(count);
    queue.schedule(draft({ sourceOfFundsDescription: "Other lead" }), otherLeadSave);
    await vi.advanceTimersByTimeAsync(1000);
    expect(otherLeadSave).not.toHaveBeenCalled();
  });

  it("flushes newer edits after an in-flight write finishes, without overlapping requests", async () => {
    const first = deferred();
    const save = vi.fn<(form: PayerDeclarationForm) => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createPayerAutosave(initial, vi.fn());
    queue.setEnabled(true);
    queue.schedule(draft({ sourceOfFundsDescription: "First" }), save);
    await vi.advanceTimersByTimeAsync(600);
    queue.schedule(draft({ sourceOfFundsDescription: "Final" }), save);
    const finishing = queue.dispose(true);
    expect(save).toHaveBeenCalledOnce();
    first.resolve();
    await finishing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].sourceOfFundsDescription).toBe("Final");
  });

  it("persists a revert to the original value after an earlier write is already in flight", async () => {
    const first = deferred();
    const save = vi.fn<(form: PayerDeclarationForm) => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const queue = createPayerAutosave(initial, vi.fn());
    queue.setEnabled(true);
    queue.schedule(draft({ actsOnOwnAccount: false }), save);
    await vi.advanceTimersByTimeAsync(600);
    queue.schedule(initial, save);
    const finishing = queue.dispose(true);
    first.resolve();
    await finishing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].actsOnOwnAccount).toBe(true);
  });

  it("lets a new edit retry after an uncertain failed response, including a revert", async () => {
    const save = vi.fn<(form: PayerDeclarationForm) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Synthetic failed response"))
      .mockResolvedValue(undefined);
    const queue = createPayerAutosave(initial, vi.fn());
    queue.setEnabled(true);
    queue.schedule(draft({ actsOnOwnAccount: false }), save);
    await vi.advanceTimersByTimeAsync(600);
    queue.schedule(initial, save);
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].actsOnOwnAccount).toBe(true);
    await queue.dispose(false);
  });

  it("pauses after failure, reports it, and retries the latest draft only on an explicit retry", async () => {
    const first = deferred();
    const error = new Error("Synthetic unavailable");
    const save = vi.fn<(form: PayerDeclarationForm) => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const onState = vi.fn();
    const queue = createPayerAutosave(initial, onState);
    queue.setEnabled(true);
    queue.schedule(draft({ sourceOfFundsDescription: "First" }), save);
    await vi.advanceTimersByTimeAsync(600);
    queue.schedule(draft({ sourceOfFundsDescription: "Latest" }), save);
    first.reject(error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith({ status: "error", dirty: true, error });
    queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].sourceOfFundsDescription).toBe("Latest");
    expect(onState).toHaveBeenLastCalledWith({ status: "saved", dirty: false, error: null });
    await queue.dispose(false);
  });

  it("keeps an unanswered own-account choice absent and permits incomplete drafts once kind is selected", async () => {
    const save = vi.fn(async () => undefined);
    const queue = createPayerAutosave(EMPTY_PAYER_DECLARATION_FORM, vi.fn());
    queue.setEnabled(true);
    queue.schedule({ ...EMPTY_PAYER_DECLARATION_FORM, sourceOfFundsDescription: "Draft" }, save);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    queue.schedule({ ...EMPTY_PAYER_DECLARATION_FORM, kind: "third_party", sourceOfFundsDescription: "Draft" }, save);
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledOnce();
    const payload = payerDeclarationPayload(save.mock.calls[0][0]);
    expect(payload.payer_kind).toBe("third_party");
    expect(payload).not.toHaveProperty("acts_on_own_account");
    expect(payload.first_name).toBeNull();
    await queue.dispose(false);
  });

  it("cancels queued writes when editing is disabled and never flushes without permission", async () => {
    const save = vi.fn(async () => undefined);
    const queue = createPayerAutosave(initial, vi.fn());
    queue.setEnabled(true);
    queue.schedule(draft({ actsOnOwnAccount: false }), save);
    queue.setEnabled(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    queue.setEnabled(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await queue.dispose(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
