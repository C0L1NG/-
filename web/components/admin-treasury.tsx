"use client";
import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { adminGet } from "@/lib/admin-api";
import { PaymentRecovery } from "./payment-recovery";
import { PayoutVerification } from "./payout-verification";
import { Sheet } from "./agent-ui";
import type {
  PayoutDetails,
  WithdrawalData,
} from "@/lib/api-contract.generated";
import { WithdrawalPanel, PayoutBinding } from "./withdrawal-panel";
import { demoWithdrawals } from "@/lib/admin-finance-demo";
import { displayAmount } from "@/lib/money";
import type { TreasuryFocus } from "./admin-operations";

export function AdminTreasury({
  demo = false,
  focus,
  onComplete,
}: {
  demo?: boolean;
  focus?: TreasuryFocus;
  onComplete?: () => void;
}) {
  const [details, setDetails] = useState<PayoutDetails | null>(null);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<WithdrawalData | null>(null);
  const [action, setAction] = useState<"start" | "confirm" | "reject">("start");
  const [reference, setReference] = useState(""),
    [reason, setReason] = useState(""),
    [failure, setFailure] = useState("");
  const labels = {
    pending: "待审核",
    processing: "处理中",
    paid: "已付款",
    rejected: "已驳回",
  };
  const [items, setItems] = useState<WithdrawalData[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(!demo),
    [busy, setBusy] = useState("");
  const [tab, setTab] = useState<"review" | "withdraw" | "account" | "events">(
    "review",
  );
  const [status, setStatus] = useState<
    "" | "pending" | "processing" | "paid" | "rejected"
  >("");
  useEffect(() => {
    if (focus) {
      setTab(focus.tab);
      setStatus(focus.status ?? "");
      setPage(1);
    }
  }, [focus]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(
      `/api/admin/withdrawals?${new URLSearchParams({ page: String(page), pageSize: "20", ...(status ? { status } : {}) })}`,
      {
        signal: controller.signal,
        cache: "no-store",
      },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("提现审核列表暂时不可用");
        const data = await r.json();
        if (controller.signal.aborted) return;
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, page, revision, status]);
  async function viewDetails(
    item: WithdrawalData,
    nextAction?: "start" | "confirm" | "reject",
  ) {
    setCopied(false);
    setDetails(null);
    setSelected(item);
    setAction(
      nextAction ?? (item.status === "processing" ? "confirm" : "start"),
    );
    setReference("");
    setReason("");
    setFailure("");
    setBusy(item.id);
    setError("");
    try {
      setDetails(
        await adminGet<PayoutDetails>(
          `/api/admin/withdrawals/${item.id}/payout-details`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取付款账户");
    } finally {
      setBusy("");
    }
  }
  async function review() {
    const item = selected;
    if (!item || !details) return;
    setBusy(item.id);
    setError("");
    try {
      await apiPost(`/api/admin/withdrawals/${item.id}/review`, {
        action,
        expectedVersion: details.version,
        ...(action === "confirm" ? { transferReference: reference } : {}),
        ...(action === "reject"
          ? {
              rejectionReason: reason,
              ...(item.status === "processing"
                ? { failureReference: failure }
                : {}),
            }
          : {}),
      });
      setRevision((x) => x + 1);
      setDetails(null);
      setSelected(null);
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "审核失败");
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      id="funds"
      className="scroll-mt-24 rounded-xl border border-white/10 bg-[#121212] p-5 sm:p-6"
    >
      <h2 className="text-xl font-bold">资金执行与提现审核</h2>
      <p className="mt-2 text-sm text-[#929292]">
        操作留痕 · 渠道付款需核对真实流水后确认
      </p>
      <div className="my-5 flex flex-wrap gap-3">
        {(
          [
            ["review", "提现审核"],
            ["withdraw", "商户提现"],
            ["account", "商户收款账户"],
            ["events", "支付恢复"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={
              "rounded-full px-4 py-2 text-sm " +
              (tab === value
                ? "bg-[var(--action-bg)] font-bold text-[var(--action-text)]"
                : "bg-white/5 text-[#929292]")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "events" ? (
        <PaymentRecovery
          demo={demo}
          initialStatus={focus?.eventStatus}
          onComplete={onComplete}
        />
      ) : tab === "withdraw" ? (
        <div className="max-w-lg">
          <WithdrawalPanel
            scope="admin"
            demo={demo}
            onComplete={() => {
              setRevision((x) => x + 1);
              onComplete?.();
            }}
          />
        </div>
      ) : tab === "account" ? (
        <div className="max-w-lg">
          <PayoutBinding
            provider="bank"
            scope="admin"
            demo={demo}
            onComplete={onComplete}
          />
          {demo ? (
            <p className="mt-5 rounded-lg bg-[#0A0A0A] p-4 text-sm text-[#C5C5C5]">
              演示：林默的银行卡收款凭据待核验。展示账户状态，操作不提交。
            </p>
          ) : (
            <PayoutVerification onComplete={onComplete} />
          )}
        </div>
      ) : demo ? (
        <div className="space-y-3">
          <p className="text-sm text-[#929292]">
            虚构待办 · 演示操作不提交付款
          </p>
          {demoWithdrawals
            .filter((item) => !status || item.status === status)
            .map((item) => (
              <article
                key={item.id}
                className="rounded-lg bg-[#0A0A0A] p-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="font-mono text-[var(--positive)]">
                    {displayAmount(item.amount)}
                  </strong>
                  <span>{labels[item.status]}</span>
                </div>
                <p className="mt-2 text-[#929292]">
                  {item.userName} ·{" "}
                  {item.accountScope === "platform" ? "商户" : "代理"}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-[#929292]">
                  {item.id}
                </p>
              </article>
            ))}
        </div>
      ) : (
        <>
          <label className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[#929292]">
            提现状态
            <select
              aria-label="筛选提现状态"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setPage(1);
              }}
              className="min-h-11 rounded-full border border-white/10 bg-[#0A0A0A] px-4 text-[#F5F5F5]"
            >
              <option value="">全部</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="mb-4 text-sm text-[var(--positive)]">
              {error}
              <button
                className="ml-3"
                onClick={() => setRevision((x) => x + 1)}
              >
                重试
              </button>
            </p>
          )}
          {loading ? (
            <p className="text-sm text-[#929292]">正在加载…</p>
          ) : (
            !error && (
              <>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[#0A0A0A] p-4"
                    >
                      <span>
                        <strong className="font-mono text-[var(--positive)]">
                          {displayAmount(item.amount)}
                        </strong>
                        <span className="ml-3 text-sm">
                          {item.accountScope === "platform" ? "商户" : "代理"} ·{" "}
                          {labels[item.status]}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-[#929292]">
                          {item.userName || "未命名账户"} ·{" "}
                          {item.createdAt.slice(0, 16)}
                        </span>
                      </span>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <button
                          disabled={Boolean(busy)}
                          onClick={() => viewDetails(item)}
                        >
                          查看付款账户
                        </button>
                        {item.status === "pending" && (
                          <button
                            disabled={Boolean(busy)}
                            onClick={() => viewDetails(item, "start")}
                          >
                            进入付款处理
                          </button>
                        )}
                        {item.status === "processing" && (
                          <button
                            disabled={Boolean(busy)}
                            onClick={() => viewDetails(item, "confirm")}
                            className="text-[var(--positive)]"
                          >
                            核对成功流水
                          </button>
                        )}
                        {["pending", "processing"].includes(item.status) && (
                          <button
                            disabled={Boolean(busy)}
                            onClick={() => viewDetails(item, "reject")}
                          >
                            驳回 / 确认失败
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!items.length && (
                  <p className="text-sm text-[#929292]">暂无提现申请</p>
                )}
                <div className="mt-4 flex justify-end gap-4 text-sm">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((x) => x - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {page} / {Math.max(1, Math.ceil(total / 20))}
                  </span>
                  <button
                    disabled={page * 20 >= total}
                    onClick={() => setPage((x) => x + 1)}
                  >
                    下一页
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
      {details && (
        <Sheet title="核对付款账户" onClose={() => setDetails(null)}>
          <div className="space-y-4 text-[#F5F5F5]">
            <p className="font-mono text-2xl text-[var(--positive)]">
              {displayAmount(details.amount)}
            </p>
            <p>
              {details.ownerName} ·{" "}
              {details.claimantName
                ? `处理人：${details.claimantName}`
                : "尚未领取"}
            </p>
            <p>
              {details.accountLabel} · {details.provider}
            </p>
            <p className="break-all rounded-lg bg-white/5 p-4 font-mono text-sm">
              {details.accountReference.slice(0, 6)}••••
              {details.accountReference.slice(-4)}
            </p>
            <p className="rounded-lg bg-white/5 p-4 text-sm">
              冻结 {displayAmount(details.frozenBalance)} · 退款待追回{" "}
              {displayAmount(details.debtBalance)}
              {details.payoutBlocked && (
                <span className="mt-2 block text-[var(--positive)]">
                  存在钱包风险，禁止发起新付款。处理中必须先核查渠道结果。
                </span>
              )}
            </p>
            <button
              className="rounded-full bg-white/5 px-4 py-2 text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(details.accountReference);
                  setCopied(true);
                } catch {
                  setError("无法复制，请允许剪贴板权限后重试");
                }
              }}
            >
              {copied ? "已复制付款账户" : "复制完整付款账户"}
            </button>
            <p className="text-sm leading-6 text-[#929292]">
              提现单：{details.withdrawalId}
              <br />
              在付款渠道核对账户并使用提现单号作为幂等业务单号。只有渠道明确成功才能确认入账；状态未知时保持处理中，先查询渠道结果。
            </p>
            {selected &&
              ["pending", "processing"].includes(selected.status) && (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void review();
                  }}
                >
                  <div className="flex gap-2">
                    {(selected.status === "pending"
                      ? (["start", "reject"] as const)
                      : (["confirm", "reject"] as const)
                    ).map((value) => (
                      <button
                        type="button"
                        key={value}
                        onClick={() => setAction(value)}
                        className={
                          "rounded-full px-4 py-2 text-sm " +
                          (action === value
                            ? "bg-[var(--action-bg)] text-[var(--action-text)]"
                            : "bg-white/5")
                        }
                      >
                        {value === "start"
                          ? "领取付款"
                          : value === "confirm"
                            ? "确认成功"
                            : "驳回 / 确认失败"}
                      </button>
                    ))}
                  </div>
                  {action === "confirm" && (
                    <label className="block text-sm">
                      渠道成功流水号
                      <input
                        required
                        minLength={8}
                        maxLength={128}
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        className="mt-2 w-full rounded-xl bg-white/5 p-3"
                      />
                    </label>
                  )}
                  {action === "reject" && (
                    <label className="block text-sm">
                      驳回原因
                      <textarea
                        required
                        maxLength={256}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="mt-2 w-full rounded-xl bg-white/5 p-3"
                      />
                    </label>
                  )}
                  {action === "reject" && selected.status === "processing" && (
                    <label className="block text-sm">
                      已核对的渠道失败凭据
                      <input
                        required
                        minLength={8}
                        maxLength={128}
                        value={failure}
                        onChange={(e) => setFailure(e.target.value)}
                        className="mt-2 w-full rounded-xl bg-white/5 p-3"
                      />
                    </label>
                  )}
                  {!details.canReview && (
                    <p className="text-sm text-[var(--positive)]">
                      该提现由其他管理员处理，请联系当前处理人核查。
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="text-sm text-[var(--positive)]">
                      {error}
                    </p>
                  )}
                  <button
                    disabled={
                      Boolean(busy) ||
                      !details.canReview ||
                      (action === "start" && details.payoutBlocked)
                    }
                    className="w-full rounded-full bg-[var(--action-bg)] px-5 py-3 font-bold text-[var(--action-text)] disabled:opacity-40"
                  >
                    {busy
                      ? "正在保存…"
                      : action === "start"
                        ? "领取并进入付款处理"
                        : "保存已核对结果"}
                  </button>
                </form>
              )}
            <div className="space-y-2 text-xs text-[#929292]">
              {details.history.map((entry) => (
                <p key={entry.version}>
                  {entry.createdAt.slice(0, 16)} · {entry.actorName} ·{" "}
                  {entry.action === "start"
                    ? "领取"
                    : entry.action === "confirm"
                      ? "确认成功"
                      : "驳回"}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </p>
              ))}
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}
