"use client";
import Link from "next/link";
import {
  ArrowDownToLine,
  Download,
  ArrowUpRight,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { displayAmount, formatMoney } from "@/lib/money";
import { AdminOperations } from "./admin-operations";
import { WalletSummary } from "./wallet-summary";
import { RefreshStatus } from "./live-refresh";
import { exportAdminAudit } from "@/lib/admin-export";
import { Sheet } from "./agent-ui";
import { WithdrawalPanel } from "./withdrawal-panel";
import { Skeleton } from "./admin-dark-ui";
import { useAdminMobile } from "./admin-mobile-context";
export function AdminMobileHome() {
  const { demo, all, day, loading, notify, refresh, revision, updatedAt } =
    useAdminMobile();
  const router = useRouter();
  const [withdrawOpen, setWithdrawOpen] = useState(false),
    [exporting, setExporting] = useState(false);
  const amount = formatMoney(all?.platformTotalRevenue);
  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportAdminAudit(demo);
      notify(count === null ? "对账文件已生成" : `已导出 ${count} 笔演示订单`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <header className="flex items-center justify-between border-b border-[#262626] pb-5">
        <div>
          <span className="text-lg font-bold tracking-tight">
            CONSOLE<span className="ml-1 text-[#C5FF59]">▰</span>
          </span>
          <p className="mt-1 text-xs text-[#929292]">老板总控 · 超级管理员</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#252525] text-xs font-semibold">
          老板
        </span>
      </header>
      <section aria-label="平台净收益池" className="py-7">
        <h1 className="text-sm font-normal text-[#999]">
          平台净收益{" "}
          <span className="ml-2 rounded border border-[#333] px-1.5 py-0.5 font-mono text-[11px] text-white">
            30%
          </span>
        </h1>
        {loading ? (
          <Skeleton className="mt-4 h-12 w-64" />
        ) : (
          <p
            className="financial-number mt-4 font-mono font-semibold leading-tight"
            style={{
              fontSize: `clamp(22px, ${Math.min(10.5, 118 / amount.length)}vw, 44px)`,
            }}
          >
            <span className="mr-1 text-[.7em] text-[#888]">¥</span>
            {amount}
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[#929292]">
          <ShieldCheck size={13} className="text-[var(--positive)]" />
          累计净分成 · 已扣除退款冲正
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className="exchange-primary"
            onClick={() => setWithdrawOpen(true)}
          >
            <ArrowDownToLine size={16} />
            商户提现
          </button>
          <button
            className="exchange-secondary"
            onClick={download}
            disabled={exporting}
          >
            <Download size={16} />
            {exporting ? "正在导出…" : "对账导出"}
          </button>
        </div>
      </section>
      <WalletSummary demo={demo} revision={revision} />
      <div className="mt-3">
        <RefreshStatus
          demo={demo}
          at={updatedAt}
          busy={loading}
          onRefresh={refresh}
        />
      </div>
      <section className="mt-6 border-y border-[#262626] py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">今日运行</h2>
          <span className="text-[11px] text-[#777]">UTC 今日</span>
        </div>
        <div className="mt-5">
          <p className="text-xs text-[#929292]">平台抽成收入</p>
          <p className="financial-number mt-2 font-mono text-2xl font-semibold text-[var(--positive)]">
            {loading ? "—" : displayAmount(day?.platformTotalRevenue)}
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-[#292929]">
          <div>
            <p className="text-xs text-[#929292]">全网成单</p>
            <p className="mt-2 font-mono text-xl">
              {day?.paidOrderCount ?? "—"}
              <span className="ml-2 text-xs text-[#888]">笔</span>
            </p>
          </div>
          <div className="pl-5">
            <p className="text-xs text-[#929292]">活跃出单代理</p>
            <p className="mt-2 font-mono text-xl">
              {day?.activePromoterCount ?? "—"}
              <span className="ml-2 text-xs text-[#888]">人</span>
            </p>
          </div>
        </div>
      </section>
      <div className="mt-6">
        <AdminOperations
          demo={demo}
          refreshKey={revision}
          onSelect={(focus) =>
            router.push(
              "/admin/mobile/treasury/?" +
                new URLSearchParams({
                  tab: focus.tab,
                  ...(focus.status ? { status: focus.status } : {}),
                  ...(focus.eventStatus
                    ? { eventStatus: focus.eventStatus }
                    : {}),
                }),
            )
          }
        />
      </div>
      <section className="mt-7">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">全网规模</h2>
          <Link href="/admin/mobile/team/" aria-label="查看代理网络">
            <ArrowUpRight size={17} />
          </Link>
        </div>
        {[
          { label: "GMV 净成交", value: all?.totalGmv },
          { label: "代理净分成", value: all?.agentCommissionPool },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 border-b border-[#262626] py-4 text-sm"
          >
            <span className="text-[#929292]">{item.label}</span>
            <strong className="break-all text-right font-mono text-sm font-medium">
              {displayAmount(item.value)}
            </strong>
          </div>
        ))}
        <Link
          href="/admin/mobile/audit/"
          className="mt-4 flex min-h-11 items-center justify-between text-sm"
        >
          查看全网分账
          <ChevronRight size={16} />
        </Link>
      </section>
      {withdrawOpen && (
        <Sheet title="商户资金提现" onClose={() => setWithdrawOpen(false)}>
          <WithdrawalPanel scope="admin" demo={demo} onComplete={refresh} />
        </Sheet>
      )}
    </>
  );
}
