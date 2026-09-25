CREATE TYPE "user_role" AS ENUM ('admin', 'agent');
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE "settlement_status" AS ENUM ('pending', 'processing', 'settled', 'reversed');
CREATE TYPE "commission_role" AS ENUM ('promoter', 'parent');

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" "user_role" NOT NULL DEFAULT 'agent',
    "referral_code" VARCHAR(64),
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_agent_referral_code_check" CHECK ("role" <> 'agent' OR "referral_code" IS NOT NULL)
);

CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_no" VARCHAR(64) NOT NULL,
    "customer_id" VARCHAR(128) NOT NULL,
    "promoter_id" UUID NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "profit_amount" DECIMAL(18,2) NOT NULL,
    "payment_status" "payment_status" NOT NULL DEFAULT 'pending',
    "settlement_status" "settlement_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_total_amount_nonnegative" CHECK ("total_amount" >= 0),
    CONSTRAINT "orders_profit_amount_nonnegative" CHECK ("profit_amount" >= 0),
    CONSTRAINT "orders_profit_within_total" CHECK ("profit_amount" <= "total_amount")
);

CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "frozen_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_earned" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallets_balance_nonnegative" CHECK ("balance" >= 0),
    CONSTRAINT "wallets_frozen_balance_nonnegative" CHECK ("frozen_balance" >= 0),
    CONSTRAINT "wallets_total_earned_nonnegative" CHECK ("total_earned" >= 0)
);

CREATE TABLE "commission_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "role_type" "commission_role" NOT NULL,
    "rate" DECIMAL(7,6) NOT NULL,
    "commission_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commission_logs_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1),
    CONSTRAINT "commission_logs_amount_nonnegative" CHECK ("commission_amount" >= 0)
);

-- The unique referral-code constraint also creates the requested lookup index.
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");
CREATE INDEX "users_parent_id_idx" ON "users"("parent_id");
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");
CREATE INDEX "orders_promoter_id_idx" ON "orders"("promoter_id");
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");
CREATE UNIQUE INDEX "commission_logs_order_id_role_type_key" ON "commission_logs"("order_id", "role_type");
CREATE INDEX "commission_logs_recipient_id_created_at_idx" ON "commission_logs"("recipient_id", "created_at");

ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_promoter_id_fkey"
    FOREIGN KEY ("promoter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A CHECK cannot inspect another user row. Lock the proposed parent so concurrent
-- hierarchy changes serialize, then reject any chain longer than two agent levels.
CREATE FUNCTION "enforce_agent_hierarchy"() RETURNS trigger AS $$
DECLARE
    parent_role "user_role";
    grandparent_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" THEN
            RAISE EXCEPTION 'user IDs cannot be changed';
        END IF;
    END IF;

    IF NEW."parent_id" = NEW."id" THEN
        RAISE EXCEPTION 'an agent cannot be their own parent';
    END IF;

    IF NEW."parent_id" IS NOT NULL THEN
        IF NEW."role" <> 'agent' THEN
            RAISE EXCEPTION 'only agents may have a parent';
        END IF;

        SELECT "role", "parent_id" INTO parent_role, grandparent_id
        FROM "users" WHERE "id" = NEW."parent_id" FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'parent agent does not exist';
        END IF;
        IF parent_role <> 'agent' OR grandparent_id IS NOT NULL THEN
            RAISE EXCEPTION 'parent must be a root agent';
        END IF;
        IF EXISTS (SELECT 1 FROM "users" WHERE "parent_id" = NEW."id") THEN
            RAISE EXCEPTION 'an agent with children cannot become a child agent';
        END IF;
    ELSIF NEW."role" <> 'agent'
          AND EXISTS (SELECT 1 FROM "users" WHERE "parent_id" = NEW."id") THEN
        RAISE EXCEPTION 'an agent with children cannot become an admin';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW."role" <> 'agent' AND OLD."role" = 'agent'
           AND (EXISTS (SELECT 1 FROM "wallets" WHERE "user_id" = NEW."id")
                OR EXISTS (SELECT 1 FROM "orders" WHERE "promoter_id" = NEW."id")
                OR EXISTS (SELECT 1 FROM "commission_logs" WHERE "recipient_id" = NEW."id")) THEN
            RAISE EXCEPTION 'an agent referenced by financial records cannot become an admin';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_agent_hierarchy_check"
    BEFORE INSERT OR UPDATE OF "id", "role", "parent_id" ON "users"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_hierarchy"();

-- The foreign keys prove existence; these triggers also require agent roles.
CREATE FUNCTION "require_agent_reference"() RETURNS trigger AS $$
DECLARE
    agent_id UUID;
    agent_role "user_role";
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'orders' THEN agent_id := NEW."promoter_id";
        WHEN 'wallets' THEN agent_id := NEW."user_id";
        WHEN 'commission_logs' THEN agent_id := NEW."recipient_id";
    END CASE;

    SELECT "role" INTO agent_role FROM "users" WHERE "id" = agent_id FOR SHARE;
    IF NOT FOUND OR agent_role <> 'agent' THEN
        RAISE EXCEPTION 'referenced user must be an agent';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_promoter_agent_check"
    BEFORE INSERT OR UPDATE OF "promoter_id" ON "orders"
    FOR EACH ROW EXECUTE FUNCTION "require_agent_reference"();
CREATE TRIGGER "wallets_owner_agent_check"
    BEFORE INSERT OR UPDATE OF "user_id" ON "wallets"
    FOR EACH ROW EXECUTE FUNCTION "require_agent_reference"();
CREATE TRIGGER "commission_logs_recipient_agent_check"
    BEFORE INSERT OR UPDATE OF "recipient_id" ON "commission_logs"
    FOR EACH ROW EXECUTE FUNCTION "require_agent_reference"();
