import test from "node:test";
import assert from "node:assert/strict";
import {
  moneyCents,
  decimalMoney,
  formatMoney,
  sumMoney,
} from "../../web/lib/money.ts";
import { dateBounds } from "../../web/lib/date-range.ts";
import { getDemoAgent } from "../../web/lib/demo-data.ts";
import {
  demoAuditItems,
  demoAdminOverview,
  demoTeamTree,
  demoNetworkNodes,
} from "../../web/lib/admin-demo-data.ts";
import { filteredDemoAudit } from "../../web/lib/admin-filters.ts";
import { fetchAuditExport } from "../../web/lib/admin-export.ts";

test("decimal money preserves cents beyond Number precision and rejects invalid amounts", () => {
  assert.equal(sumMoney(["2,486,320.00", "641280.00", "0.01"]), "3127600.01");
  assert.equal(
    sumMoney(["9999999999999999.99", "0.01"]),
    "10000000000000000.00",
  );
  assert.equal(
    formatMoney("10000000000000000.00"),
    "10,000,000,000,000,000.00",
  );
  assert.equal(decimalMoney(moneyCents("-0.21")), "-0.21");
  assert.equal(formatMoney("NaN"), "—");
  assert.equal(sumMoney(["invalid"]), null);
});
test("inclusive UI dates become exclusive UTC query bounds across month and year changes", () => {
  assert.deepEqual(dateBounds("previous", new Date("2026-01-01T12:00:00Z")), {
    from: "2025-12-01",
    to: "2026-01-01",
  });
  assert.deepEqual(
    dateBounds("custom", new Date(), "2026-09-30", "2026-10-03"),
    { from: "2026-09-30", to: "2026-10-04" },
  );
  assert.throws(() =>
    dateBounds("custom", new Date(), "2026-02-30", "2026-03-01"),
  );
  assert.throws(() =>
    dateBounds("custom", new Date(), "2026-10-03", "2026-10-02"),
  );
});
test("both demo identities obey two levels and their wallet and team sums agree", () => {
  for (const level of ["first", "second"]) {
    const data = getDemoAgent(level);
    assert.equal(
      data.overview.totalEarned,
      sumMoney(data.ledger.map((item) => item.commissionAmount)),
    );
    assert.equal(
      data.wallet.totalEarned,
      sumMoney([
        data.wallet.balance,
        data.wallet.frozenBalance,
        ...data.withdrawals
          .filter((item) => item.status === "paid")
          .map((item) => item.amount),
      ]),
    );
    assert.equal(data.overview.directAgentCount, data.team.length);
    if (level === "second") {
      assert.equal(data.team.length, 0);
      assert.ok(
        data.ledger.every(
          (item) => item.roleType === "PROMOTER" && item.ratePercent === 49,
        ),
      );
    } else {
      assert.equal(
        sumMoney(data.team.map((item) => item.contributionCommission)),
        sumMoney(
          data.ledger
            .filter((item) => item.roleType === "PARENT")
            .map((item) => item.commissionAmount),
        ),
      );
      assert.ok(
        data.ledger.every((item) => [70, 21].includes(item.ratePercent)),
      );
    }
  }
});
test("admin totals, hierarchy and filtered export dataset preserve the 30/70 split", () => {
  assert.equal(
    demoAdminOverview.platformTotalRevenue,
    sumMoney(demoAuditItems.map((item) => item.platform.amount)),
  );
  for (const item of demoAuditItems)
    assert.equal(
      item.profitAmount,
      sumMoney([
        item.platform.amount,
        item.promoterCommission.amount,
        item.mentorCommission?.amount ?? "0.00",
      ]),
    );
  assert.equal(
    demoAdminOverview.totalGmv,
    sumMoney(
      demoTeamTree.root.children.flatMap((node) => [
        node.ownGmv,
        ...node.children.map((child) => child.ownGmv),
      ]),
    ),
  );
  assert.equal(
    filteredDemoAudit({ from: "2026-10-03", to: "2026-10-04", q: "林默" })
      .length,
    1,
  );
});
test("export failures remain recoverable and successful exports preserve exact filters", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 500]) {
      globalThis.fetch = async () =>
        new Response('{"code":"FAIL"}', {
          status,
          headers: { "content-type": "application/json" },
        });
      await assert.rejects(
        fetchAuditExport({ q: "订单" }),
        status === 401 ? /登录/ : status === 403 ? /权限/ : /失败/,
      );
    }
    globalThis.fetch = async (url) => {
      const parsed = new URL(url, "http://test");
      assert.equal(parsed.searchParams.get("q"), "林默");
      assert.equal(parsed.searchParams.get("from"), "2026-10-03");
      return new Response("订单号,金额\nORD-1,0.21", {
        headers: { "content-type": "text/csv;charset=utf-8" },
      });
    };
    assert.match(
      await (
        await fetchAuditExport({
          q: "林默",
          from: "2026-10-03",
          to: "2026-10-04",
        })
      ).text(),
      /0.21/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("demo network ranks by the selected period platform contribution", () => {
  assert.equal(demoNetworkNodes("all")[0].displayName, "林默");
  assert.equal(demoNetworkNodes("month")[0].displayName, "许知行");
  assert.equal(
    demoNetworkNodes("month")[0].teamPlatformContribution,
    "297000.00",
  );
});
