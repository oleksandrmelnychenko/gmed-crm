import { payerDeclarationPayload, type PayerDeclarationForm } from "./lead-payer";

export type PayerAutosaveState = {
  status: "idle" | "dirty" | "saving" | "saved" | "error";
  dirty: boolean;
  error: unknown;
};

type Save = (form: PayerDeclarationForm) => Promise<unknown>;
type Snapshot = { form: PayerDeclarationForm; signature: string; save: Save };

const signatureOf = (form: PayerDeclarationForm) =>
  JSON.stringify([form.kind, payerDeclarationPayload(form)]);

/** One write at a time; a newer draft waits behind it instead of being discarded. */
export function createPayerAutosave(
  initialForm: PayerDeclarationForm,
  onState: (state: PayerAutosaveState) => void,
  delay = 600,
) {
  let baseline = signatureOf(initialForm);
  let pending: Snapshot | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let enabled = false;
  let ready = false;
  let failed = false;
  let closed = false;
  let finishPending = false;
  // Reads edits made by schedule() while the awaited request was in flight.
  const currentPending = (): Snapshot | null => pending;

  const emit = (status: PayerAutosaveState["status"], dirty: boolean, error: unknown = null) => {
    if (!closed) onState({ status, dirty, error });
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  function run(): Promise<void> {
    if (running) return running;
    if (!enabled || failed || !pending?.form.kind || (closed && !finishPending)) return Promise.resolve();
    const snapshot = pending;
    pending = null;
    ready = false;
    emit("saving", true);
    running = (async () => {
      try {
        await Promise.resolve().then(() => snapshot.save(snapshot.form));
        baseline = snapshot.signature;
        if (currentPending()?.signature === baseline) {
          pending = null;
          clearTimer();
        }
        emit(pending ? "dirty" : "saved", Boolean(pending));
      } catch (error) {
        // Keep the latest draft, but pause until a new edit or an explicit retry.
        pending ??= snapshot;
        failed = true;
        ready = false;
        clearTimer();
        emit("error", true, error);
      } finally {
        running = null;
      }
      if (pending && ready && enabled && !failed) await run();
    })();
    return running;
  }

  function arm() {
    clearTimer();
    if (!enabled || failed || !pending?.form.kind || closed) return;
    timer = setTimeout(() => {
      timer = null;
      ready = true;
      void run();
    }, delay);
  }

  return {
    schedule(form: PayerDeclarationForm, save: Save) {
      if (closed) return;
      const uncertain = failed;
      pending = { form, signature: signatureOf(form), save };
      failed = false;
      ready = false;
      if (!running && !uncertain && pending.signature === baseline) {
        pending = null;
        clearTimer();
        emit("idle", false);
        return;
      }
      emit(running ? "saving" : "dirty", true);
      arm();
    },
    setEnabled(value: boolean) {
      if (closed || enabled === value) return;
      enabled = value;
      if (enabled) arm();
      else {
        ready = false;
        clearTimer();
      }
    },
    setBaseline(form: PayerDeclarationForm) {
      if (!closed && !pending && !running) baseline = signatureOf(form);
    },
    retry() {
      if (closed || !enabled) return;
      failed = false;
      ready = true;
      clearTimer();
      void run();
    },
    dispose(flush: boolean): Promise<void> {
      closed = true;
      clearTimer();
      finishPending = flush && enabled;
      if (!finishPending) {
        enabled = false;
        pending = null;
        return running ?? Promise.resolve();
      }
      // A step change flushes with the snapshot's captured callback/lead.
      // UI notifications stop; a failed write is never retried in the background.
      ready = true;
      return run();
    },
  };
}

export type PayerAutosave = ReturnType<typeof createPayerAutosave>;
