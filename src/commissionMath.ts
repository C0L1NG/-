import Decimal from "decimal.js";

export type CommissionAmounts = {
  profitAmount: string;
  platformAmount: string;
  bonusPool: string;
  promoterAmount: string;
  parentAmount: string | null;
};

/** Monetary values are rounded half up to cents; remainders stay in the pool. */
export function calculateOrderCommission(
  profitAmount: string | Decimal,
  hasParent: boolean,
): CommissionAmounts {
  const profit = new Decimal(profitAmount.toString());
  if (!profit.isFinite() || profit.isNegative() || profit.decimalPlaces() > 2) {
    throw new RangeError("profitAmount must be a nonnegative amount in cents");
  }

  const platform = profit.mul("0.30").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const pool = profit.minus(platform);
  const promoter = hasParent
    ? pool.mul("0.70").toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : pool;
  const parent = hasParent ? pool.minus(promoter) : null;

  return {
    profitAmount: profit.toFixed(2),
    platformAmount: platform.toFixed(2),
    bonusPool: pool.toFixed(2),
    promoterAmount: promoter.toFixed(2),
    parentAmount: parent?.toFixed(2) ?? null,
  };
}
