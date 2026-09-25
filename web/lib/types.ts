export type Overview = {
  displayName: string;
  avatarUrl?: string | null;
  balance: string;
  totalEarned: string;
  directAgentCount: number;
  currentCommissionRatePercent: number;
  todayEstimatedEarnings: string;
  estimateDate: string;
  estimateTimeZone: string;
};

export type Referral = {
  referralCode: string;
  referralUrl: string;
};

export type LedgerItem = {
  id: string;
  orderNo: string;
  orderProfitAmount: string;
  roleType: "PROMOTER" | "PARENT";
  rate: string;
  ratePercent: number;
  commissionAmount: string;
  settlementStatus: "PENDING" | "PROCESSING" | "SETTLED" | "REVERSED";
  settledAt: string;
};

export type LedgerPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: LedgerItem[];
};

export type TeamMember = { id: string; displayName: string; avatarUrl: string | null; joinedAt: string; totalEarned: string; contributionCommission: string };
export type TeamPage = { page: number; pageSize: number; total: number; totalPages: number; items: TeamMember[] };
export type MiniProgramCode = { scene: string; page: string; imageDataUrl: string };
