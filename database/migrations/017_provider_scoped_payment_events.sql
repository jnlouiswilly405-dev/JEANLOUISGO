-- Payment event identifiers are scoped to a provider. Existing event_id values
-- are globally unique, so converting the key is lossless for current data.
ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_pkey;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_provider_event_pk PRIMARY KEY (provider,event_id);
