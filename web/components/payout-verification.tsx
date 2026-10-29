"use client";
import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { Sheet } from "./agent-ui";
import { adminGet } from "@/lib/admin-api";
import type {
  PendingAccountPage,
  PendingAccount,
} from "@/lib/api-contract.generated";
export function PayoutVerification({
  onComplete,
  refreshKey = 0,
}: {
  refreshKey?: number;
  onComplete?: () => void;
}) {
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [reference, setReference] = useState("");
  const [decision, setDecision] = useState<"verify" | "reject">("verify");
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<PendingAccountPage | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    adminGet<PendingAccountPage>(
      `/api/admin/payout-accounts/pending?page=${page}&pageSize=20`,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [page, revision, refreshKey]);
  async function verify(item: PendingAccount) {
    if (reference.trim().length < (decision === "verify" ? 8 : 1)) return;
    setBusy(item.id);
    setError("");
    try {
      await apiPost(
        `/api/admin/payout-accounts/${item.id}/${decision}`,
        decision === "verify"
          ? { verificationReference: reference.trim() }
          : { reason: reference.trim() },
      );
      setRevision((x) => x + 1);
      setSelected(null);
      setReference("");
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "核验失败");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="mt-6 space-y-3">
      <h3 className="font-bold">待核验收款账户</h3>
      <p className="text-xs leading-6 text-[#929292]">
        核验真实账户归属后方可开放提现。账户标识来自支付保管服务。
      </p>
      {error ? (
        <p role="alert" className="text-sm text-[var(--negative)]">
          {error}
          <button onClick={() => setRevision((x) => x + 1)} className="ml-3">
            重试
          </button>
        </p>
      ) : !data ? (
        <p className="text-sm text-[#929292]">加载中…</p>
      ) : (
        <>
          {data.items.map((item) => (
            <div key={item.id} className="rounded-lg bg-[#0A0A0A] p-4 text-sm">
              <strong>{item.label}</strong>
              <p className="mt-2 break-all font-mono text-xs text-[#929292]">
                用户：{item.userId}
                <br />
                账户：{item.accountReference}
              </p>
              <button
                disabled={Boolean(busy)}
                onClick={() => {
                  setSelected(item);
                  setDecision("verify");
                  setReference("");
                  setError("");
                }}
                className="mt-3 rounded-full bg-[var(--action-bg)] px-4 py-2 font-bold text-[var(--action-text)]"
              >
                核验通过
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setSelected(item);
                  setDecision("reject");
                  setReference("");
                  setError("");
                }}
                className="ml-3 min-h-11 rounded-full px-4 text-[var(--negative)]"
              >
                驳回申请
              </button>
            </div>
          ))}
          {!data.items.length && (
            <p className="text-sm text-[#929292]">没有待核验账户</p>
          )}
          <div className="flex gap-4 text-sm">
            <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
              上一页
            </button>
            <span>{page}</span>
            <button
              disabled={page * 20 >= data.total}
              onClick={() => setPage((x) => x + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      {selected && (
        <Sheet
          title={decision === "verify" ? "核验收款账户" : "驳回账户申请"}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verify(selected);
            }}
            className="space-y-5"
          >
            <p className="text-sm leading-6 text-[#A3A3A3]">
              在付款保管服务核对真实账户归属后，填写核验凭据。此操作将开放该账户提现。
            </p>
            <p className="break-all rounded-lg bg-white/5 p-4 font-mono text-xs">
              {selected.label}
              <br />
              {selected.accountReference}
            </p>
            <label className="block text-sm">
              {decision === "verify" ? "核验凭据" : "驳回原因"}
              <input
                autoFocus
                required
                minLength={decision === "verify" ? 8 : 1}
                maxLength={decision === "verify" ? 128 : 256}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-2 h-12 w-full rounded-lg border border-[#333] bg-[#111] px-3"
                placeholder={
                  decision === "verify"
                    ? "至少 8 个字符"
                    : "说明需要补充或核验的信息"
                }
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-[var(--negative)]">
                {error}
              </p>
            )}
            <button
              disabled={Boolean(busy)}
              className="exchange-primary w-full"
            >
              {busy
                ? "正在保存…"
                : decision === "verify"
                  ? "确认已核验归属"
                  : "确认驳回"}
            </button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
