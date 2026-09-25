import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import { calculateOrderCommission } from "../src/commissionMath.js";

test("A: direct promoter receives the entire 70% pool", () => {
  assert.deepEqual(calculateOrderCommission("100.00", false), {
    profitAmount: "100.00",
    platformAmount: "30.00",
    bonusPool: "70.00",
    promoterAmount: "70.00",
    parentAmount: null,
  });
});

test("B: promoter and direct parent receive 49% and 21% of profit", () => {
  assert.deepEqual(calculateOrderCommission("100.00", true), {
    profitAmount: "100.00",
    platformAmount: "30.00",
    bonusPool: "70.00",
    promoterAmount: "49.00",
    parentAmount: "21.00",
  });
});

test("odd cents round half up and every cent is allocated exactly once", () => {
  const amounts = calculateOrderCommission("123.45", true);
  assert.equal(amounts.platformAmount, "37.04");
  assert.equal(amounts.bonusPool, "86.41");
  assert.equal(amounts.promoterAmount, "60.49");
  assert.equal(amounts.parentAmount, "25.92");
  assert.equal(
    new Decimal(amounts.platformAmount).plus(amounts.promoterAmount).plus(amounts.parentAmount!).toFixed(2),
    amounts.profitAmount,
  );

  const tiny = calculateOrderCommission("0.01", true);
  assert.deepEqual([tiny.platformAmount, tiny.promoterAmount, tiny.parentAmount],
    ["0.00", "0.01", "0.00"]);
});

test("rejects negative and sub-cent profit rather than silently rounding input", () => {
  assert.throws(() => calculateOrderCommission("-0.01", false), RangeError);
  assert.throws(() => calculateOrderCommission("1.001", true), RangeError);
});
