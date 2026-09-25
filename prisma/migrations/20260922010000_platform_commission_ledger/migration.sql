CREATE TABLE "platform_commission_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "rate" DECIMAL(7,6) NOT NULL,
    "commission_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_commission_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_commission_logs_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1),
    CONSTRAINT "platform_commission_logs_amount_nonnegative" CHECK ("commission_amount" >= 0)
);

CREATE UNIQUE INDEX "platform_commission_logs_order_id_key"
    ON "platform_commission_logs"("order_id");

ALTER TABLE "platform_commission_logs" ADD CONSTRAINT "platform_commission_logs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
