-- Transactional outbox for settlement processing after successful delivery.
-- The worker/provider integration is intentionally separate from delivery state changes.
CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'BLOCKED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  lease_token UUID,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox (available_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');
