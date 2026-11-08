CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity_time
  ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time
  ON audit_events(actor_user_id, created_at DESC);

CREATE OR REPLACE VIEW admin_order_financial_summary AS
SELECT
  o.id AS order_id,
  o.status,
  o.total_cents,
  p.status AS payment_status,
  de.status AS driver_earning_status,
  ms.status AS merchant_settlement_status
FROM orders o
LEFT JOIN payments p ON p.order_id=o.id
LEFT JOIN driver_earnings de ON de.order_id=o.id
LEFT JOIN merchant_settlements ms ON ms.order_id=o.id;
