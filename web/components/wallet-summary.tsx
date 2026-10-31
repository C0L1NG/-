"use client";
import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import type { WalletState } from "@/lib/api-contract.generated";
import { Money } from "./money";
import { displayAmount } from "@/lib/money";
import { decimalMoney, moneyCents } from "@/lib/money";
import { demoAdminOverview } from "@/lib/admin-demo-data";
import { useLiveRefresh } from "./live-refresh";
export function WalletSummary({
  demo = false,
  revision: parentRevision = 0,
  hero = false,
}: {
  demo?: boolean;
  revision?: number;
  hero?: boolean;
}) {
  const { revision, refresh } = useLiveRefresh(!demo);
  const [wallet, setWallet] = useState<WalletState | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    if (demo) {
      setWallet({
        balance: decimalMoney(
          moneyCents(demoAdminOverview.platformTotalRevenue)! - 44000000n,
        ),
        frozenBalance: "40000.00",
        totalEarned: demoAdminOverview.platformTotalRevenue,
        debtBalance: "0.00",
      });
      return;
    }
    const controller = new AbortController();
    setError(false);
    adminGet<WalletState>("/api/admin/wallet", controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setWallet(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [demo, revision, parentRevision]);
  return (
    <div className={hero ? "console-wallet-hero" : "owner-wallet"}>
      {!hero && (
        <div className="account-ribbon">
          <span>平台结算账户</span>
          <span aria-hidden="true">↗</span>
        </div>
      )}
      <div className={hero ? "wallet-contents" : "owner-wallet-body"}>
        {error ? (
          <p role="alert" className="text-sm text-[#C5C5C5]">
            钱包余额暂时不可用{" "}
            <button className="ml-2 text-[var(--positive)]" onClick={refresh}>
              重试
            </button>
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-[#929292]">平台可用余额</p>
                <p className="wallet-available financial-number mt-2 break-all text-lg font-semibold text-[var(--positive)]">
                  <Money value={wallet?.balance} />
                </p>
              </div>
              <div>
                <p className="text-xs text-[#929292]">冻结 · 申请审核中</p>
                <p className="mt-2 font-mono text-lg font-bold">
                  <Money value={wallet?.frozenBalance} />
                </p>
              </div>
            </div>
            {wallet && wallet.debtBalance !== "0.00" && (
              <p className="mt-3 text-sm text-[#C5C5C5]">
                退款待追偿 {displayAmount(wallet.debtBalance)} · 当前禁止新提现
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-[#929292]">
              累计净收益是历史收益；提现以此处可用余额为准。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
