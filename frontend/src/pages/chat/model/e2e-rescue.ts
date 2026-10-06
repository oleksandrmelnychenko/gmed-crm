/**
 * Background rescue of old end-to-end chat history.
 *
 * Since 2026-10-07 the chat stores messages server-encrypted. Old end-to-end
 * messages can only be opened in a browser that still holds the device key
 * from that time. When such a browser has opened one, it hands the text (and
 * then the attachment bytes) back to the server once, so the message becomes
 * readable on every device. Jobs run one after another with a pause between
 * requests; every message and kind is attempted at most once per page
 * session, and a failed attempt is retried on a later visit.
 */

export type E2ERescueJob =
  | { kind: "text"; peerId: string; messageId: string; text: string }
  | {
      kind: "attachment";
      peerId: string;
      messageId: string;
      filename: string;
      load: () => Promise<Uint8Array>;
    };

export type E2ERescueQueueOptions = {
  convertText: (messageId: string, text: string) => Promise<unknown>;
  convertAttachment: (messageId: string, bytes: Uint8Array, filename: string) => Promise<unknown>;
  onConverted?: (job: E2ERescueJob) => void;
  /** Pause after a text conversion before the next request. */
  textIntervalMs?: number;
  /** Pause after an attachment conversion before the next request. */
  attachmentIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type E2ERescueQueue = {
  /** Queues a job; returns false when this message and kind was already attempted. */
  enqueue: (job: E2ERescueJob) => boolean;
  /** Resolves once the queue is empty. */
  idle: () => Promise<void>;
};

export const E2E_RESCUE_TEXT_INTERVAL_MS = 400;
export const E2E_RESCUE_ATTACHMENT_INTERVAL_MS = 2_000;

export function e2eRescueJobKey(job: Pick<E2ERescueJob, "kind" | "messageId">) {
  return `${job.kind}:${job.messageId}`;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createE2ERescueQueue(options: E2ERescueQueueOptions): E2ERescueQueue {
  const attempted = new Set<string>();
  const pending: E2ERescueJob[] = [];
  const sleep = options.sleep ?? defaultSleep;
  const textInterval = options.textIntervalMs ?? E2E_RESCUE_TEXT_INTERVAL_MS;
  const attachmentInterval = options.attachmentIntervalMs ?? E2E_RESCUE_ATTACHMENT_INTERVAL_MS;
  let running: Promise<void> | null = null;

  async function run(job: E2ERescueJob) {
    if (job.kind === "text") {
      await options.convertText(job.messageId, job.text);
    } else {
      await options.convertAttachment(job.messageId, await job.load(), job.filename);
    }
  }

  async function drain() {
    while (pending.length > 0) {
      const job = pending.shift()!;
      try {
        await run(job);
        options.onConverted?.(job);
      } catch {
        // Attempted once per page session. A conflict means a peer already
        // converted the message; anything else is retried on a later visit.
      }
      if (pending.length > 0) {
        await sleep(job.kind === "attachment" ? attachmentInterval : textInterval);
      }
    }
  }

  function start() {
    if (running) return;
    running = drain().finally(() => {
      running = null;
      if (pending.length > 0) start();
    });
  }

  return {
    enqueue(job) {
      const key = e2eRescueJobKey(job);
      if (attempted.has(key)) return false;
      attempted.add(key);
      pending.push(job);
      start();
      return true;
    },
    idle() {
      return running ?? Promise.resolve();
    },
  };
}
