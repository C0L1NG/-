import type { LedgerItem, LedgerPage, Overview, Referral, TeamMember } from "@/lib/types";

// Public showcase data. These values do not come from platform accounts or APIs.
export const demoOverview: Overview = {
  displayName: "青禾",
  balance: "12,486.70",
  totalEarned: "38,920.45",
  directAgentCount: 18,
  currentCommissionRatePercent: 49,
  todayEstimatedEarnings: "326.34",
  estimateDate: "2026-09-22",
  estimateTimeZone: "UTC",
};

export const demoReferral: Referral = {
  referralCode: "DEMO-AGENT-07",
  referralUrl: "https://example.com/join?ref=DEMO-AGENT-07",
};

const profits = ["420.00", "318.50", "680.00", "156.00", "510.00", "224.00", "780.00", "365.00", "480.00", "210.00", "630.00", "340.00"];
const rates = [49, 21, 49, 21, 49, 21, 49, 21, 49, 21, 49, 21];

export const demoLedgerItems: LedgerItem[] = profits.map((profit, index) => ({
  id: `demo-${index + 1}`,
  orderNo: `ORD-202609${String(22 - Math.floor(index / 4)).padStart(2, "0")}-${String(1086 - index).padStart(4, "0")}`,
  orderProfitAmount: profit,
  roleType: rates[index] === 49 ? "PROMOTER" : "PARENT",
  rate: String(rates[index] / 100),
  ratePercent: rates[index],
  commissionAmount: (Math.round(Number(profit) * rates[index]) / 100).toFixed(2),
  settlementStatus: "SETTLED",
  settledAt: `2026-09-${String(22 - Math.floor(index / 4)).padStart(2, "0")}T${String(14 - (index % 4) * 2).padStart(2, "0")}:32:00.000Z`,
}));

export function getDemoLedger(page: number, pageSize: number): LedgerPage {
  return {
    page,
    pageSize,
    total: demoLedgerItems.length,
    totalPages: Math.ceil(demoLedgerItems.length / pageSize),
    items: demoLedgerItems.slice((page - 1) * pageSize, page * pageSize),
  };
}

const memberNames = ["周宁", "何川", "陈屿", "温言", "沈青", "许知", "江予", "林默", "宋禾", "陆舟", "邵然", "李寻", "程述", "简行", "苏清", "叶知", "孟越", "余棠"];
export const demoTeamMembers: TeamMember[] = memberNames.map((displayName, index) => ({
  id: `member-${index + 1}`, displayName, avatarUrl: null,
  joinedAt: `2026-09-${String(22 - (index % 18)).padStart(2, "0")}T09:00:00.000Z`,
  totalEarned: (3580 - index * 112).toFixed(2),
  contributionCommission: (420 - index * 18.5).toFixed(2),
}));
