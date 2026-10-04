"use client";
import { useEffect, useState } from "react";
import type {
  WithdrawalPage,
  WithdrawalData,
} from "@/lib/api-contract.generated";
import { displayAmount } from "@/lib/money";
import { RefreshStatus, useLiveRefresh } from "./live-refresh";
const statusNames = {
  pending: "待审核",
  processing: "平台处理中",
  paid: "已付款",
  rejected: "已驳回 / 资金已解冻",
};
export function WithdrawalHistory({
  scope = "agent",
  hidden = false,
  demoItems,
}: {
  scope?: "agent" | "admin";
  hidden?: boolean;
  demoItems?: WithdrawalData[];
}) {
  const [page, setPage] = useState(1);
  const { revision, refresh } = useLiveRefresh(!demoItems);
  const [at, setAt] = useState<string | null>(null);
  const [data, setData] = useState<WithdrawalPage | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (demoItems) {
      setData({
        items: demoItems.slice((page - 1) * 5, page * 5),
        total: demoItems.length,
        page,
        pageSize: 5,
      });
      return;
    }
    const controller = new AbortController();
    setData(null);
    setError("");
    fetch(`/api/${scope}/withdrawals?page=${page}&pageSize=5`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("提现记录暂时不可用");
        const result = await response.json();
        if (!controller.signal.aborted) {
          setData(result);
          setAt(new Date().toISOString());
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [scope, page, revision, demoItems]);
  return (
    <section className="mt-7 border-t border-[var(--agent-line,rgba(255,255,255,.1))] pt-5">
      <h3 className="text-sm font-bold text-[var(--agent-text,#F5F5F5)]">
        {scope === "admin" ? "全平台提现记录" : "我的提现记录"}
      </h3>
      <RefreshStatus
        demo={Boolean(demoItems)}
        at={at}
        busy={!data && !error}
        onRefresh={refresh}
      />
      {error ? (
        <p
          role="alert"
          className="mt-3 text-xs text-[var(--agent-accent-text,#F5F5F5)]"
        >
          {error}
          <button type="button" className="ml-2" onClick={refresh}>
            重试
          </button>
        </p>
      ) : !data ? (
        <p className="mt-3 text-xs text-[var(--agent-muted,#929292)]">
          读取中…
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {data.items.map((item) => (
              <article
                key={item.id}
                className="rounded-lg bg-[var(--agent-soft,rgba(255,255,255,.05))] p-3 text-xs"
              >
                <div className="flex justify-between gap-3">
                  <strong className="font-mono text-[var(--agent-accent-text,#F5F5F5)]">
                    {displayAmount(item.amount, hidden)}
                  </strong>
                  <span className="text-[var(--agent-text,#C5C5C5)]">
                    {statusNames[item.status]}
                  </span>
                </div>
                <p className="mt-2 break-all font-mono leading-5 text-[var(--agent-muted,#929292)]">
                  {item.createdAt.slice(0, 16).replace("T", " ")} UTC
                  <br />
                  {item.id}
                  {item.rejectionReason && (
                    <>
                      <br />
                      驳回原因：{item.rejectionReason}
                    </>
                  )}
                  {item.payoutReference && (
                    <>
                      <br />
                      处理凭据：{item.payoutReference}
                    </>
                  )}
                </p>
              </article>
            ))}
          </div>
          {!data.items.length && (
            <p className="mt-3 text-xs text-[var(--agent-muted,#929292)]">
              暂无提现申请
            </p>
          )}
          {data.total > 5 && (
            <div className="mt-4 flex justify-between text-xs text-[var(--agent-text,#C5C5C5)]">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((x) => x - 1)}
              >
                上一页
              </button>
              <span>
                {page} / {Math.ceil(data.total / 5)}
              </span>
              <button
                type="button"
                disabled={page * 5 >= data.total}
                onClick={() => setPage((x) => x + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
