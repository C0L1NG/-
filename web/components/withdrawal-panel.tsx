"use client";

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/api";
import { WithdrawalHistory } from "./withdrawal-history";
import { displayAmount } from "@/lib/money";
import type {
  PayoutAccountData,
  WalletState,
  WithdrawalData,
} from "@/lib/api-contract.generated";

const field =
  "w-full rounded-lg border border-[var(--agent-line,rgba(255,255,255,.1))] bg-[var(--agent-bg,#0A0A0A)] px-4 py-3 text-sm text-[var(--agent-text,#F5F5F5)] outline-none focus:border-[var(--positive)]";
const primary =
  "h-12 w-full rounded-full bg-[var(--action-bg)] text-sm font-bold text-[var(--action-text)] disabled:opacity-40";
export function WithdrawalPanel({
  scope = "agent",
  demo = false,
  onComplete,
  hidden = false,
}: {
  scope?: "agent" | "admin";
  demo?: boolean;
  onComplete?: () => void;
  hidden?: boolean;
}) {
  const [accounts, setAccounts] = useState<PayoutAccountData[]>([]),
    [wallet, setWallet] = useState<WalletState | null>(null);
  const [amount, setAmount] = useState(""),
    [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(!demo),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const [key, setKey] = useState("");
  useEffect(() => {
    setKey(crypto.randomUUID());
  }, []);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setWallet(null);
    Promise.all([
      fetch(`/api/${scope}/payout-accounts`, {
        signal: controller.signal,
        cache: "no-store",
      }),
      fetch(`/api/${scope}/wallet`, {
        signal: controller.signal,
        cache: "no-store",
      }),
    ])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok) throw new Error("无法加载收款账户或余额");
        const [x, y] = await Promise.all([a.json(), b.json()]);
        setAccounts(x.items);
        setAccountId(
          x.items.find((i: PayoutAccountData) => i.verified)?.id ?? "",
        );
        setWallet(y);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, scope, revision]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(amount) || !accountId) {
      setError("请输入最多两位小数的金额，并选择已验证账户");
      return;
    }
    setBusy(true);
    try {
      const result = await apiPost<WithdrawalData>(
        `/api/${scope}/withdrawals`,
        { amount, accountId, idempotencyKey: key },
      );
      setSuccess(`申请已提交：¥${result.amount}，金额已冻结，等待审核。`);
      setKey(crypto.randomUUID());
      setAmount("");
      setRevision((x) => x + 1);
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "申请失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  if (demo)
    return (
      <p className="text-sm leading-7 text-[var(--agent-muted,#929292)]">
        公开演示不提交提现。正式账户申请后会冻结对应余额，审核付款完成后记录实际流水；驳回会解除冻结。
      </p>
    );
  if (loading)
    return (
      <p className="text-sm text-[var(--agent-muted,#929292)]">
        正在核对余额与收款账户…
      </p>
    );
  return (
    <div>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-[var(--agent-soft,rgba(255,255,255,.05))] p-4 text-sm text-[var(--agent-muted,#929292)]">
          可用{" "}
          <span className="font-mono text-[var(--agent-text,#F5F5F5)]">
            {displayAmount(wallet?.balance, hidden)}
          </span>{" "}
          · 冻结{" "}
          <span className="font-mono">
            {displayAmount(wallet?.frozenBalance, hidden)}
          </span>
          {wallet && wallet.debtBalance !== "0.00" && (
            <p className="mt-2 text-[var(--agent-accent-text,#F5F5F5)]">
              退款待追偿 {displayAmount(wallet.debtBalance, hidden)}
              ，后续收益将优先抵扣。
            </p>
          )}
        </div>
        <label className="block text-sm">
          收款账户
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={field + " mt-2"}
          >
            <option value="">选择已验证收款账户</option>
            {accounts
              .filter((x) => x.verified)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
          </select>
        </label>
        {!accounts.some((x) => x.verified) && (
          <p className="text-sm text-[var(--agent-muted,#929292)]">
            请先关联本人微信零钱。银行卡收款需平台完成付款服务接入与身份核验。
          </p>
        )}
        <label className="block text-sm">
          提现金额
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={field + " mt-2 font-mono"}
          />
        </label>
        {error && (
          <p
            role="alert"
            className="text-sm text-[var(--agent-accent-text,#F5F5F5)]"
          >
            {error}
            <button
              type="button"
              onClick={() => setRevision((x) => x + 1)}
              className="ml-3"
            >
              重新读取余额
            </button>
          </p>
        )}
        {success && (
          <p
            role="status"
            className="text-sm text-[var(--agent-accent-text,#F5F5F5)]"
          >
            {success}
          </p>
        )}
        <button
          disabled={
            busy || !accountId || !wallet || wallet.debtBalance !== "0.00"
          }
          className={primary}
        >
          {busy ? "正在提交…" : "提交提现申请"}
        </button>
        <p className="text-xs leading-5 text-[var(--agent-muted,#929292)]">
          申请成功不代表渠道付款完成。请在提现记录中查看处理状态。
        </p>
      </form>
      <WithdrawalHistory scope={scope} hidden={hidden} />
    </div>
  );
}

export function PayoutBinding({
  provider,
  scope = "agent",
  demo = false,
  onComplete,
}: {
  provider: "wechat" | "bank";
  scope?: "agent" | "admin";
  demo?: boolean;
  onComplete?: () => void;
}) {
  const [reference, setReference] = useState(""),
    [label, setLabel] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (demo) {
      setMessage("公开演示不保存收款信息");
      return;
    }
    setBusy(true);
    try {
      const result = await apiPost<PayoutAccountData>(
        `/api/${scope}/payout-accounts`,
        {
          provider,
          ...(provider === "bank"
            ? { vaultReference: reference, label: label || "银行卡收款" }
            : {}),
        },
      );
      setMessage(
        result.verified
          ? "本人微信收款身份已关联"
          : "已提交，等待管理员核验支付保管凭据",
      );
      onComplete?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "绑定失败");
    } finally {
      setBusy(false);
    }
  }
  if (provider === "bank" && scope === "agent")
    return (
      <p className="text-sm leading-7 text-[var(--agent-muted,#929292)]">
        银行卡绑定需通过平台的付款服务完成本人身份核验。当前尚未接入该服务；请先关联本人微信零钱，或联系平台开通银行卡收款。
      </p>
    );
  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <p className="leading-6 text-[var(--agent-muted,#929292)]">
        {provider === "wechat"
          ? "关联当前微信登录身份作为本人收款账户。实际付款由平台审核处理。"
          : "使用支付服务提供的 vault_ 保管凭据。平台不收集完整银行卡号；没有保管服务时请联系管理员安排核验。"}
      </p>
      {provider === "bank" && (
        <>
          <label className="block">
            保管凭据
            <input
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="vault_…"
              className={field + " mt-2 font-mono"}
            />
          </label>
          <label className="block">
            账户备注（脱敏）
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="如：本人银行 · 尾号 1234"
              className={field + " mt-2"}
            />
          </label>
        </>
      )}
      {message && (
        <p role="status" className="text-[var(--agent-accent-text,#F5F5F5)]">
          {message}
        </p>
      )}
      <button disabled={busy} className={primary}>
        {busy
          ? "正在提交…"
          : provider === "wechat"
            ? "关联本人微信零钱"
            : "提交核验"}
      </button>
    </form>
  );
}
