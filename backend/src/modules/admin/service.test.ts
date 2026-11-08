import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { listBlockedOutboxEvents, sanitizeOutboxError } from "./service.js";

describe("sanitizeOutboxError", () => {
  it("keeps plain error codes and passes null through", () => {
    expect(sanitizeOutboxError("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED")).toBe("PAYOUT_PROVIDER_CONFIRMATION_REQUIRED");
    expect(sanitizeOutboxError(null)).toBeNull();
  });

  it("redacts connection strings, bearer tokens, provider keys and long opaque strings", () => {
    const out = sanitizeOutboxError(
      "failed postgres://user:pw@db:5432/x Bearer abc.def sk_live_ABC123 whsec_XYZ " + "a".repeat(40),
    )!;
    expect(out).not.toContain("user:pw");
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("sk_live");
    expect(out).not.toContain("whsec_XYZ");
    expect(out).not.toContain("a".repeat(32));
  });

  it("keeps only the first line and caps the length", () => {
    expect(sanitizeOutboxError("first\nsecond stack line")).toBe("first");
    expect(sanitizeOutboxError("x ".repeat(500))!.length).toBe(200);
  });
});

describe("listBlockedOutboxEvents", () => {
  const makePool = () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("count(*)") ? { rows: [{ n: 1 }] } : { rows: [{
        id: "e1", event_type: "SETTLEMENT_REQUESTED", aggregate_type: "ORDER", aggregate_id: "o1", status: "BLOCKED",
        attempts: 8, created_at: "c", available_at: "a", processed_at: null, last_error: "boom",
      }] });
    return { pool: { query } as unknown as Pool, query };
  };

  it("only queries BLOCKED events and never selects payload or lease columns", async () => {
    const { pool, query } = makePool();
    const result = await listBlockedOutboxEvents(pool, { eventType: "SETTLEMENT_REQUESTED" });
    const sql = query.mock.calls.map((c) => c[0] as string).join("\n");
    expect(sql).toContain("status='BLOCKED'");
    expect(sql).not.toMatch(/payload|lease_token|dedupe_key/);
    expect(Object.keys(result.items[0]).sort()).not.toContain("payload");
    expect(result.items[0].failureReason).toBe("boom");
  });

  it("clamps pagination", async () => {
    const { pool } = makePool();
    expect(await listBlockedOutboxEvents(pool, { limit: 5000, offset: -3 })).toMatchObject({ limit: 100, offset: 0 });
  });
});
