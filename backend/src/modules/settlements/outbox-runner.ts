import type { Pool } from "pg";
import { processNextOutboxEvent, type OutboxHandler } from "./outbox-worker.js";

type OutboxEvent = Parameters<OutboxHandler>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The worker is off unless the flag is exactly the string "true". */
export function isOutboxWorkerEnabled(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Fail-closed handler for settlement requests. Settlement amounts depend on a
 * financial policy that has not been approved, so this validates the event and
 * then always throws. It never touches the database, so it cannot create
 * earnings, ledger entries, settlements or payouts, or mark anything PAID.
 */
export const blockedSettlementHandler: OutboxHandler = async (event: OutboxEvent) => {
  if (event.event_type !== "SETTLEMENT_REQUESTED") throw new Error("OUTBOX_EVENT_INVALID:event_type");
  if (event.aggregate_type !== "ORDER") throw new Error("OUTBOX_EVENT_INVALID:aggregate_type");
  const orderId = (event.payload as { orderId?: unknown } | null)?.orderId;
  if (typeof orderId !== "string" || !UUID_RE.test(orderId) || orderId !== event.aggregate_id) {
    throw new Error("OUTBOX_EVENT_INVALID:payload");
  }
  throw new Error("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
};

export interface OutboxRunnerOptions {
  pool: Pool;
  handler: OutboxHandler;
  intervalMs?: number;
  maxAttempts?: number;
  log?: (message: string) => void;
}

export interface OutboxRunner {
  /** Stops polling and resolves after any in-flight event has finished. */
  stop(): Promise<void>;
}

/** Polls the outbox sequentially. Never overlaps with itself and never throws. */
export function startOutboxRunner(options: OutboxRunnerOptions): OutboxRunner {
  const { pool, intervalMs = 5000, maxAttempts = 8, log = () => {} } = options;
  let stopped = false;
  let wake: (() => void) | undefined;

  const handler: OutboxHandler = async (event) => {
    try {
      await options.handler(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN_OUTBOX_ERROR";
      const outcome = event.attempts >= maxAttempts ? "BLOCKED" : "will retry";
      log(`outbox event ${event.id} (${event.event_type}) attempt ${event.attempts} failed: ${message} [${outcome}]`);
      throw error;
    }
  };

  const sleep = () => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    wake = () => { clearTimeout(timer); resolve(); };
  });

  const loop = (async () => {
    while (!stopped) {
      try {
        let result: string;
        do {
          result = await processNextOutboxEvent(pool, handler, maxAttempts);
        } while (result !== "EMPTY" && !stopped);
      } catch (error) {
        log(`outbox runner error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!stopped) await sleep();
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
