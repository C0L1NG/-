"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  Eye,
  EyeOff,
  History,
  UsersRound,
  Share2,
  ChevronRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { displayAmount, formatMoney } from "@/lib/money";
import { RefreshStatus } from "./live-refresh";
import type { LedgerItem, LedgerPage } from "@/lib/types";
import { useAgent } from "./agent-context";
import { WithdrawalPanel } from "./withdrawal-panel";
import { LedgerDetail, LedgerRow, Sheet, Skeleton } from "./agent-ui";

export function AgentHome() {
  const {
    demo,
    overview,
    loading,
    hidden,
    setHidden,
    refresh,
    revision,
    updatedAt,
    demoData,
  } = useAgent();
  const [recent, setRecent] = useState<LedgerItem[]>(
    demo ? demoData.ledger.slice(0, 2) : [],
  );
  const [recentError, setRecentError] = useState("");
  const [recentLoading, setRecentLoading] = useState(!demo);
  const [selected, setSelected] = useState<LedgerItem | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  useEffect(() => {
    if (demo) {
      setRecent(demoData.ledger.slice(0, 2));
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    setRecentLoading(true);
    setRecentError("");
    agentGet<LedgerPage>(
      "/api/agent/activity?page=1&pageSize=2",
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setRecent(result.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRecentError("近期分润暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecentLoading(false);
      });
    return () => controller.abort();
  }, [demo, revision, demoData]);
  const name = overview?.displayName || "代理账户";
  const level = overview
    ? overview.currentCommissionRatePercent === 49
      ? "二级合伙人"
      : "一级合伙人"
    : "读取中…";
  const balance = hidden ? "••••••" : formatMoney(overview?.balance);
  return (
    <>
      <header className="flex items-center justify-between pb-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 grid-cols-2 gap-1 rounded-md border border-[var(--agent-line)] p-1.5"
          >
            <i className="bg-[var(--agent-text)]" />
            <i className="bg-[var(--agent-muted)]" />
            <i className="col-span-2 bg-[var(--agent-text)]" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            PARTNER
            <span className="ml-2 text-xs font-normal text-[var(--agent-muted)]">
              合伙人
            </span>
          </span>
        </div>
        <Link
          href="/agent/profile/"
          aria-label="打开我的账户"
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[var(--agent-soft)] text-xs font-semibold"
        >
          {overview?.avatarUrl ? (
            <img
              src={overview.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            name.slice(0, 2)
          )}
        </Link>
      </header>
      <div className="flex items-center gap-5 border-b border-[var(--agent-line)]">
        <h1 className="border-b-2 border-[var(--agent-text)] py-3 text-base font-semibold">
          账户总览
        </h1>
        <Link
          href="/agent/ledger/"
          className="py-3 text-sm text-[var(--agent-muted)]"
        >
          资金账单
        </Link>
        <span className="ml-auto text-xs text-[var(--agent-muted)]">CNY</span>
      </div>
      <section aria-label="我的可提现佣金" className="py-7">
        <div className="flex items-center gap-2 text-[13px] text-[var(--agent-muted)]">
          可提现佣金
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            aria-label={hidden ? "显示金额" : "隐藏金额"}
            aria-pressed={hidden}
            className="-my-2 flex h-9 w-9 items-center justify-center rounded-md hover:bg-[var(--agent-soft)]"
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl text-[var(--agent-muted)]">¥</span>
          {loading ? (
            <Skeleton className="h-12 w-52" />
          ) : (
            <strong
              className="financial-number min-w-0 font-mono leading-tight"
              style={{
                fontSize: `clamp(22px, ${Math.min(10.5, 118 / balance.length)}vw, 46px)`,
              }}
            >
              {balance}
            </strong>
          )}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 text-xs text-[var(--agent-muted)]">
          <div>
            <span>今日预计 · UTC</span>
            <strong className="mt-2 block break-all font-mono text-sm font-medium text-[var(--positive)]">
              {displayAmount(overview?.todayEstimatedEarnings, hidden)}
            </strong>
          </div>
          <div>
            <span>历史净收益</span>
            <strong className="mt-2 block break-all font-mono text-sm font-medium text-[var(--agent-text)]">
              {displayAmount(overview?.totalEarned, hidden)}
            </strong>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="exchange-primary"
            onClick={() => setWithdrawOpen(true)}
          >
            <ArrowDownToLine size={17} />
            申请提现
          </button>
          <Link href="/agent/profile/#invite" className="exchange-secondary">
            <Share2 size={16} />
            {overview?.currentCommissionRatePercent === 49
              ? "邀请资格"
              : "分享邀请"}
          </Link>
        </div>
      </section>
      <section
        aria-label="账户快捷入口"
        className="grid grid-cols-3 border-y border-[var(--agent-line)] py-5"
      >
        {[
          { href: "/agent/team/", label: "直属团队", Icon: UsersRound },
          { href: "/agent/progress/", label: "收益分析", Icon: ArrowRight },
          { href: "/agent/withdrawals/", label: "提现记录", Icon: History },
        ].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-16 flex-col items-center justify-center gap-3 text-xs transition-opacity hover:opacity-60"
          >
            <Icon size={22} strokeWidth={1.5} />
            {label}
          </Link>
        ))}
      </section>
      <Link
        href="/agent/profile/"
        className="my-5 flex items-center justify-between rounded-lg border border-[var(--agent-line)] px-4 py-3.5 text-sm"
      >
        <span>
          <strong className="font-medium">{level}</strong>
          <span className="ml-3 font-mono text-xs text-[var(--agent-muted)]">
            自身分润 {overview?.currentCommissionRatePercent ?? "—"}%
          </span>
        </span>
        <ChevronRight size={15} className="text-[var(--agent-muted)]" />
      </Link>
      <section aria-label="最新分润" className="mt-7">
        <div className="flex items-center justify-between border-b border-[var(--agent-line)] pb-3">
          <h2 className="text-lg font-semibold">最新分润</h2>
          <Link
            href="/agent/ledger/"
            className="flex min-h-9 items-center gap-1 text-xs text-[var(--agent-muted)]"
          >
            全部明细
            <ChevronRight size={14} />
          </Link>
        </div>
        {recentError ? (
          <p role="alert" className="py-6 text-sm text-[var(--agent-muted)]">
            {recentError}
            <button onClick={refresh} className="ml-3 underline">
              重试
            </button>
          </p>
        ) : recentLoading ? (
          <Skeleton className="my-4 h-32 w-full" />
        ) : recent.length ? (
          recent.map((item) => (
            <LedgerRow
              key={item.id}
              item={item}
              hidden={hidden}
              onClick={() => setSelected(item)}
            />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-[var(--agent-muted)]">
            暂无分润入账
          </p>
        )}
      </section>
      <div className="mt-4">
        <RefreshStatus
          demo={demo}
          at={updatedAt}
          busy={loading || recentLoading}
          onRefresh={refresh}
        />
      </div>
      {selected && (
        <LedgerDetail
          item={selected}
          hidden={hidden}
          onClose={() => setSelected(null)}
        />
      )}
      {withdrawOpen && (
        <Sheet title="申请提现" onClose={() => setWithdrawOpen(false)}>
          <WithdrawalPanel demo={demo} hidden={hidden} onComplete={refresh} />
        </Sheet>
      )}
    </>
  );
}
