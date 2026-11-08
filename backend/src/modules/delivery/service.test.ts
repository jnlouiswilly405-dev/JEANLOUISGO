import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { advanceDelivery } from "./service.js";

function makePool(options: { failOutbox?: boolean } = {}) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM orders WHERE id=$1 FOR UPDATE")) {
        return {
          rows: [{
            id: "order-1",
            status: "IN_TRANSIT",
            driver_profile_id: "driver-profile-1",
            merchant_id: "merchant-1",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM driver_profiles WHERE user_id=$1")) {
        return { rows: [{ id: "driver-profile-1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO delivery_events")) {
        return { rows: [{ id: "delivery-event-1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO event_outbox")) {
        if (options.failOutbox) throw new Error("OUTBOX_INSERT_FAILED");
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, calls };
}

describe("delivery completion settlement event", () => {
  it("writes the settlement request in the delivery transaction", async () => {
    const mock = makePool();

    await advanceDelivery(mock.pool, "order-1", "driver-user-1", "DELIVERED");

    const sql = mock.calls.map((call) => call.sql);
    const beginIndex = sql.indexOf("BEGIN");
    const outboxIndex = sql.findIndex((query) => query.includes("INSERT INTO event_outbox"));
    const commitIndex = sql.indexOf("COMMIT");
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(outboxIndex).toBeGreaterThan(beginIndex);
    expect(commitIndex).toBeGreaterThan(outboxIndex);

    const outboxCall = mock.calls[outboxIndex];
    expect(outboxCall.params?.[0]).toBe("order-1");
    expect(outboxCall.params?.[1]).toBe("settlement-requested:order-1");
    expect(JSON.parse(String(outboxCall.params?.[2]))).toMatchObject({
      orderId: "order-1",
      driverProfileId: "driver-profile-1",
      merchantId: "merchant-1",
    });
    expect(mock.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back delivery completion if the settlement event cannot be persisted", async () => {
    const mock = makePool({ failOutbox: true });

    await expect(
      advanceDelivery(mock.pool, "order-1", "driver-user-1", "DELIVERED"),
    ).rejects.toThrow("OUTBOX_INSERT_FAILED");

    const sql = mock.calls.map((call) => call.sql);
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    expect(mock.client.release).toHaveBeenCalledOnce();
  });
});
