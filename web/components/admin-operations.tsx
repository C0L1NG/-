"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { adminGet } from "@/lib/admin-api";
import type { OperationsSummary } from "@/lib/api-contract.generated";
import { RefreshStatus, useLiveRefresh } from "./live-refresh";
export type TreasuryFocus = {
  tab: "review" | "account" | "events";
  status?: "pending" | "processing";
  eventStatus?: "pending" | "failed";
  nonce?: number;
};
export function AdminOperations({
  demo = false,
  onSelect,
  refreshKey = 0,
}: {
  demo?: boolean;
  onSelect: (focus: TreasuryFocus) => void;
  refreshKey?: number;
}) {
  const { revision, refresh } = useLiveRefresh(!demo);
  const [data, setData] = useState<OperationsSummary | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!demo),
    [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (demo) {
      setData({
        pendingWithdrawals: 2,
        processingWithdrawals: 1,
        failedPaymentEvents: 1,
        pendingPaymentEvents: 0,
        unverifiedAccounts: 1,
      });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    adminGet<OperationsSummary>(
      "/api/admin/operations-summary",
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("资金待办暂时无法读取");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, revision, refreshKey]);
  const entries = [
    {
      label: "待审核提现",
      count: data?.pendingWithdrawals,
      focus: { tab: "review", status: "pending" } as TreasuryFocus,
    },
    {
      label: "付款处理中",
      count: data?.processingWithdrawals,
      focus: { tab: "review", status: "processing" } as TreasuryFocus,
    },
    {
      label: "支付恢复失败",
      count: data?.failedPaymentEvents,
      focus: { tab: "events", eventStatus: "failed" } as TreasuryFocus,
    },
    {
      label: "收款账户待核验",
      count: data?.unverifiedAccounts,
      focus: { tab: "account" } as TreasuryFocus,
    },
  ];
  return (
    <section aria-label="资金待办" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">资金待办</h2>
        <RefreshStatus demo={demo} busy={loading} at={at} onRefresh={refresh} />
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-white/10 bg-[#121212] p-4 text-sm text-[#C5C5C5]"
        >
          {error}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {entries.map((entry) => (
            <button
              key={entry.label}
              type="button"
              disabled={!data}
              onClick={() => onSelect({ ...entry.focus, nonce: Date.now() })}
              className="rounded-lg border border-white/[0.08] bg-[#121212] p-4 text-left transition-colors hover:bg-[#1C1C1C] disabled:opacity-50"
            >
              <span className="flex items-center justify-between gap-2 text-xs text-[#929292]">
                {entry.label}
                <ArrowUpRight size={14} />
              </span>
              <strong className="mt-3 block font-mono text-2xl text-white">
                {entry.count ?? "—"}
              </strong>
            </button>
          ))}
        </div>
      )}
      {(data?.pendingPaymentEvents ?? 0) > 0 && (
        <button
          onClick={() =>
            onSelect({
              tab: "events",
              eventStatus: "pending",
              nonce: Date.now(),
            })
          }
          className="min-h-11 text-sm text-[var(--positive)]"
        >
          另有 {data?.pendingPaymentEvents} 笔已验签通知等待处理 →
        </button>
      )}
    </section>
  );
}
