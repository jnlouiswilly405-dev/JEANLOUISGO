CREATE TABLE IF NOT EXISTS driver_location_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES driver_profiles(id),
  order_id UUID REFERENCES orders(id),
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  accuracy_m NUMERIC(8,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  driver_id UUID REFERENCES driver_profiles(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('ASSIGNED','PICKED_UP','ARRIVED','DELIVERED','FAILED','CANCELLED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_driver_time
  ON driver_location_events(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_location_order_time
  ON driver_location_events(order_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_order_time
  ON delivery_events(order_id, created_at DESC);
