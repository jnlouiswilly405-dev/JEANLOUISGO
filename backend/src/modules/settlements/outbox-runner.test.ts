import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("./outbox-worker.js", () => ({ processNextOutboxEvent: vi.fn() }));

import { processNextOutboxEvent } from "./outbox-worker.js";
import { blockedSettlementHandler, isOutboxWorkerEnabled, startOutboxRunner } from "./outbox-runner.js";

const mocked = vi.mocked(processNextOutboxEvent);
const pool = {} as Pool;
const ORDER = "11111111-1111-4111-8111-111111111111";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1", event_type: "SETTLEMENT_REQUESTED", aggregate_type: "ORDER", aggregate_id: ORDER,
    dedupe_key: `settlement-requested:${ORDER}`, payload: { orderId: ORDER }, attempts: 1, lease_token: "tok",
    ...overrides,
  } as Parameters<typeof blockedSettlementHandler>[0];
}

describe("isOutboxWorkerEnabled", () => {
  it("is disabled unless the value is exactly 'true'", () => {
    expect(isOutboxWorkerEnabled(undefined)).toBe(false);
    expect(isOutboxWorkerEnabled("")).toBe(false);
    expect(isOutboxWorkerEnabled("false")).toBe(false);
    expect(isOutboxWorkerEnabled("1")).toBe(false);
    expect(isOutboxWorkerEnabled("TRUE")).toBe(false);
    expect(isOutboxWorkerEnabled("true")).toBe(true);
  });
});

describe("blockedSettlementHandler", () => {
  it("always fails closed for a valid settlement request", async () => {
    await expect(blockedSettlementHandler(event())).rejects.toThrow("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
  });

  it("rejects unexpected event or aggregate types", async () => {
    await expect(blockedSettlementHandler(event({ event_type: "OTHER" }))).rejects.toThrow("OUTBOX_EVENT_INVALID:event_type");
    await expect(blockedSettlementHandler(event({ aggregate_type: "DRIVER" }))).rejects.toThrow("OUTBOX_EVENT_INVALID:aggregate_type");
  });

  it("rejects malformed payloads and orderId/aggregate mismatches", async () => {
    for (const payload of [null, {}, { orderId: 5 }, { orderId: "not-a-uuid" }, { orderId: "22222222-2222-4222-8222-222222222222" }]) {
      await expect(blockedSettlementHandler(event({ payload }))).rejects.toThrow("OUTBOX_EVENT_INVALID:payload");
    }
  });
});

describe("startOutboxRunner", () => {
  beforeEach(() => { mocked.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(cond()).toBe(true);
  };

  it("drains available events, then waits for the next poll", async () => {
    mocked.mockResolvedValueOnce("FAILED").mockResolvedValueOnce("PROCESSED").mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 10000 });
    await waitFor(() => mocked.mock.calls.length >= 3);
    await new Promise((r) => setTimeout(r, 30));
    expect(mocked).toHaveBeenCalledTimes(3);
    await runner.stop();
  });

  it("passes the attempt limit through and uses a wrapped handler", async () => {
    mocked.mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, maxAttempts: 3, intervalMs: 10000 });
    await waitFor(() => mocked.mock.calls.length >= 1);
    expect(mocked.mock.calls[0][0]).toBe(pool);
    expect(mocked.mock.calls[0][2]).toBe(3);
    await runner.stop();
  });

  it("logs handler failures with the terminal outcome and rethrows to the worker", async () => {
    const logs: string[] = [];
    mocked.mockImplementationOnce(async (_pool, handler) => {
      try { await handler(event({ attempts: 3 })); return "PROCESSED"; } catch { return "FAILED"; }
    });
    mocked.mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, maxAttempts: 3, intervalMs: 10000, log: (m) => logs.push(m) });
    await waitFor(() => logs.length >= 1);
    await runner.stop();
    expect(logs[0]).toContain("evt-1");
    expect(logs[0]).toContain("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
    expect(logs[0]).toContain("[BLOCKED]");
  });

  it("survives worker errors and keeps polling", async () => {
    const logs: string[] = [];
    mocked.mockRejectedValueOnce(new Error("db down")).mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 10, log: (m) => logs.push(m) });
    await waitFor(() => mocked.mock.calls.length >= 2);
    await runner.stop();
    expect(logs.some((l) => l.includes("db down"))).toBe(true);
  });

  it("stops promptly while sleeping and does not poll again", async () => {
    mocked.mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 60000 });
    await waitFor(() => mocked.mock.calls.length >= 1);
    const started = Date.now();
    await runner.stop();
    expect(Date.now() - started).toBeLessThan(1000);
    const calls = mocked.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(mocked).toHaveBeenCalledTimes(calls);
  });

  it("waits for an in-flight event before stop() resolves", async () => {
    let release!: () => void;
    mocked.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve("PROCESSED"); }));
    mocked.mockResolvedValue("EMPTY");
    const runner = startOutboxRunner({ pool, handler: blockedSettlementHandler, intervalMs: 10000 });
    await waitFor(() => mocked.mock.calls.length >= 1);
    let stopped = false;
    const stopping = runner.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 30));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});
