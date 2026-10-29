ALTER TABLE orders ADD COLUMN refund_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX orders_refund_pending_idx ON orders(promoter_id,attribution_parent_id) WHERE refund_pending;
CREATE INDEX payment_inbox_order_type_idx ON payment_inbox ((payload->>'orderId'), (payload->>'type'));
-- Restore holds for verified refund facts retained before this upgrade.
UPDATE orders o SET refund_pending = true WHERE payment_status <> 'refunded' AND EXISTS (
 SELECT 1 FROM payment_inbox i WHERE i.status <> 'processed'
 AND i.payload->>'orderId' = o.id::text AND i.payload->>'type' = 'refunded'
 AND (i.payload->>'amount')::numeric = o.total_amount
 AND length((i.payload->>'provider') || ':' || (i.payload->>'transactionId')) <= 128
);
DROP INDEX payout_accounts_user_provider_key;
ALTER TABLE payout_accounts ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending','active','retired','rejected')),
 ADD COLUMN replaces_id UUID REFERENCES payout_accounts(id) ON DELETE RESTRICT,
 ADD COLUMN rejection_reason VARCHAR(256);
UPDATE payout_accounts SET status = CASE WHEN verified THEN 'active' ELSE 'pending' END;
CREATE UNIQUE INDEX payout_accounts_active_key ON payout_accounts(user_id,provider) WHERE status = 'active';
CREATE UNIQUE INDEX payout_accounts_pending_key ON payout_accounts(user_id,provider,account_reference) WHERE status = 'pending';
CREATE FUNCTION initialize_payout_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.verified AND NEW.status = 'pending' THEN NEW.status := 'active'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payout_status_initial BEFORE INSERT ON payout_accounts FOR EACH ROW EXECUTE FUNCTION initialize_payout_status();
CREATE FUNCTION protect_payout_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payout identities must be retained'; END IF;
 IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.provider IS DISTINCT FROM OLD.provider
 OR NEW.account_reference IS DISTINCT FROM OLD.account_reference OR NEW.replaces_id IS DISTINCT FROM OLD.replaces_id THEN
   RAISE EXCEPTION 'Payout identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payout_identity_immutable BEFORE UPDATE OR DELETE ON payout_accounts FOR EACH ROW EXECUTE FUNCTION protect_payout_identity();
CREATE TABLE worker_health (
 name VARCHAR(80) PRIMARY KEY, last_success_at TIMESTAMPTZ,
 last_error VARCHAR(80), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE reconciliation_cases (
 id VARCHAR(64) PRIMARY KEY, detail TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 acknowledged_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 resolved_at TIMESTAMPTZ
);
CREATE INDEX reconciliation_cases_status_idx ON reconciliation_cases(status,last_seen_at,id);
