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
