import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapStripeEvent, readStripeSandboxConfig, StripePaymentProvider, type StripeLikeClient,
} from "./stripe-provider.js";
import { getProvider } from "./provider.js";
import { refundPayment } from "./payment.service.js";

const SECRET = "whsec_unit_test_secret";
const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const signer = new Stripe("sk_test_unit");

function fakeClient() {
  const intentsCreate = vi.fn(async (_params: Record<string, unknown>, _options?: { idempotencyKey?: string }) => ({ id: "pi_test_123", client_secret: "pi_test_123_secret_abc" }));
  const refundsCreate = vi.fn(async (_params: Record<string, unknown>, _options?: { idempotencyKey?: string }) => ({ id: "re_test_1", status: "succeeded" }));
  const client = {
    paymentIntents: { create: intentsCreate },
    refunds: { create: refundsCreate },
    webhooks: signer.webhooks,
  } as unknown as StripeLikeClient;
  return { client, intentsCreate, refundsCreate };
}

function eventBody(type: string, intent: Record<string, unknown>, id = "evt_test_1") {
  return JSON.stringify({ id, object: "event", type, data: { object: { object: "payment_intent", ...intent } } });
}
const sign = (payload: string, secret = SECRET, timestamp?: number) =>
  signer.webhooks.generateTestHeaderString({ payload, secret, timestamp });

