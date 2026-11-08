#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
grep -q "'PICKED_UP'" "$ROOT/database/schema.sql"
grep -q "UPDATE orders SET status='PICKED_UP'" "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q 'const expected = action === "PICKED_UP" ? "PICKED_UP"' "$ROOT/backend/src/modules/delivery/service.ts"
grep -q "z.literal('CUSTOMER')" "$ROOT/backend/src/modules/auth/auth.routes.ts"
for f in "$ROOT"/database/migrations/0*.sql; do test -s "$f"; done
grep -q "JWT_SECRET must be explicitly configured" "$ROOT/backend/src/config/env.ts"
grep -q "SELECT status FROM orders WHERE id=\$1 FOR UPDATE" "$ROOT/backend/src/modules/orders/order.service.ts"
grep -q "o.total_cents" "$ROOT/database/migrations/012_admin_audit.sql"
grep -q 'COALESCE(driver_profile_id, driver_id) AS driver_id' "$ROOT/backend/src/modules/orders/order.service.ts"
grep -q 'order.rows\[0\].status !== "READY"' "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q "UPDATE orders SET status='READY', driver_profile_id=NULL" "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q "FOR UPDATE OF da, o" "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q 'rows\[0\].order_status !== "ASSIGNED"' "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q 'rows\[0\].assigned_driver_profile_id !== driverId' "$ROOT/backend/src/modules/dispatch/service.ts"
! grep -q "o.total_amount" "$ROOT/database/migrations/012_admin_audit.sql"

grep -q 'rows\[0\].assigned_driver_profile_id === driverId' "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q "status='ASSIGNED' AND driver_profile_id=\$2" "$ROOT/backend/src/modules/dispatch/service.ts"
grep -q 'listOrdersForActor(req.user!)' "$ROOT/backend/src/modules/orders/order.routes.ts"
grep -q 'getOrderForActor(req.params.id as string,req.user!)' "$ROOT/backend/src/modules/orders/order.routes.ts"
grep -q "ORDER_FORBIDDEN" "$ROOT/backend/src/modules/orders/order.service.ts"
grep -q 'ORDER_NOT_ASSIGNED_TO_DRIVER' "$ROOT/backend/src/modules/delivery/service.ts"
grep -q 'Driver profile access denied' "$ROOT/backend/src/modules/final-routes/routes.ts"
grep -q 'Merchant access denied' "$ROOT/backend/src/modules/final-routes/routes.ts"

# Order authorization and status transition must share one transaction/row lock.
grep -q "export async function transitionOrderForActor" "$ROOT/backend/src/modules/orders/order.service.ts"
grep -q "FOR UPDATE OF o" "$ROOT/backend/src/modules/orders/order.service.ts"
grep -q "transitionOrderForActor(req.params.id" "$ROOT/backend/src/modules/orders/order.routes.ts"

grep -q "driver_profiles WHERE id=\$1 AND user_id=\$2" "$ROOT/backend/src/modules/final-routes/routes.ts"

# Payment idempotency must serialize concurrent first-time requests.
grep -q "pg_advisory_xact_lock(hashtextextended" "$ROOT/backend/src/modules/payments/payment.service.ts"
# Ledger entries must use the order's currency, never a hard-coded USD value.
grep -q "p.amount_cents,o.currency" "$ROOT/backend/src/modules/payments/payment.service.ts"
# Refund ledger writes are intentionally absent until provider-confirmed refunds exist.
! grep -q "amount_cents,'USD' FROM payments" "$ROOT/backend/src/modules/payments/payment.service.ts"

# Settlement ownership and payout integrity checks.
grep -q 'order.rows\[0\].merchant_id !== merchantId' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q 'order.rows\[0\].driver_profile_id !== driverId' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q 'Number.isSafeInteger(amount)' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q "SETTLEMENT_ALREADY_EXISTS" "$ROOT/backend/src/modules/settlements/service.ts"
grep -q "PAYMENT_NOT_CAPTURED" "$ROOT/backend/src/modules/settlements/service.ts"
! grep -q "DO UPDATE SET" "$ROOT/backend/src/modules/settlements/service.ts"

# Settlement calculations use exact minor units and match the order's actual gross.
grep -q 'gross_amount_cents' "$ROOT/database/migrations/014_settlement_minor_units.sql"
grep -q 'total_cents !== grossAmountCents' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q 'driverNetCents' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q 'merchantNetCents' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q 'order.rows\[0\].currency' "$ROOT/backend/src/modules/settlements/service.ts"

