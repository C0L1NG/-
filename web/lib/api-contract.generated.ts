// Generated from python_backend/app/schemas.py. Do not edit by hand.
// Run: python python_backend/tools/generate_ts_contracts.py

export type AgentOverview = {
  displayName: string;
  avatarUrl: string | null;
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

export type TeamMember = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  totalEarned: string;
  contributionCommission: string;
};

export type TeamPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: TeamMember[];
};

export type LedgerItem = {
  id: string;
  orderNo: string;
  orderProfitAmount: string;
  roleType: "PROMOTER" | "PARENT";
  earningType: "OWN_ORDER" | "DOWNLINE_REWARD";
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

export type ParentBinding = {
  status: string;
  parentId: string;
};

export type MiniProgramCode = {
  scene: string;
  page: string;
  imageDataUrl: string;
};

export type WechatAgent = {
  id: string;
  parentId: string | null;
};

export type WechatLogin = {
  accessToken: string;
  expiresIn: number;
  agent: WechatAgent;
};

export type AdminOverview = {
  platformTotalRevenue: string;
  totalGmv: string;
  agentCommissionPool: string;
  agentCount: number;
  paidOrderCount: number;
  activePromoterCount?: number | null;
};

export type AgentNode = {
  id: string;
  displayName: string;
  referralCode: string | null;
  balance: string;
  totalEarned: string;
  ownGmv: string;
  ownOrderCount: number;
  platformContribution: string;
  mentorPaidUp: string;
  teamSize: number;
  children: AgentNode[];
};

export type TreeRoot = {
  id: string;
  type: "ADMIN";
  displayName: string;
  children: AgentNode[];
};

export type TeamTree = {
  root: TreeRoot;
};

export type AgentDetail = {
  id: string;
  parentId: string | null;
  displayName: string;
  referralCode: string | null;
  balance: string;
  frozenBalance: string;
  totalEarned: string;
  directAgentCount: number;
  orderCount: number;
};

export type Person = {
  id: string;
  displayName: string;
};

export type PlatformSplit = {
  ratePercent: number;
  amount: string;
};

export type AgentSplit = {
  recipientId: string;
  recipientName: string;
  ratePercent: number;
  amount: string;
};

export type AuditItem = {
  id: string;
  orderNo: string;
  totalAmount: string;
  profitAmount: string;
  settlementStatus: "PENDING" | "PROCESSING" | "SETTLED" | "REVERSED";
  createdAt: string;
  promoter: Person;
  platform: PlatformSplit | null;
  promoterCommission: AgentSplit | null;
  mentorCommission: AgentSplit | null;
};

export type AuditPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AuditItem[];
};
