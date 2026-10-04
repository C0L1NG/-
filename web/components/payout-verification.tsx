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
}: {
  onComplete?: () => void;
}) {
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [reference, setReference] = useState("");
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
  }, [page, revision]);
  async function verify(item: PendingAccount) {
    if (reference.trim().length < 8) return;
    setBusy(item.id);
    setError("");
    try {
      await apiPost(`/api/admin/payout-accounts/${item.id}/verify`, {
        verificationReference: reference.trim(),
      });
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
        <p role="alert" className="text-sm text-[var(--positive)]">
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
                  setReference("");
                  setError("");
                }}
                className="mt-3 rounded-full bg-[var(--action-bg)] px-4 py-2 font-bold text-[var(--action-text)]"
              >
                核验通过
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
          title="核验收款账户"
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
              核验凭据
              <input
                autoFocus
                required
                minLength={8}
                maxLength={128}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="mt-2 h-12 w-full rounded-lg border border-[#333] bg-[#111] px-3"
                placeholder="至少 8 个字符"
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
              {busy ? "正在保存…" : "确认已核验归属"}
            </button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
