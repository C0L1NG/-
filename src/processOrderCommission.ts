import type { PrismaClient } from "../generated/prisma/client.js";
import { calculateOrderCommission } from "./commissionMath.js";

type LockedOrder = {
  id: string;
  promoter_id: string;
  profit_amount: string;
  payment_status: string;
  settlement_status: string;
};

type LockedPromoter = { id: string; parent_id: string | null };

export type CommissionResult =
  | { status: "already_settled"; orderId: string }
  | {
      status: "settled";
      orderId: string;
      platformAmount: string;
      bonusPool: string;
      promoterAmount: string;
      parentAmount: string | null;
    };

/** Invoke after payment becomes PAID. A row lock makes duplicate callbacks idempotent. */
export async function processOrderCommission(
  orderId: string,
  database?: PrismaClient,
): Promise<CommissionResult> {
  if (!orderId) throw new TypeError("orderId is required");
  const db = database ?? (await import("./db.js")).getPrismaClient();

  return db.$transaction(async (tx) => {
    const [order] = await tx.$queryRaw<LockedOrder[]>`
      SELECT id, promoter_id, profit_amount,
             payment_status::text AS payment_status,
             settlement_status::text AS settlement_status
      FROM orders
      WHERE id = CAST(${orderId} AS uuid)
      FOR UPDATE
    `;

    if (!order) throw new Error(`Order ${orderId} does not exist`);
    if (order.settlement_status === "settled") {
      return { status: "already_settled", orderId };
    }
    if (order.payment_status !== "paid") {
      throw new Error(`Order ${orderId} has not been paid`);
    }
    if (order.settlement_status !== "pending") {
      throw new Error(`Order ${orderId} cannot be settled from ${order.settlement_status}`);
    }

    // Hold a share lock so the promoter's direct parent cannot change mid-settlement.
    const [promoter] = await tx.$queryRaw<LockedPromoter[]>`
      SELECT id, parent_id FROM users
      WHERE id = CAST(${order.promoter_id} AS uuid) AND role = 'agent'
      FOR SHARE
    `;
    if (!promoter) throw new Error(`Promoter ${order.promoter_id} is unavailable`);

    const amounts = calculateOrderCommission(order.profit_amount, promoter.parent_id !== null);
    const allocations = [
      { userId: promoter.id, roleType: "PROMOTER" as const,
        rate: promoter.parent_id ? "0.49" : "0.70", amount: amounts.promoterAmount },
      ...(promoter.parent_id
        ? [{ userId: promoter.parent_id, roleType: "PARENT" as const,
             rate: "0.21", amount: amounts.parentAmount! }]
        : []),
    ];

    // Stable wallet lock order avoids deadlocks across concurrent orders.
    for (const allocation of [...allocations].sort((a, b) => a.userId.localeCompare(b.userId))) {
      const updated = await tx.wallet.updateMany({
        where: { userId: allocation.userId },
        data: {
          balance: { increment: allocation.amount },
          totalEarned: { increment: allocation.amount },
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Wallet for agent ${allocation.userId} is missing`);
      }
    }

    await tx.platformCommissionLog.create({
      data: { orderId, rate: "0.30", commissionAmount: amounts.platformAmount },
    });
    for (const allocation of allocations) {
      await tx.commissionLog.create({
        data: {
          orderId,
          recipientId: allocation.userId,
          roleType: allocation.roleType,
          rate: allocation.rate,
          commissionAmount: allocation.amount,
        },
      });
    }

    const settled = await tx.order.updateMany({
      where: { id: orderId, paymentStatus: "PAID", settlementStatus: "PENDING" },
      data: { settlementStatus: "SETTLED" },
    });
    if (settled.count !== 1) throw new Error(`Order ${orderId} changed during settlement`);

    return {
      status: "settled",
      orderId,
      platformAmount: amounts.platformAmount,
      bonusPool: amounts.bonusPool,
      promoterAmount: amounts.promoterAmount,
      parentAmount: amounts.parentAmount,
    };
  }, { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 5_000 });
}