# Fresh-install bootstrap: base schema must not alter feature tables before migrations.
! grep -q 'ALTER TABLE driver_earnings' "$ROOT/database/schema.sql"
! grep -q 'ALTER TABLE merchant_settlements' "$ROOT/database/schema.sql"
test -x "$ROOT/database/migrate.sh"
grep -q 'DATABASE_URL must be set' "$ROOT/database/migrate.sh"

# Never mark earnings/settlements paid without provider confirmation.
grep -q 'PAYOUT_PROVIDER_CONFIRMATION_REQUIRED' "$ROOT/backend/src/modules/settlements/service.ts"
! grep -q "SET status='PAID', paid_at=now()" "$ROOT/backend/src/modules/settlements/service.ts"

# Delivery completion must enqueue settlement work transactionally and idempotently.
grep -q "INSERT INTO event_outbox" "$ROOT/backend/src/modules/delivery/service.ts"
grep -q 'settlement-requested:' "$ROOT/backend/src/modules/delivery/service.ts"
grep -q "CREATE TABLE IF NOT EXISTS event_outbox" "$ROOT/database/migrations/015_settlement_outbox.sql"
grep -q "ON CONFLICT (dedupe_key) DO NOTHING" "$ROOT/backend/src/modules/delivery/service.ts"

# Outbox worker claims with row-level concurrency control and leases.
grep -q 'FOR UPDATE SKIP LOCKED' "$ROOT/backend/src/modules/settlements/outbox-worker.ts"
grep -q "lease_until=now()" "$ROOT/backend/src/modules/settlements/outbox-worker.ts"
grep -q 'PAYOUT_PROVIDER_CONFIRMATION_REQUIRED' "$ROOT/backend/src/modules/settlements/service.ts"
grep -q "'BLOCKED'" "$ROOT/database/migrations/015_settlement_outbox.sql"

grep -q 'lease_token=$2' "$ROOT/backend/src/modules/settlements/outbox-worker.ts"

# Worker must verify lease ownership before reporting successful completion.
grep -q "RETURNING id" "$ROOT/backend/src/modules/settlements/outbox-worker.ts"
grep -q "completed.rowCount !== 1" "$ROOT/backend/src/modules/settlements/outbox-worker.ts"


# Outbox worker behavior has focused unit coverage.
test -s "$ROOT/backend/src/modules/settlements/outbox-worker.test.ts"
grep -q 'returns EMPTY' "$ROOT/backend/src/modules/settlements/outbox-worker.test.ts"
grep -q 'another worker reclaimed the lease' "$ROOT/backend/src/modules/settlements/outbox-worker.test.ts"
grep -q 'configured attempt limit' "$ROOT/backend/src/modules/settlements/outbox-worker.test.ts"
# Delivery completion is covered by transaction/outbox unit tests.
test -s "$ROOT/backend/src/modules/delivery/service.test.ts"
grep -q "writes the settlement request in the delivery transaction" "$ROOT/backend/src/modules/delivery/service.test.ts"
grep -q "rolls back delivery completion" "$ROOT/backend/src/modules/delivery/service.test.ts"
# Settlement calculations remain gated on explicit owner-approved finance rules.
test -s "$ROOT/docs/SETTLEMENT_FINANCIAL_POLICY_GATE.md"
grep -q "BLOCKED — business rules require owner approval" "$ROOT/docs/SETTLEMENT_FINANCIAL_POLICY_GATE.md"
grep -q "do not create payable balances" "$ROOT/docs/SETTLEMENT_FINANCIAL_POLICY_GATE.md"
# Financial policy audit structures are versioned; no calculation is enabled by this migration.
test -s "$ROOT/database/migrations/016_financial_policy_audit.sql"
grep -q "settlement_policy_versions" "$ROOT/database/migrations/016_financial_policy_audit.sql"
grep -q "settlement_calculations" "$ROOT/database/migrations/016_financial_policy_audit.sql"
grep -q "settlement_allocation_lines" "$ROOT/database/migrations/016_financial_policy_audit.sql"
grep -q "policy_version_id" "$ROOT/database/migrations/016_financial_policy_audit.sql"
# Financial allocation arithmetic is exact, currency-consistent, and policy-neutral.
test -s "$ROOT/backend/src/modules/settlements/allocation-validator.ts"
grep -q 'SETTLEMENT_ALLOCATION_TOTAL_MISMATCH' "$ROOT/backend/src/modules/settlements/allocation-validator.ts"
grep -q 'SETTLEMENT_ALLOCATION_CURRENCY_MISMATCH' "$ROOT/backend/src/modules/settlements/allocation-validator.ts"
grep -q 'BigInt(value)' "$ROOT/backend/src/modules/settlements/allocation-validator.ts"
test -s "$ROOT/backend/src/modules/settlements/allocation-validator.test.ts"
grep -q 'supports exact values beyond JavaScript' "$ROOT/backend/src/modules/settlements/allocation-validator.test.ts"
# Live payment provider must fail closed until official provider integration exists.
grep -q 'PAYMENT_PROVIDER_NOT_IMPLEMENTED' "$ROOT/backend/src/modules/payments/provider.ts"
grep -q 'fails closed for Stripe' "$ROOT/backend/src/modules/payments/payment.service.test.ts"
grep -q 'REFUND_PROVIDER_NOT_IMPLEMENTED' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'fails closed instead of recording an unconfirmed refund' "$ROOT/backend/src/modules/payments/payment.service.test.ts"
grep -q 'p.provider=\$2' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'PRIMARY KEY (provider,event_id)' "$ROOT/database/migrations/017_provider_scoped_payment_events.sql"
grep -q 'ON CONFLICT(provider,event_id) DO NOTHING' "$ROOT/backend/src/modules/payments/payment.service.ts"
! grep -q 'ON CONFLICT(event_id) DO NOTHING' "$ROOT/backend/src/modules/payments/payment.service.ts"
test -s "$ROOT/docs/PAYMENT_PROVIDER_RELEASE_GATE.md"

