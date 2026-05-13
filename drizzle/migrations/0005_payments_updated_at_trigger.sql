-- Finding #22: Auto-update trigger for payments.updated_at
-- Ensures updated_at is always set to the current Unix timestamp on every UPDATE,
-- so the application layer never needs to manually set this field.
CREATE TRIGGER trg_payments_updated_at
AFTER UPDATE ON payments
FOR EACH ROW
BEGIN
  UPDATE payments SET updated_at = unixepoch() WHERE id = NEW.id;
END;