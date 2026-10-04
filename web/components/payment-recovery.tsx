"use client";
import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import { apiPost } from "@/lib/api";
import type { PaymentInboxPage } from "@/lib/api-contract.generated";
import { demoPaymentEvents } from "@/lib/admin-finance-demo";
export function PaymentRecovery({
  demo = false,
  initialStatus,
  onComplete,
}: {
  demo?: boolean;
  initialStatus?: "failed" | "pending";
  onComplete?: () => void;
}) {
  const [status, setStatus] = useState<"" | "failed" | "pending" | "processed">(
    initialStatus ?? "",
  );
  useEffect(() => {
    setStatus(initialStatus ?? "");
    setPage(1);
  }, [initialStatus]);
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<PaymentInboxPage | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    if (demo) {
      const items = demoPaymentEvents.filter(
        (item) => !status || item.status === status,
      );
      setData({ items, total: items.length, page: 1, pageSize: 20 });
      return;
    }
    let active = true;
    setData(null);
    setError("");
    adminGet<PaymentInboxPage>(
      `/api/admin/payment-events?${new URLSearchParams({ page: String(page), pageSize: "20", ...(status ? { status } : {}) })}`,
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setError("支付通知暂时不可用");
      });
    return () => {
      active = false;
    };
  }, [demo, page, revision, status]);
  async function retry(id: string) {
    setBusy(id);
    setError("");
    try {
      await apiPost(`/api/admin/payment-events/${id}/retry`, {});
      setRevision((x) => x + 1);
      onComplete?.();
    } catch {
      setError(
        "恢复未完成，请核查订单与钱包；验签通知仍已保存。修复后可再次重试。",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="space-y-4">
      <label className="flex flex-wrap items-center gap-3 text-sm text-[#929292]">
        通知状态
        <select
          aria-label="筛选支付通知状态"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as typeof status);
            setPage(1);
          }}
          className="min-h-11 rounded-full border border-white/10 bg-[#0A0A0A] px-4 text-[#F5F5F5]"
        >
          <option value="">全部</option>
          <option value="failed">待修复</option>
          <option value="pending">待处理</option>
          <option value="processed">已处理</option>
        </select>
      </label>
      {demo && (
        <p className="text-sm text-[#929292]">
          虚构通知展示 · 不接收或恢复真实支付
        </p>
      )}
      <p className="text-sm text-[#929292]">
        已验签通知独立保存。自动恢复任务按退避间隔重试；持续失败需人工修复后重试。
      </p>
      {error && (
        <p role="alert" className="text-sm text-[var(--positive)]">
          {error}
          <button className="ml-3" onClick={() => setRevision((x) => x + 1)}>
            刷新
          </button>
        </p>
      )}
      {!data && !error && <p className="text-sm text-[#929292]">正在加载…</p>}
      {data?.items.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#0A0A0A] p-4"
        >
          <div>
            <strong>
              {item.eventType === "paid" ? "付款通知" : "退款通知"}
            </strong>
            <span className="ml-3 text-sm text-[#929292]">
              {item.status === "processed"
                ? "已处理"
                : item.status === "failed"
                  ? "待修复"
                  : "待处理"}
            </span>
            <p className="mt-2 break-all font-mono text-xs text-[#929292]">
              {item.provider} · {item.eventId}
            </p>
            <p className="mt-1 text-xs text-[#929292]">
              已尝试 {item.attempts} 次 · 收到于 {item.createdAt.slice(0, 16)}
            </p>
          </div>
          {item.status !== "processed" && (
            <button
              disabled={Boolean(busy) || demo}
              onClick={() => retry(item.id)}
              className="rounded-full bg-[var(--action-bg)] px-4 py-2 text-sm font-bold text-[var(--action-text)] disabled:opacity-40"
            >
              {busy === item.id ? "恢复中…" : "修复后重试"}
            </button>
          )}
        </div>
      ))}
      {data && (
        <div className="flex justify-end gap-4 text-sm">
          <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
            上一页
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(data.total / 20))}
          </span>
          <button
            disabled={page * 20 >= data.total}
            onClick={() => setPage((x) => x + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
