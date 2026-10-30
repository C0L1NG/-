"use client";
import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import { apiPost } from "@/lib/api";
import type { SystemHealth, CasePage } from "@/lib/api-contract.generated";

function discrepancyLabel(detail: string) {
  if (detail.includes("missing commission")) return "分成尚未记入钱包";
  if (detail.includes("unexpected commission"))
    return "存在无对应分润记录的入账";
  if (detail.includes("amount differs")) return "分成与实际入账金额不一致";
  if (detail.includes("refund")) return "退款账目需要核对";
  if (detail.includes("Withdrawal")) return "提现状态与账目需要核对";
  return "账务记录存在差异";
}

export function SystemHealthPanel({
  demo = false,
  refreshKey = 0,
}: {
  demo?: boolean;
  refreshKey?: number;
}) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [cases, setCases] = useState<CasePage | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    Promise.all([
      adminGet<SystemHealth>("/api/admin/system-health", controller.signal),
      adminGet<CasePage>(
        `/api/admin/reconciliation-cases?page=${page}&pageSize=10`,
        controller.signal,
      ),
    ])
      .then(([next, entries]) => {
        if (controller.signal.aborted) return;
        setHealth(next);
        setCases(entries);
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("运行状态暂时无法更新，请重试。");
      });
    return () => controller.abort();
  }, [demo, refreshKey, revision, page]);
  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await apiPost(`/api/admin/reconciliation-cases/${id}/acknowledge`, {});
      setRevision((value) => value + 1);
    } catch {
      setError("认领失败，请重试。");
    } finally {
      setBusy("");
    }
  }
  return (
    <details className="rounded-2xl border border-white/[0.08] bg-[var(--console-surface)] px-5 py-4">
      <summary className="flex min-h-8 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
        系统运行与对账
        <span className="text-xs text-[var(--console-muted)]">
          {demo
            ? "演示数据"
            : health
              ? `${health.unresolvedCases} 项待核对`
              : "读取状态中"}
        </span>
      </summary>
      {demo ? (
        <p className="mt-4 text-sm text-[var(--console-muted)]">
          正式账户可查看恢复任务、对账差异及处理进展。
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {error && (
            <p role="alert" className="text-sm text-[var(--negative)]">
              {error}
              <button
                onClick={() => setRevision((v) => v + 1)}
                className="ml-3 underline"
              >
                重试
              </button>
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {health?.workers.map((worker) => (
              <div key={worker.name} className="rounded-xl bg-white/[0.04] p-4">
                <div className="flex items-center justify-between text-xs">
                  <span>
                    {worker.name === "payment-recovery"
                      ? "支付恢复"
                      : "资金对账"}
                  </span>
                  <span
                    className={
                      worker.state === "healthy"
                        ? "text-[var(--positive)]"
                        : "text-[var(--warning)]"
                    }
                  >
                    {worker.state === "healthy"
                      ? "运行正常"
                      : worker.state === "degraded"
                        ? "需要检查"
                        : "尚无运行记录"}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-[var(--console-muted)]">
                  {worker.lastSuccessAt
                    ? worker.lastSuccessAt.slice(0, 19) + " UTC"
                    : "等待首次成功执行"}
                </p>
              </div>
            ))}
          </div>
          {health && health.exhaustedPaymentEvents > 0 && (
            <p className="text-xs text-[var(--warning)]">
              {health.exhaustedPaymentEvents}{" "}
              条支付通知已用尽自动重试次数，请前往支付恢复处理。
            </p>
          )}
          {cases?.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] py-3 text-xs"
            >
              <div className="min-w-0 flex-1 text-[var(--console-muted)]">
                <p className="text-[var(--warning)]">
                  {discrepancyLabel(item.detail)}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer">查看定位信息</summary>
                  <p className="mt-2 break-all font-mono">{item.detail}</p>
                </details>
              </div>
              <button
                disabled={Boolean(busy) || item.status === "acknowledged"}
                onClick={() => acknowledge(item.id)}
                className="min-h-10 rounded-full bg-white/[0.06] px-4 disabled:opacity-50"
              >
                {item.status === "acknowledged" ? "已认领" : "认领核对"}
              </button>
            </div>
          ))}
          {cases && cases.total === 0 && (
            <p className="text-xs text-[var(--console-muted)]">
              最近一次成功对账未发现待处理差异。
            </p>
          )}
          {Boolean(cases?.total) && (
            <p className="text-xs text-[var(--console-muted)]">
              修复差异并通过下一次对账后自动关闭，认领不代表已修复。
            </p>
          )}
          {cases && cases.total > 10 && (
            <div className="flex justify-end gap-4 text-xs">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>{page}</span>
              <button
                disabled={page * 10 >= cases.total}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
