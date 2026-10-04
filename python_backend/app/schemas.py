"""Pydantic v2 response contracts; names match the existing TypeScript JSON exactly."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentOverview(Contract):
    displayName: str
    avatarUrl: str | None
    balance: str
    totalEarned: str
    directAgentCount: int
    currentCommissionRatePercent: int
    todayEstimatedEarnings: str
    estimateDate: str
    estimateTimeZone: str


class Referral(Contract):
    referralCode: str
    referralUrl: str


class TeamMember(Contract):
    id: str
    displayName: str
    avatarUrl: str | None
    joinedAt: str
    totalEarned: str
    contributionCommission: str


class TeamPage(Contract):
    page: int
    pageSize: int
    total: int
    totalPages: int
    items: list[TeamMember]


class AgentProgress(Contract):
    month: str
    timeZone: str
    directAgentCount: int
    ownEarnings: str
    teamEarnings: str
    monthEarned: str
    leaders: list[TeamMember]


class AgentActivitySummary(Contract):
    netEarnings: str
    ownEarnings: str
    teamEarnings: str


class LedgerItem(Contract):
    id: str
    orderNo: str
    orderProfitAmount: str
    roleType: Literal["PROMOTER", "PARENT"]
    earningType: Literal["OWN_ORDER", "DOWNLINE_REWARD"]
    rate: str
    ratePercent: int | float
    commissionAmount: str
    settlementStatus: Literal["PENDING", "PROCESSING", "SETTLED", "REVERSED"]
    settledAt: str


class LedgerPage(Contract):
    page: int
    pageSize: int
    total: int
    totalPages: int
    items: list[LedgerItem]


class AgentActivityItem(LedgerItem):
    entryType: Literal["commission", "refund"] = "commission"


class AgentActivityPage(LedgerPage):
    items: list[AgentActivityItem]


class ParentBinding(Contract):
    status: str
    parentId: str


class MiniProgramCode(Contract):
    scene: str
    page: str
    imageDataUrl: str


class WechatAgent(Contract):
    id: str
    parentId: str | None


class WechatLogin(Contract):
    accessToken: str
    expiresIn: int
    agent: WechatAgent


class AdminOverview(Contract):
    platformTotalRevenue: str
    totalGmv: str
    agentCommissionPool: str
    agentCount: int
    paidOrderCount: int
    activePromoterCount: int | None = None


class AgentNode(Contract):
    id: str
    displayName: str
    referralCode: str | None
    balance: str
    totalEarned: str
    ownGmv: str
    ownOrderCount: int
    platformContribution: str
    mentorPaidUp: str
    teamSize: int
    children: list["AgentNode"]


class TreeRoot(Contract):
    id: str
    type: Literal["ADMIN"]
    displayName: str
    children: list[AgentNode]


class TeamTree(Contract):
    root: TreeRoot


class NetworkNode(AgentNode):
    teamGmv: str
    teamPlatformContribution: str


class NetworkPage(Contract):
    page: int
    pageSize: int
    total: int
    totalPages: int
    items: list[NetworkNode]


class AgentDetail(Contract):
    id: str
    parentId: str | None
    displayName: str
    referralCode: str | None
    balance: str
    frozenBalance: str
    totalEarned: str
    directAgentCount: int
    orderCount: int


class Person(Contract):
    id: str
    displayName: str


class PlatformSplit(Contract):
    ratePercent: int | float
    amount: str


class AgentSplit(Contract):
    recipientId: str
    recipientName: str
    ratePercent: int | float
    amount: str


class AuditItem(Contract):
    id: str
    orderNo: str
    totalAmount: str
    profitAmount: str
    settlementStatus: Literal["PENDING", "PROCESSING", "SETTLED", "REVERSED"]
    createdAt: str
    promoter: Person
    platform: PlatformSplit | None
    promoterCommission: AgentSplit | None
    mentorCommission: AgentSplit | None


class AuditPage(Contract):
    page: int
    pageSize: int
    total: int
    totalPages: int
    items: list[AuditItem]


class WalletState(Contract):
    balance: str
    frozenBalance: str
    debtBalance: str
    totalEarned: str


class OperationsSummary(Contract):
    pendingWithdrawals: int
    processingWithdrawals: int
    failedPaymentEvents: int
    pendingPaymentEvents: int
    unverifiedAccounts: int


class PayoutAccountData(Contract):
    id: str
    provider: Literal["wechat", "bank"]
    label: str
    verified: bool


class WithdrawalData(Contract):
    userName: str | None = None
    id: str
    amount: str
    status: Literal["pending", "processing", "paid", "rejected"]
    userId: str
    accountScope: Literal["agent", "platform"]
    createdAt: str
    payoutReference: str | None
    claimedBy: str | None = None
    version: int = 0
    rejectionReason: str | None = None
    failureReference: str | None = None


class PayoutAccountPage(Contract):
    items: list[PayoutAccountData]


class WithdrawalPage(Contract):
    items: list[WithdrawalData]
    total: int
    page: int
    pageSize: int


class WithdrawalActionData(Contract):
    actorId: str
    actorName: str
    action: str
    fromStatus: str
    toStatus: str
    version: int
    reference: str | None
    reason: str | None
    createdAt: str


class PayoutDetails(Contract):
    withdrawalId: str
    amount: str
    provider: Literal["wechat", "bank"]
    accountReference: str
    accountLabel: str
    verified: bool
    status: str
    ownerName: str
    claimedBy: str | None
    claimantName: str | None
    canReview: bool
    version: int
    debtBalance: str
    frozenBalance: str
    payoutBlocked: bool
    history: list[WithdrawalActionData]


class PendingAccount(PayoutAccountData):
    userId: str
    accountReference: str


class PendingAccountPage(Contract):
    items: list[PendingAccount]
    total: int
    page: int
    pageSize: int


class APIErrorBody(Contract):
    code: str
    message: str | None = None
    statusCode: int | None = None
    error: str | None = None


class SessionLogin(Contract):
    accessToken: str
    expiresIn: int
    role: Literal["agent", "admin"]


class LoginTicket(Contract):
    ticket: str
    expiresIn: int


class OrderCreated(Contract):
    orderId: str
    status: Literal["pending", "paid", "failed", "refunded"]


class CommissionResult(Contract):
    status: str
    orderId: str
    platformAmount: str | None = None
    bonusPool: str | None = None
    promoterAmount: str | None = None
    parentAmount: str | None = None


class PaymentInboxData(Contract):
    id: str
    provider: str
    eventId: str
    orderId: str
    eventType: str
    status: str
    attempts: int
    lastError: str | None
    nextAttemptAt: str
    createdAt: str


class PaymentInboxPage(Contract):
    items: list[PaymentInboxData]
    total: int
    page: int
    pageSize: int
