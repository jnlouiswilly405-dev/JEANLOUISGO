import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../../..");
const wfDir = join(root, ".github/workflows");

describe("Stripe sandbox E2E cannot run accidentally", () => {
  it("only the manual workflow sets STRIPE_SANDBOX_E2E or reads a Stripe secret", () => {
    for (const f of readdirSync(wfDir)) {
      const text = readFileSync(join(wfDir, f), "utf8");
      if (f === "stripe-sandbox-e2e.yml") continue;
      expect(text, f).not.toMatch(/STRIPE_SANDBOX_E2E|STRIPE_SECRET_KEY|STRIPE_TEST_SECRET_KEY|secrets\.STRIPE/);
    }
  });

  it("the manual workflow is dispatch-only, test-key-only and gated by an environment", () => {
    const t = readFileSync(join(wfDir, "stripe-sandbox-e2e.yml"), "utf8");
    expect(t).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(t).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(t).toMatch(/environment: stripe-sandbox/);
    expect(t).toMatch(/sk_test_\*\|rk_test_\*\)/);
    expect(t).not.toMatch(/sk_live|rk_live|pk_live/);
  });

  it("the E2E test file is skipped unless explicitly enabled and aborts on live keys", () => {
    const t = readFileSync(join(root, "backend/integration/stripe-sandbox-e2e.int.ts"), "utf8");
    expect(t).toMatch(/STRIPE_SANDBOX_E2E === '1'/);
    expect(t).toMatch(/rk_test_/);
    expect(t).toMatch(/STRIPE_LIVE_KEYS_FORBIDDEN/);
    expect(t).toMatch(/describe\.skipIf\(!enabled\)/);
  });
});