# Webhook payloads must use a supported event/status pair and provider route.
grep -q 'WEBHOOK_EVENT_STATUS_MISMATCH' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q "type:z.enum(\['PAYMENT_SUCCEEDED','PAYMENT_FAILED'\])" "$ROOT/backend/src/modules/payments/payment.routes.ts"
grep -q "Unsupported payment provider" "$ROOT/backend/src/modules/payments/payment.routes.ts"
grep -q 'rejects a success event carrying a failed status' "$ROOT/backend/src/modules/payments/payment.service.test.ts"

# Webhook amount, currency, and provider reference must match the stored payment before ledger writes.
grep -q 'validatePaymentWebhookDetails(input' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'WEBHOOK_AMOUNT_MISMATCH' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'WEBHOOK_CURRENCY_MISMATCH' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'WEBHOOK_PROVIDER_REFERENCE_MISMATCH' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'provider_reference' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'providerReference:z.string().min(1)' "$ROOT/backend/src/modules/payments/payment.routes.ts"
grep -q 'rejects a provider reference that differs' "$ROOT/backend/src/modules/payments/payment.service.test.ts"
test -s "$ROOT/docs/PAYMENT_WEBHOOK_AMOUNT_MATCH_GATE.md"
test -s "$ROOT/docs/PAYMENT_WEBHOOK_ORDER_STATE_GATE.md"
# Distinct idempotency keys cannot create concurrent live payment attempts for one order.
grep -q 'PAYMENT_ATTEMPT_ALREADY_ACTIVE' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q "status IN ('PENDING','SUCCEEDED')" "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'one active payment attempt per order' "$ROOT/backend/src/modules/payments/payment.service.test.ts"
test -s "$ROOT/docs/PAYMENT_ONE_ACTIVE_ATTEMPT_GATE.md"
# A success webhook cannot settle an order that is cancelled or otherwise closed.
grep -q 'validatePaymentOrderState(payment.rows\[0\].order_status)' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'WEBHOOK_ORDER_STATE_BLOCKED' "$ROOT/backend/src/modules/payments/payment.service.ts"
grep -q 'blocks payment finalization for cancelled' "$ROOT/backend/src/modules/payments/payment.service.test.ts"
test -x "$ROOT/database/migrate.sh"
# Production CORS is exact-origin allow-listed and errors are sanitized.
grep -q 'CORS_ORIGINS' "$ROOT/backend/src/config/env.ts"
grep -q 'allowedOrigins.includes(origin)' "$ROOT/backend/src/server.ts"
grep -q "env.NODE_ENV !== 'production'" "$ROOT/backend/src/server.ts"
grep -q "return res.status(500).json({ error: 'Internal server error' })" "$ROOT/backend/src/server.ts"
test -s "$ROOT/docs/RECOVERY_V45_API_PERIMETER.md"

echo "STATIC_QA_PASS"
