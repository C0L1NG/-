import type { LedgerItem, Overview, Referral, TeamMember } from "@/lib/types";
import type {
  WalletState,
  PayoutAccountData,
  WithdrawalData,
} from "./api-contract.generated";
import { decimalMoney, moneyCents, sumMoney } from "./money";

export type DemoLevel = "first" | "second";
export const DEMO_NOW = "2026-10-03T16:00:00.000Z";
const names = [
  "周宁",
  "何川",
  "陈屿",
  "温言",
  "沈青",
  "许知",
  "江予",
  "林默",
  "宋禾",
  "陆舟",
  "邵然",
  "李寻",
  "程述",
  "简行",
  "苏清",
  "叶知",
  "孟越",
  "余棠",
];

function ledger(level: DemoLevel): LedgerItem[] {
  const profits = [
    "5420.00",
    "3185.00",
    "4680.00",
    "2156.00",
    "4510.00",
    "3224.00",
    "5780.00",
    "4365.00",
    "2480.00",
    "3210.00",
    "4630.00",
    "3340.00",
  ];
  const items: LedgerItem[] = profits.map((profit, index) => {
    const rate = level === "second" ? 49 : index % 2 ? 21 : 70;
    const date =
      index < 8
        ? `2026-10-${index < 2 ? "03" : index < 5 ? "02" : "01"}`
        : `2026-09-${String(30 - index + 8).padStart(2, "0")}`;
    return {
      id: `${level}-${index}`,
      orderNo: `ORD-${date.replaceAll("-", "")}-${1086 - index}`,
      orderProfitAmount: profit,
      roleType: rate === 21 ? "PARENT" : "PROMOTER",
      earningType: rate === 21 ? "DOWNLINE_REWARD" : "OWN_ORDER",
      rate: String(rate / 100),
      ratePercent: rate,
      commissionAmount: decimalMoney(
        (moneyCents(profit)! * BigInt(rate) + 50n) / 100n,
      ),
      settlementStatus: "SETTLED",
      settledAt: `${date}T${String(14 - (index % 4) * 2).padStart(2, "0")}:32:00.000Z`,
      entryType: "commission",
    };
  });
  const reversed = items[8];
  reversed.settlementStatus = "REVERSED";
  items.push({
    ...reversed,
    id: level + "-refund",
    commissionAmount: "-" + reversed.commissionAmount,
    entryType: "refund",
    settledAt: "2026-10-02T15:00:00.000Z",
  });
  return items.sort(
    (a, b) =>
      b.settledAt.localeCompare(a.settledAt) || b.id.localeCompare(a.id),
  );
}

export function getDemoAgent(level: DemoLevel) {
  const items = ledger(level);
  const rewards = items.filter((item) => item.roleType === "PARENT");
  const team: TeamMember[] =
    level === "first"
      ? names.map((displayName, index) => ({
          id: `member-${index + 1}`,
          displayName,
          avatarUrl: null,
          joinedAt: `2026-09-${String(22 - index).padStart(2, "0")}T09:00:00.000Z`,
          totalEarned: rewards[index]
            ? decimalMoney(
                (moneyCents(rewards[index].orderProfitAmount)! * 49n) / 100n,
              )
            : "0.00",
          contributionCommission: rewards[index]?.commissionAmount ?? "0.00",
        }))
      : [];
  const earned = sumMoney(items.map((item) => item.commissionAmount))!;
  const paid = "1000.00",
    frozen = "500.00";
  const wallet: WalletState = {
    balance: decimalMoney(
      moneyCents(earned)! - moneyCents(paid)! - moneyCents(frozen)!,
    ),
    frozenBalance: frozen,
    debtBalance: "0.00",
    totalEarned: earned,
  };
  const overview: Overview = {
    displayName: level === "first" ? "青禾" : "周宁",
    avatarUrl: null,
    balance: wallet.balance,
    totalEarned: earned,
    directAgentCount: team.length,
    currentCommissionRatePercent: level === "first" ? 70 : 49,
    todayEstimatedEarnings: sumMoney(
      items
        .filter((item) => item.settledAt.startsWith("2026-10-03"))
        .map((item) => item.commissionAmount),
    )!,
    estimateDate: "2026-10-03",
    estimateTimeZone: "UTC",
  };
  const referral: Referral = {
    referralCode: level === "first" ? "DEMO-LV1-07" : "DEMO-LV2-11",
    referralUrl: `https://example.com/join?ref=${level === "first" ? "DEMO-LV1-07" : "DEMO-LV2-11"}`,
  };
  const accounts: PayoutAccountData[] = [
    {
      id: `${level}-wechat`,
      provider: "wechat",
      label: "本人微信零钱 · 演示",
      verified: true,
    },
  ];
  const withdrawals: WithdrawalData[] = [
    {
      id: `${level}-withdraw-pending`,
      userId: level,
      accountScope: "agent",
      amount: frozen,
      status: "pending",
      createdAt: "2026-10-03T09:00:00Z",
      payoutReference: null,
    },
    {
      id: `${level}-withdraw-paid`,
      userId: level,
      accountScope: "agent",
      amount: paid,
      status: "paid",
      createdAt: "2026-09-20T09:00:00Z",
      payoutReference: "DEMO-PAYOUT-001",
    },
  ];
  return {
    overview,
    referral,
    ledger: items,
    team,
    wallet,
    accounts,
    withdrawals,
  };
}

const first = getDemoAgent("first");
export const demoOverview = first.overview;
export const demoReferral = first.referral;
