// Generated from the backend Pydantic response and request models. Do not edit by hand.
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

export type AgentActivityItem = {
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
  entryType?: "commission" | "refund";
};

export type AgentActivityPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AgentActivityItem[];
};

export type AgentActivitySummary = {
  netEarnings: string;
  ownEarnings: string;
  teamEarnings: string;
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

export type AgentProgress = {
  month: string;
  timeZone: string;
  directAgentCount: number;
  ownEarnings: string;
  teamEarnings: string;
  monthEarned: string;
  leaders: TeamMember[];
};

export type NetworkNode = {
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
  teamGmv: string;
  teamPlatformContribution: string;
};

export type NetworkPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: NetworkNode[];
};

export type WalletState = {
  balance: string;
  frozenBalance: string;
  debtBalance: string;
  totalEarned: string;
};

export type OperationsSummary = {
  pendingWithdrawals: number;
  processingWithdrawals: number;
  failedPaymentEvents: number;
  pendingPaymentEvents: number;
  unverifiedAccounts: number;
};

export type PayoutAccountData = {
  id: string;
  provider: "wechat" | "bank";
  label: string;
  verified: boolean;
};

export type WithdrawalData = {
  userName?: string | null;
  id: string;
  amount: string;
  status: "pending" | "processing" | "paid" | "rejected";
  userId: string;
  accountScope: "agent" | "platform";
  createdAt: string;
  payoutReference: string | null;
  claimedBy?: string | null;
  version?: number;
  rejectionReason?: string | null;
  failureReference?: string | null;
};

export type PayoutAccountPage = {
  items: PayoutAccountData[];
};

export type WithdrawalPage = {
  items: WithdrawalData[];
  total: number;
  page: number;
  pageSize: number;
};

export type WithdrawalActionData = {
  actorId: string;
  actorName: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  version: number;
  reference: string | null;
  reason: string | null;
  createdAt: string;
};

export type PayoutDetails = {
  withdrawalId: string;
  amount: string;
  provider: "wechat" | "bank";
  accountReference: string;
  accountLabel: string;
  verified: boolean;
  status: string;
  ownerName: string;
  claimedBy: string | null;
  claimantName: string | null;
  canReview: boolean;
  version: number;
  debtBalance: string;
  frozenBalance: string;
  payoutBlocked: boolean;
  history: WithdrawalActionData[];
};

export type SessionLogin = {
  accessToken: string;
  expiresIn: number;
  role: "agent" | "admin";
};

export type LoginTicket = {
  ticket: string;
  expiresIn: number;
};

export type OrderCreated = {
  orderId: string;
  status: "pending" | "paid" | "failed" | "refunded";
};

export type CommissionResult = {
  status: string;
  orderId: string;
  platformAmount?: string | null;
  bonusPool?: string | null;
  promoterAmount?: string | null;
  parentAmount?: string | null;
};

export type PaymentInboxData = {
  id: string;
  provider: string;
  eventId: string;
  orderId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
};

export type PaymentInboxPage = {
  items: PaymentInboxData[];
  total: number;
  page: number;
  pageSize: number;
};

export type PendingAccount = {
  id: string;
  provider: "wechat" | "bank";
  label: string;
  verified: boolean;
  userId: string;
  accountReference: string;
};

export type PendingAccountPage = {
  items: PendingAccount[];
  total: number;
  page: number;
  pageSize: number;
};

export type APIErrorBody = {
  code: string;
  message?: string | null;
  statusCode?: number | null;
  error?: string | null;
};

export type OrderBody = {
  orderNo: string;
  customerId: string;
  promoterId: string;
  totalAmount: string | number;
  profitAmount: string | number;
};

export type AccountBody = {
  provider: "wechat" | "bank";
  vaultReference?: string | null;
  label?: string;
};

export type WithdrawalBody = {
  amount: string | number;
  accountId: string;
  idempotencyKey: string;
};

export type ReviewBody = {
  action: "start" | "confirm" | "reject";
  transferReference?: string | null;
  rejectionReason?: string | null;
  failureReference?: string | null;
  expectedVersion?: number | null;
};

export type VerificationBody = {
  verificationReference: string;
};

export type LoginBody = {
  username: string;
  password: string;
};

export type ExchangeBody = {
  ticket: string;
};

export type AdminWechatBody = {
  code: string;
};

export type BindBody = {
  referralCode: string;
};

export type WechatLoginBody = {
  code: string;
  referralCode?: string | null;
};

export type PaymentNotice = {
  provider: string;
  eventId: string;
  orderId: string;
  type: "paid" | "refunded";
  transactionId: string;
  amount: string | number;
  currency?: "CNY";
};
