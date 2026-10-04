import type {
  WithdrawalData,
  PaymentInboxData,
} from "./api-contract.generated";
export const demoWithdrawals: WithdrawalData[] = [
  {
    id: "DEMO-WITHDRAW-001",
    userId: "a1",
    userName: "林默",
    amount: "18000.00",
    status: "pending",
    accountScope: "agent",
    createdAt: "2026-10-03T09:00:00Z",
    payoutReference: null,
  },
  {
    id: "DEMO-WITHDRAW-002",
    userId: "a2",
    userName: "许知行",
    amount: "12000.00",
    status: "pending",
    accountScope: "agent",
    createdAt: "2026-10-03T08:00:00Z",
    payoutReference: null,
  },
  {
    id: "DEMO-WITHDRAW-003",
    userId: "admin",
    userName: "老板账户",
    amount: "40000.00",
    status: "processing",
    accountScope: "platform",
    createdAt: "2026-10-02T08:00:00Z",
    payoutReference: null,
    claimedBy: "admin",
    version: 1,
  },
];
export const demoPaymentEvents: PaymentInboxData[] = [
  {
    id: "DEMO-EVENT-001",
    provider: "演示渠道",
    eventId: "DEMO-NOTICE-001",
    orderId: "DEMO-ORDER-001",
    eventType: "paid",
    status: "failed",
    attempts: 3,
    lastError: "演示：钱包状态待人工核对",
    nextAttemptAt: "2026-10-03T16:05:00Z",
    createdAt: "2026-10-03T15:55:00Z",
  },
];
