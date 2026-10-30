BEGIN;
-- Additive upgrade. Existing settled beneficiaries come from their original logs.
ALTER TABLE users ADD COLUMN login_name VARCHAR(80) UNIQUE,
    ADD COLUMN password_hash VARCHAR(256),
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE orders ADD COLUMN attribution_parent_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN attribution_locked_at TIMESTAMPTZ(6),
    ADD COLUMN rule_version VARCHAR(40) NOT NULL DEFAULT 'two_level_v1',
    ADD COLUMN paid_at TIMESTAMPTZ(6),
    ADD COLUMN settled_at TIMESTAMPTZ(6),
    ADD COLUMN refunded_at TIMESTAMPTZ(6),
    ADD COLUMN payment_reference VARCHAR(128) UNIQUE;
UPDATE orders o SET attribution_parent_id = CASE
    WHEN EXISTS (SELECT 1 FROM commission_logs l WHERE l.order_id = o.id)
    THEN (SELECT recipient_id FROM commission_logs l WHERE l.order_id = o.id AND role_type = 'parent')
    ELSE (SELECT parent_id FROM users u WHERE u.id = o.promoter_id) END,
    attribution_locked_at = CURRENT_TIMESTAMP,
    paid_at = CASE WHEN payment_status IN ('paid','refunded') THEN o.created_at END,
    settled_at = (SELECT min(created_at) FROM platform_commission_logs p WHERE p.order_id = o.id);
CREATE INDEX orders_paid_at_idx ON orders(paid_at, id);
CREATE INDEX orders_settled_at_idx ON orders(settled_at, id);
CREATE FUNCTION lock_order_attribution() RETURNS trigger AS $$
DECLARE parent UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT parent_id INTO parent FROM users WHERE id = NEW.promoter_id FOR SHARE;
        NEW.attribution_parent_id := parent;
        NEW.attribution_locked_at := CURRENT_TIMESTAMP;
        NEW.rule_version := 'two_level_v1';
    ELSIF NEW.promoter_id IS DISTINCT FROM OLD.promoter_id
        OR NEW.attribution_parent_id IS DISTINCT FROM OLD.attribution_parent_id
        OR NEW.attribution_locked_at IS DISTINCT FROM OLD.attribution_locked_at
        OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
        OR NEW.profit_amount IS DISTINCT FROM OLD.profit_amount
        OR NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
        RAISE EXCEPTION 'order amounts and commission attribution are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER orders_attribution_immutable BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION lock_order_attribution();

ALTER TABLE wallets ADD COLUMN debt_balance DECIMAL(18,2) NOT NULL DEFAULT 0
    CONSTRAINT wallets_debt_nonnegative CHECK (debt_balance >= 0);
CREATE TABLE platform_wallets (
    id VARCHAR(20) PRIMARY KEY DEFAULT 'platform' CHECK (id = 'platform'),
    balance DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    frozen_balance DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (frozen_balance >= 0),
    total_earned DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    debt_balance DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (debt_balance >= 0),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO platform_wallets(id,balance,total_earned)
    SELECT 'platform', COALESCE(sum(commission_amount),0), COALESCE(sum(commission_amount),0)
    FROM platform_commission_logs;
CREATE TABLE wallet_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_key VARCHAR(40) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    business_id VARCHAR(128) NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('opening','commission','refund','withdrawal_hold','withdrawal_paid','withdrawal_release')),
    amount DECIMAL(18,2) NOT NULL CHECK (amount >= 0),
    balance_delta DECIMAL(18,2) NOT NULL,
    frozen_delta DECIMAL(18,2) NOT NULL DEFAULT 0,
    earned_delta DECIMAL(18,2) NOT NULL DEFAULT 0,
    debt_delta DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((user_id IS NULL AND account_key = 'platform') OR (user_id IS NOT NULL AND account_key = user_id::text))
);
CREATE UNIQUE INDEX wallet_movements_business_kind_account_key ON wallet_movements(business_id,kind,account_key);
CREATE INDEX wallet_movements_account_time_idx ON wallet_movements(account_key,created_at,id);
INSERT INTO wallet_movements(account_key,user_id,business_id,kind,amount,balance_delta,frozen_delta,earned_delta)
    SELECT user_id::text,user_id,'migration-opening','opening',balance,balance,frozen_balance,total_earned FROM wallets;
INSERT INTO wallet_movements(account_key,business_id,kind,amount,balance_delta,earned_delta)
    SELECT 'platform','migration-opening','opening',balance,balance,total_earned FROM platform_wallets;
CREATE TABLE payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(40) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('paid','refunded')),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX payment_events_provider_event_key ON payment_events(provider,event_id);
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    payment_reference VARCHAR(128) NOT NULL UNIQUE,
    total_amount DECIMAL(18,2) NOT NULL CHECK (total_amount >= 0),
    platform_amount DECIMAL(18,2) NOT NULL CHECK (platform_amount >= 0),
    agent_amount DECIMAL(18,2) NOT NULL CHECK (agent_amount >= 0),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE payout_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('wechat','bank')),
    account_reference VARCHAR(128) NOT NULL,
    label VARCHAR(80) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    verification_reference VARCHAR(128),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX payout_accounts_user_provider_key ON payout_accounts(user_id,provider);
CREATE TABLE withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES payout_accounts(id) ON DELETE RESTRICT,
    account_scope VARCHAR(20) NOT NULL CHECK (account_scope IN ('agent','platform')),
    amount DECIMAL(18,2) NOT NULL CHECK (amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected')),
    idempotency_key VARCHAR(80) NOT NULL,
    payout_reference VARCHAR(128) UNIQUE,
    reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX withdrawals_user_idempotency_key ON withdrawals(user_id,idempotency_key);
CREATE INDEX withdrawals_status_created_at_idx ON withdrawals(status,created_at,id);
CREATE TABLE web_login_tickets (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    token_version INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin','agent')),
    expires_at TIMESTAMPTZ(6) NOT NULL,
    consumed_at TIMESTAMPTZ(6)
);
CREATE INDEX web_login_tickets_expiry_idx ON web_login_tickets(expires_at);

-- Financial records are append-only; corrections require explicit compensating entries.
CREATE FUNCTION prevent_financial_record_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'financial records are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_movements_append_only BEFORE UPDATE OR DELETE ON wallet_movements
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();
CREATE TRIGGER commission_logs_append_only BEFORE UPDATE OR DELETE ON commission_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();
CREATE TRIGGER platform_commission_logs_append_only BEFORE UPDATE OR DELETE ON platform_commission_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();
CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds
    FOR EACH ROW EXECUTE FUNCTION prevent_financial_record_mutation();

COMMIT;
