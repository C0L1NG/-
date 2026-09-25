ALTER TABLE "users"
    ADD COLUMN "display_name" VARCHAR(80),
    ADD COLUMN "avatar_url" VARCHAR(512),
    ADD COLUMN "wechat_open_id" VARCHAR(64),
    ADD COLUMN "wechat_union_id" VARCHAR(64),
    ADD COLUMN "parent_bound_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "users_wechat_open_id_key" ON "users"("wechat_open_id");
CREATE UNIQUE INDEX "users_wechat_union_id_key" ON "users"("wechat_union_id");

UPDATE "users" SET "parent_bound_at" = "updated_at"
WHERE "parent_id" IS NOT NULL AND "parent_bound_at" IS NULL;

-- Referral relationships are permanent after the first successful bind.
CREATE FUNCTION "prevent_agent_reparenting"() RETURNS trigger AS $$
BEGIN
    IF OLD."parent_id" IS NOT NULL AND NEW."parent_id" IS DISTINCT FROM OLD."parent_id" THEN
        RAISE EXCEPTION 'an agent parent binding cannot be changed';
    END IF;
    IF OLD."parent_id" IS NULL AND NEW."parent_id" IS NOT NULL
       AND NEW."parent_bound_at" IS NULL THEN
        NEW."parent_bound_at" := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_parent_binding_once"
    BEFORE UPDATE OF "parent_id" ON "users"
    FOR EACH ROW EXECUTE FUNCTION "prevent_agent_reparenting"();
