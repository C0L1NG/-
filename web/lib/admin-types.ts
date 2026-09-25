export type AdminOverview = { platformTotalRevenue: string; totalGmv: string; agentCommissionPool: string; agentCount: number; paidOrderCount: number; activePromoterCount?: number };
export type AgentNode = { id: string; displayName: string; referralCode: string | null; balance: string; totalEarned: string; ownGmv: string; ownOrderCount: number; platformContribution: string; mentorPaidUp: string; teamSize: number; children: AgentNode[] };
export type TeamTree = { root: { id: string; type: "ADMIN"; displayName: string; children: AgentNode[] } };
export type Split = { recipientId: string; recipientName: string; ratePercent: number; amount: string };
export type AuditItem = { id: string; orderNo: string; totalAmount: string; profitAmount: string; settlementStatus: string; createdAt: string; promoter: { id: string; displayName: string }; platform: { ratePercent: number; amount: string } | null; promoterCommission: Split | null; mentorCommission: Split | null };
export type AuditPage = { page: number; pageSize: number; total: number; totalPages: number; items: AuditItem[] };
