BEGIN;
ALTER TABLE withdrawals
 ADD COLUMN rejection_reason VARCHAR(256),
 ADD COLUMN failure_reference VARCHAR(128),
 ADD COLUMN claimed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
 ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);
-- Old rejected references were free text, never successful transfer identities.
UPDATE withdrawals SET rejection_reason=payout_reference, payout_reference=NULL WHERE status='rejected';
UPDATE withdrawals SET claimed_by=reviewed_by WHERE status IN ('processing','paid');
CREATE TABLE withdrawal_actions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 withdrawal_id UUID NOT NULL REFERENCES withdrawals(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 action VARCHAR(20) NOT NULL CHECK (action IN ('start','confirm','reject')),
 from_status VARCHAR(20) NOT NULL,
 to_status VARCHAR(20) NOT NULL,
 version INTEGER NOT NULL CHECK (version > 0),
 reference VARCHAR(128),
 reason VARCHAR(256),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(withdrawal_id, version)
);
CREATE TRIGGER withdrawal_actions_append_only BEFORE UPDATE OR DELETE ON withdrawal_actions
 FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();
CREATE TABLE payment_inbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider VARCHAR(40) NOT NULL,
 event_id VARCHAR(128) NOT NULL,
 payload_hash VARCHAR(64) NOT NULL,
 payload JSONB NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','processed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 last_error VARCHAR(80),
 next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TIMESTAMPTZ(6),
 UNIQUE(provider,event_id)
);
-- Payload is evidence; processing metadata alone may change.
CREATE FUNCTION protect_payment_inbox_payload() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.provider,NEW.event_id,NEW.payload_hash,NEW.payload,NEW.created_at)
 IS DISTINCT FROM (OLD.provider,OLD.event_id,OLD.payload_hash,OLD.payload,OLD.created_at) THEN
  RAISE EXCEPTION 'verified payment evidence is immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_inbox_evidence BEFORE UPDATE OR DELETE ON payment_inbox
 FOR EACH ROW EXECUTE FUNCTION protect_payment_inbox_payload();
CREATE INDEX payment_inbox_retry_idx ON payment_inbox(next_attempt_at,created_at,id) WHERE status <> 'processed';
CREATE TABLE auth_rate_limits (
 key VARCHAR(64) NOT NULL,
 window_start BIGINT NOT NULL,
 attempts INTEGER NOT NULL CHECK (attempts > 0),
 PRIMARY KEY (key,window_start)
);
CREATE INDEX auth_rate_limits_window_idx ON auth_rate_limits(window_start);
CREATE INDEX wallet_movements_user_kind_time_idx ON wallet_movements(user_id,kind,created_at,id);
CREATE INDEX refunds_created_at_idx ON refunds(created_at,id);
CREATE INDEX platform_commission_logs_created_at_idx ON platform_commission_logs(created_at,id);
COMMIT;
