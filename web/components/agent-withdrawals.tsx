"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeading } from "./agent-ui";
import { WithdrawalHistory } from "./withdrawal-history";
import { useAgent } from "./agent-context";
export function AgentWithdrawals() {
  const { demo, demoData, hidden } = useAgent();
  return (
    <>
      <Link
        href="/agent/profile/"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--agent-muted)]"
      >
        <ArrowLeft size={16} />
        返回我的
      </Link>
      <PageHeading
        eyebrow="Payout activity"
        title="提现记录"
        subtitle="从申请、审核到付款，每一步都可查。"
      />
      <WithdrawalHistory
        hidden={hidden}
        demoItems={demo ? demoData.withdrawals : undefined}
      />
    </>
  );
}
