-- Auditable financial policy versions and settlement calculation snapshots.
-- This migration adds structure only; it defines no fee rates or payout formulas.

CREATE TABLE IF NOT EXISTS settlement_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'RETIRED')),
  policy_document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (policy_key, version),
  CHECK (
    (status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status <> 'APPROVED'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_approved_settlement_policy
  ON settlement_policy_versions(policy_key)
  WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS settlement_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  policy_version_id UUID NOT NULL REFERENCES settlement_policy_versions(id),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'REVIEWED', 'APPROVED', 'REVERSED')),
  source_snapshot JSONB NOT NULL,
  currency CHAR(3) NOT NULL,
  total_allocated_minor BIGINT NOT NULL DEFAULT 0
    CHECK (total_allocated_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  UNIQUE (order_id, policy_version_id)
);

CREATE TABLE IF NOT EXISTS settlement_allocation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id UUID NOT NULL REFERENCES settlement_calculations(id) ON DELETE RESTRICT,
  line_key TEXT NOT NULL,
  component TEXT NOT NULL,
  beneficiary_type TEXT NOT NULL
    CHECK (beneficiary_type IN ('DRIVER', 'MERCHANT', 'PLATFORM', 'TAX_AUTHORITY', 'CUSTOMER', 'OTHER')),
  beneficiary_id UUID,
  funding_party TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (calculation_id, line_key)
);

CREATE INDEX IF NOT EXISTS idx_settlement_calculations_order
  ON settlement_calculations(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_allocation_calculation
  ON settlement_allocation_lines(calculation_id);