describe("readStripeSandboxConfig", () => {
  it("stays disabled (null) unless both a test key and a webhook secret are set", () => {
    expect(readStripeSandboxConfig({})).toBeNull();
    expect(readStripeSandboxConfig({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBeNull();
    expect(readStripeSandboxConfig({ STRIPE_WEBHOOK_SECRET: SECRET })).toBeNull();
  });

  it("accepts only test-mode secret keys and refuses live keys", () => {
    expect(readStripeSandboxConfig({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET })).toEqual({ secretKey: "sk_test_abc", webhookSecret: SECRET });
    expect(readStripeSandboxConfig({ STRIPE_SECRET_KEY: "rk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET })).toEqual({ secretKey: "rk_test_abc", webhookSecret: SECRET });
    expect(readStripeSandboxConfig({ STRIPE_SECRET_KEY: " \trk_test_abc \n", STRIPE_WEBHOOK_SECRET: SECRET })).toEqual({ secretKey: "rk_test_abc", webhookSecret: SECRET });
    expect(readStripeSandboxConfig({ STRIPE_SECRET_KEY: " \t ", STRIPE_WEBHOOK_SECRET: SECRET })).toBeNull();
    expect(() => readStripeSandboxConfig({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: SECRET })).toThrow("STRIPE_LIVE_KEYS_FORBIDDEN");
    expect(() => readStripeSandboxConfig({ STRIPE_SECRET_KEY: " rk_live_abc ", STRIPE_WEBHOOK_SECRET: SECRET })).toThrow("STRIPE_LIVE_KEYS_FORBIDDEN");
    expect(() => readStripeSandboxConfig({ STRIPE_SECRET_KEY: "rk_live_abc", STRIPE_WEBHOOK_SECRET: SECRET })).toThrow("STRIPE_LIVE_KEYS_FORBIDDEN");
    expect(() => readStripeSandboxConfig({ STRIPE_SECRET_KEY: "pk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET })).toThrow("STRIPE_SECRET_KEY_INVALID");
    expect(() => readStripeSandboxConfig({ STRIPE_SECRET_KEY: "sk_test_abc!", STRIPE_WEBHOOK_SECRET: SECRET })).toThrow("STRIPE_SECRET_KEY_INVALID");
  });
});

describe("getProvider('stripe')", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("is disabled by default", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(() => getProvider("stripe")).toThrow("PAYMENT_PROVIDER_NOT_IMPLEMENTED");
  });

  it("refuses live keys", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    expect(() => getProvider("stripe")).toThrow("STRIPE_LIVE_KEYS_FORBIDDEN");
  });
});

describe("StripePaymentProvider.createPayment", () => {
  it("creates a PaymentIntent from server-side values, forwards the idempotency key and stays PENDING", async () => {
    const { client, intentsCreate } = fakeClient();
    const result = await new StripePaymentProvider(client, SECRET).createPayment({
      paymentId: PAYMENT_ID, orderId: ORDER_ID, amountCents: 1999, currency: "USD", idempotencyKey: "idem-key-1234567890",
    });
    expect(result).toEqual({ provider: "stripe", providerReference: "pi_test_123", status: "PENDING", clientSecret: "pi_test_123_secret_abc" });
    expect(intentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1999, currency: "usd", metadata: { paymentId: PAYMENT_ID, orderId: ORDER_ID } }),
      { idempotencyKey: "idem-key-1234567890" },
    );
  });

  it("falls back to a payment-scoped idempotency key", async () => {
    const { client, intentsCreate } = fakeClient();
    await new StripePaymentProvider(client, SECRET).createPayment({ paymentId: PAYMENT_ID, orderId: ORDER_ID, amountCents: 100, currency: "usd" });
    expect(intentsCreate.mock.calls[0][1]).toEqual({ idempotencyKey: `payment-${PAYMENT_ID}` });
  });
});

describe("webhook signature verification", () => {
  const provider = new StripePaymentProvider(fakeClient().client, SECRET);
  const payload = eventBody("payment_intent.succeeded", { id: "pi_test_123" });

  it("accepts a correctly signed payload", () => {
    expect(provider.verifyWebhook(payload, sign(payload))).toBe(true);
    expect(provider.constructEvent(Buffer.from(payload), sign(payload)).id).toBe("evt_test_1");
  });

  it("rejects tampered payloads, wrong secrets, missing/garbage headers and stale timestamps", () => {
    expect(provider.verifyWebhook(payload + " ", sign(payload))).toBe(false);
    expect(provider.verifyWebhook(payload, sign(payload, "whsec_other"))).toBe(false);
    expect(provider.verifyWebhook(payload, "")).toBe(false);
    expect(provider.verifyWebhook(payload, "t=1,v1=deadbeef")).toBe(false);
    expect(provider.verifyWebhook(payload, sign(payload, SECRET, Math.floor(Date.now() / 1000) - 3600))).toBe(false);
  });
});

describe("mapStripeEvent", () => {
  const parse = (body: string) => JSON.parse(body) as Stripe.Event;

  it("maps a succeeded intent using the amount actually received", () => {
    const mapped = mapStripeEvent(parse(eventBody("payment_intent.succeeded", {
      id: "pi_1", amount: 2000, amount_received: 1500, currency: "usd", metadata: { paymentId: PAYMENT_ID },
    })));
    expect(mapped).toEqual({
      eventId: "evt_test_1", type: "PAYMENT_SUCCEEDED", status: "SUCCEEDED", paymentId: PAYMENT_ID,
      amountCents: 1500, currency: "USD", providerReference: "pi_1",
    });
  });

  it("maps a failed intent", () => {
    const mapped = mapStripeEvent(parse(eventBody("payment_intent.payment_failed", {
      id: "pi_2", amount: 700, amount_received: 0, currency: "eur", metadata: { paymentId: PAYMENT_ID },
    })));
    expect(mapped).toMatchObject({ type: "PAYMENT_FAILED", status: "FAILED", amountCents: 700, currency: "EUR" });
  });

  it("ignores unrelated events and rejects intents without a valid paymentId", () => {
    expect(mapStripeEvent(parse(eventBody("charge.refunded", { id: "ch_1" })))).toBeNull();
    for (const metadata of [{}, { paymentId: "not-a-uuid" }]) {
      expect(() => mapStripeEvent(parse(eventBody("payment_intent.succeeded", { id: "pi_3", amount: 1, amount_received: 1, currency: "usd", metadata })))).toThrow("WEBHOOK_PAYMENT_ID_MISSING");
    }
  });
});

describe("refunds", () => {
  it("provider refund call targets the PaymentIntent with an idempotency key (sandbox-level only)", async () => {
    const { client, refundsCreate } = fakeClient();
    const out = await new StripePaymentProvider(client, SECRET).createRefund({ providerReference: "pi_test_123", amountCents: 250, idempotencyKey: "refund-key-1" });
    expect(out).toEqual({ refundId: "re_test_1", status: "succeeded" });
    expect(refundsCreate).toHaveBeenCalledWith({ payment_intent: "pi_test_123", amount: 250 }, { idempotencyKey: "refund-key-1" });
  });

  it("the application refund path stays disabled", async () => {
    await expect(refundPayment(PAYMENT_ID, 100)).rejects.toThrow("REFUND_PROVIDER_NOT_IMPLEMENTED");
  });
});
