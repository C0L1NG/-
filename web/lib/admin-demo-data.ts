import type { NetworkNode } from "./api-contract.generated";
import type {
  AdminOverview,
  AgentNode,
  AuditItem,
  TeamTree,
} from "./admin-types";
import { decimalMoney, moneyCents, sumMoney } from "./money";
// One fictional dataset drives totals, hierarchy, audit and period filters.
const people: Record<string, { id: string; code: string }> = {
  林默: { id: "a1", code: "AG7F01A2" },
  周宁: { id: "a11", code: "AG02BC11" },
  何川: { id: "a12", code: "AG81DD32" },
  陈屿: { id: "a13", code: "AG19EA20" },
  许知行: { id: "a2", code: "AG21CD09" },
  温言: { id: "a21", code: "AG50EE18" },
  沈青: { id: "a22", code: "AG71BC30" },
  江予: { id: "a3", code: "AG66FE10" },
};
const raw = [
  {
    no: "ORD-261003-0842",
    total: "1580.00",
    profit: "520.00",
    promoter: "林默",
    date: "2026-10-03T14:20:00Z",
  },
  {
    no: "ORD-261003-0841",
    total: "980.00",
    profit: "320.00",
    promoter: "周宁",
    mentor: "林默",
    date: "2026-10-03T13:20:00Z",
  },
  {
    no: "ORD-261003-0840",
    total: "2260.00",
    profit: "740.00",
    promoter: "许知行",
    date: "2026-10-03T12:20:00Z",
  },
  {
    no: "ORD-261002-0839",
    total: "760.00",
    profit: "250.00",
    promoter: "温言",
    mentor: "许知行",
    date: "2026-10-02T11:20:00Z",
  },
  {
    no: "ORD-260930-0838",
    total: "1340.00",
    profit: "460.00",
    promoter: "江予",
    date: "2026-09-30T16:12:00Z",
  },
  {
    no: "ORD-260929-0837",
    total: "590.00",
    profit: "180.00",
    promoter: "何川",
    mentor: "林默",
    date: "2026-09-29T10:42:00Z",
  },
  {
    no: "ORD-260928-0836",
    total: "2850.00",
    profit: "900.00",
    promoter: "林默",
    date: "2026-09-28T08:42:00Z",
  },
  {
    no: "ORD-260927-0835",
    total: "940.00",
    profit: "310.00",
    promoter: "陈屿",
    mentor: "林默",
    date: "2026-09-27T15:42:00Z",
  },
];
export const demoAuditItems: AuditItem[] = raw.map((row, index) => {
  const profit = moneyCents(row.profit)! * 1000n,
    platform = (profit * 30n + 50n) / 100n,
    pool = profit - platform;
  const own = row.mentor ? (pool * 70n + 50n) / 100n : pool;
  return {
    id: "demo-order-" + index,
    orderNo: row.no,
    totalAmount: decimalMoney(moneyCents(row.total)! * 1000n),
    profitAmount: decimalMoney(profit),
    settlementStatus: "SETTLED",
    createdAt: row.date,
    promoter: { id: people[row.promoter].id, displayName: row.promoter },
    platform: { ratePercent: 30, amount: decimalMoney(platform) },
    promoterCommission: {
      recipientId: people[row.promoter].id,
      recipientName: row.promoter,
      ratePercent: row.mentor ? 49 : 70,
      amount: decimalMoney(own),
    },
    mentorCommission: row.mentor
      ? {
          recipientId: people[row.mentor].id,
          recipientName: row.mentor,
          ratePercent: 21,
          amount: decimalMoney(pool - own),
        }
      : null,
  };
});
function overview(items: AuditItem[]): AdminOverview {
  return {
    platformTotalRevenue: sumMoney(items.map((item) => item.platform!.amount))!,
    totalGmv: sumMoney(items.map((item) => item.totalAmount))!,
    agentCommissionPool: sumMoney(
      items.flatMap((item) => [
        item.promoterCommission!.amount,
        ...(item.mentorCommission ? [item.mentorCommission.amount] : []),
      ]),
    )!,
    agentCount: Object.keys(people).length,
    paidOrderCount: items.length,
    activePromoterCount: new Set(items.map((item) => item.promoter.id)).size,
  };
}
export const demoAdminOverview = overview(demoAuditItems);
export const demoAdminOverviewMonth = overview(
  demoAuditItems.filter((item) => item.createdAt.startsWith("2026-10")),
);
export const demoAdminOverviewDay = overview(
  demoAuditItems.filter((item) => item.createdAt.startsWith("2026-10-03")),
);

function node(
  name: string,
  month: boolean,
  children: AgentNode[] = [],
): AgentNode {
  const all = demoAuditItems.filter(
    (item) => item.promoter.displayName === name,
  );
  const own = month
    ? all.filter((item) => item.createdAt.startsWith("2026-10"))
    : all;
  const earned = sumMoney(
    demoAuditItems.flatMap((item) => [
      ...(item.promoter.displayName === name
        ? [item.promoterCommission!.amount]
        : []),
      ...(item.mentorCommission?.recipientName === name
        ? [item.mentorCommission.amount]
        : []),
    ]),
  )!;
  return {
    id: people[name].id,
    displayName: name,
    referralCode: people[name].code,
    balance: decimalMoney(
      moneyCents(earned)! -
        (name === "林默" ? 1800000n : name === "许知行" ? 1200000n : 0n),
    ),
    totalEarned: earned,
    ownGmv: sumMoney(own.map((item) => item.totalAmount))!,
    ownOrderCount: own.length,
    platformContribution: sumMoney(own.map((item) => item.platform!.amount))!,
    mentorPaidUp: sumMoney(
      own.map((item) => item.mentorCommission?.amount ?? "0.00"),
    )!,
    teamSize: children.length,
    children,
  };
}
function tree(month: boolean): TeamTree {
  return {
    root: {
      id: "admin",
      type: "ADMIN",
      displayName: "平台总控",
      children: [
        node("林默", month, [
          node("周宁", month),
          node("何川", month),
          node("陈屿", month),
        ]),
        node("许知行", month, [node("温言", month), node("沈青", month)]),
        node("江予", month),
      ],
    },
  };
}
export const demoTeamTree = tree(false);
export const demoTeamTreeMonth = tree(true);

export function demoNetworkNodes(period: string): NetworkNode[] {
  return (period === "month" ? demoTeamTreeMonth : demoTeamTree).root.children
    .map((node) => ({
      ...node,
      teamGmv:
        sumMoney([
          node.ownGmv,
          ...node.children.map((child) => child.ownGmv),
        ]) ?? "",
      teamPlatformContribution:
        sumMoney([
          node.platformContribution,
          ...node.children.map((child) => child.platformContribution),
        ]) ?? "",
    }))
    .sort((a, b) => {
      const left = moneyCents(a.teamPlatformContribution)!;
      const right = moneyCents(b.teamPlatformContribution)!;
      return left === right ? a.id.localeCompare(b.id) : left > right ? -1 : 1;
    });
}
