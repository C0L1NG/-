import type { AdminOverview, AgentNode, AuditItem, AuditPage, TeamTree } from "./admin-types";

// Public showcase values are fictional and never loaded from platform accounts.
export const demoAdminOverview: AdminOverview = {
  platformTotalRevenue: "1,280,450.00", totalGmv: "11,480,920.00",
  agentCommissionPool: "2,987,716.67", agentCount: 8, paidOrderCount: 842,
};
export const demoAdminOverviewMonth: AdminOverview = {
  platformTotalRevenue: "549.00", totalGmv: "5,580.00",
  agentCommissionPool: "1,281.00", agentCount: 8, paidOrderCount: 4,
};
export const demoAdminOverviewPreviousMonth: AdminOverview = {
  platformTotalRevenue: "555.00", totalGmv: "5,720.00",
  agentCommissionPool: "1,295.00", agentCount: 8, paidOrderCount: 4,
};
export const demoAdminOverviewDay: AdminOverview = {
  platformTotalRevenue: "474.00", totalGmv: "4,820.00",
  agentCommissionPool: "1,106.00", agentCount: 8, paidOrderCount: 3,
  activePromoterCount: 3,
};

function agent(id: string, displayName: string, referralCode: string, balance: string,
  totalEarned: string, ownGmv: string, ownOrderCount: number,
  platformContribution: string, mentorPaidUp: string, children: AgentNode[] = []): AgentNode {
  return { id, displayName, referralCode, balance, totalEarned, ownGmv, ownOrderCount,
    platformContribution, mentorPaidUp, teamSize: children.length, children };
}

export const demoTeamTree: TeamTree = { root: {
  id: "admin", type: "ADMIN", displayName: "平台总控",
  children: [
    agent("a1", "林默", "AG7F01A2", "18,420.70", "52,680.40", "2,486,320.00", 346, "192,840.00", "0.00", [
      agent("a11", "周宁", "AG02BC11", "4,820.20", "13,280.20", "641,280.00", 88, "50,420.00", "21,880.20"),
      agent("a12", "何川", "AG81DD32", "3,412.00", "9,640.00", "489,640.00", 67, "38,220.00", "16,580.00"),
      agent("a13", "陈屿", "AG19EA20", "2,986.50", "8,310.80", "438,310.00", 54, "34,890.00", "14,880.30"),
    ]),
    agent("a2", "许知行", "AG21CD09", "15,780.10", "48,205.60", "1,920,560.00", 274, "149,820.00", "0.00", [
      agent("a21", "温言", "AG50EE18", "5,106.90", "15,822.30", "715,822.00", 96, "56,240.00", "24,920.10"),
      agent("a22", "沈青", "AG71BC30", "3,288.80", "10,920.10", "510,920.00", 72, "40,120.00", "17,790.40"),
    ]),
    agent("a3", "江予", "AG66FE10", "12,608.20", "36,580.90", "1,485,200.00", 211, "116,420.00", "0.00"),
  ],
} };

export const demoTeamTreeMonth: TeamTree = { root: {
  id: "admin", type: "ADMIN", displayName: "平台总控", children: [
    agent("a1", "林默", "AG7F01A2", "18,420.70", "52,680.40", "1,580.00", 1, "156.00", "0.00", [
      agent("a11", "周宁", "AG02BC11", "4,820.20", "13,280.20", "980.00", 1, "96.00", "67.20"),
      agent("a12", "何川", "AG81DD32", "3,412.00", "9,640.00", "0.00", 0, "0.00", "0.00"),
      agent("a13", "陈屿", "AG19EA20", "2,986.50", "8,310.80", "0.00", 0, "0.00", "0.00"),
    ]),
    agent("a2", "许知行", "AG21CD09", "15,780.10", "48,205.60", "2,260.00", 1, "222.00", "0.00", [
      agent("a21", "温言", "AG50EE18", "5,106.90", "15,822.30", "760.00", 1, "75.00", "52.50"),
      agent("a22", "沈青", "AG71BC30", "3,288.80", "10,920.10", "0.00", 0, "0.00", "0.00"),
    ]),
    agent("a3", "江予", "AG66FE10", "12,608.20", "36,580.90", "0.00", 0, "0.00", "0.00"),
  ],
} };

type RawOrder = {
  orderNo: string; total: string; profit: string; promoter: string;
  platform: string; promoterAmount: string; mentor?: string; mentorAmount?: string; date: string;
};
const raw: RawOrder[] = [
  { orderNo: "ORD-260923-0842", total: "1,580.00", profit: "520.00", promoter: "林默", platform: "156.00", promoterAmount: "364.00", date: "2026-09-23T14:20:00.000Z" },
  { orderNo: "ORD-260923-0841", total: "980.00", profit: "320.00", promoter: "周宁", platform: "96.00", promoterAmount: "156.80", mentor: "林默", mentorAmount: "67.20", date: "2026-09-23T13:20:00.000Z" },
  { orderNo: "ORD-260923-0840", total: "2,260.00", profit: "740.00", promoter: "许知行", platform: "222.00", promoterAmount: "518.00", date: "2026-09-23T12:20:00.000Z" },
  { orderNo: "ORD-260922-0839", total: "760.00", profit: "250.00", promoter: "温言", platform: "75.00", promoterAmount: "122.50", mentor: "许知行", mentorAmount: "52.50", date: "2026-09-22T11:20:00.000Z" },
  { orderNo: "ORD-260831-0838", total: "1,340.00", profit: "460.00", promoter: "江予", platform: "138.00", promoterAmount: "322.00", date: "2026-08-31T16:12:00.000Z" },
  { orderNo: "ORD-260830-0837", total: "590.00", profit: "180.00", promoter: "何川", platform: "54.00", promoterAmount: "88.20", mentor: "林默", mentorAmount: "37.80", date: "2026-08-30T10:42:00.000Z" },
  { orderNo: "ORD-260829-0836", total: "2,850.00", profit: "900.00", promoter: "林默", platform: "270.00", promoterAmount: "630.00", date: "2026-08-29T08:42:00.000Z" },
  { orderNo: "ORD-260828-0835", total: "940.00", profit: "310.00", promoter: "陈屿", platform: "93.00", promoterAmount: "151.90", mentor: "林默", mentorAmount: "65.10", date: "2026-08-28T15:42:00.000Z" },
];

export const demoAuditItems: AuditItem[] = raw.map((row, index) => ({
  id: "demo-" + index,
  orderNo: row.orderNo, totalAmount: row.total, profitAmount: row.profit,
  settlementStatus: "SETTLED", createdAt: row.date,
  promoter: { id: "p-" + index, displayName: row.promoter },
  platform: { ratePercent: 30, amount: row.platform },
  promoterCommission: { recipientId: "p-" + index, recipientName: row.promoter,
    ratePercent: row.mentor ? 49 : 70, amount: row.promoterAmount },
  mentorCommission: row.mentor ? { recipientId: "m-" + index, recipientName: row.mentor,
    ratePercent: 21, amount: row.mentorAmount! } : null,
}));

export function getDemoAudit(period: "all" | "month", page: number, pageSize: number): AuditPage {
  const source = period === "month"
    ? demoAuditItems.filter((item) => item.createdAt.startsWith("2026-09"))
    : demoAuditItems;
  return { page, pageSize, total: source.length, totalPages: Math.ceil(source.length / pageSize),
    items: source.slice((page - 1) * pageSize, page * pageSize) };
}
