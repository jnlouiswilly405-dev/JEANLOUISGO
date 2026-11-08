import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { processNextOutboxEvent } from "./outbox-worker.js";

function makePool(options: {
  claimedRows?: Array<Record<string, unknown>>;
  completionRowCount?: number;
  failHandler?: boolean;
  maxAttempts?: number;
} = {}) {
  const event = {
    id: "event-1",
    event_type: "SETTLEMENT_REQUESTED",
    aggregate_type: "ORDER",
    aggregate_id: "order-1",
    dedupe_key: "settlement-requested:order-1",
    payload: { orderId: "order-1" },
    attempts: options.maxAttempts ?? 1,
    lease_token: "lease-token-1",
  };
  const clientQuery = vi.fn(async (sql: string) => {
    if (sql.includes("WITH candidate AS")) {
      return { rows: options.claimedRows ?? [event], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const poolQuery = vi.fn(async (sql: string) => {
    if (sql.includes("SET status='PROCESSED'")) {
      return { rows: [], rowCount: options.completionRowCount ?? 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query: clientQuery, release: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client),
    query: poolQuery,
  } as unknown as Pool;
  return { pool, client, clientQuery, poolQuery, event };
}

describe("settlement outbox worker", () => {
  it("returns EMPTY when no event is available", async () => {
    const mock = makePool({ claimedRows: [] });
    const handler = vi.fn(async () => undefined);

    await expect(processNextOutboxEvent(mock.pool, handler)).resolves.toBe("EMPTY");
    expect(handler).not.toHaveBeenCalled();
    expect(mock.client.release).toHaveBeenCalledOnce();
  });

  it("claims an event and marks it processed only while holding its lease", async () => {
    const mock = makePool();
    const handler = vi.fn(async () => undefined);

    await expect(processNextOutboxEvent(mock.pool, handler)).resolves.toBe("PROCESSED");
    expect(handler).toHaveBeenCalledWith(mock.event);
    expect(mock.clientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mock.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mock.poolQuery.mock.calls[0][0]).toContain("lease_token=$2");
  });

  it("does not report success if another worker reclaimed the lease", async () => {
    const mock = makePool({ completionRowCount: 0 });
    const handler = vi.fn(async () => undefined);

    await expect(processNextOutboxEvent(mock.pool, handler)).resolves.toBe("FAILED");
  });

  it("blocks an event after its configured attempt limit", async () => {
    const mock = makePool({ maxAttempts: 3 });
    const handler = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(processNextOutboxEvent(mock.pool, handler, 3)).resolves.toBe("FAILED");
    const retryUpdate = mock.poolQuery.mock.calls[0] as unknown as [string, unknown[]];
    expect(retryUpdate[0]).toContain("last_error=$4");
    expect(retryUpdate[1]).toContain("BLOCKED");
  });
});
