"use client";

import Link from "next/link";
import { Money } from "./money";
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
      <h1 className="sr-only">我的账户</h1>
      <header className="partner-header">
        <Link
          href="/agent/profile/"
          aria-label="打开我的账户"
          className="partner-identity"
        >
          <span className="partner-avatar">
            {overview?.avatarUrl ? (
              <img
                src={overview.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              name.slice(0, 1)
            )}
          </span>
          <span>
            <span className="partner-greeting">个人账户</span>
            <strong>{name}</strong>
          </span>
        </Link>
        <Link href="/agent/profile/" className="partner-level">
          {level}
          <ChevronRight size={12} />
        </Link>
      </header>
      <section aria-label="我的可提现佣金" className="partner-balance">
        <div className="partner-balance-label">
          <span>可提现佣金</span>
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            aria-label={hidden ? "显示金额" : "隐藏金额"}
            aria-pressed={hidden}
            className="partner-eye"
          >
            {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
        <div className="partner-amount">
          {loading && !overview ? (
            <Skeleton className="h-12 w-52" />
          ) : (
            <strong
              className="financial-number"
              style={{
                fontSize: `clamp(22px, ${Math.min(10.5, 112 / balance.length)}vw, 46px)`,
              }}
            >
              <Money value={overview?.balance} hidden={hidden} />
            </strong>
          )}
        </div>
        <p className="partner-currency">
          人民币账户 <span>·</span> CNY
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
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
      <section aria-label="收益概览" className="partner-account">
        <Link href="/agent/progress/" className="account-ribbon">
          <span>
            你的佣金账户 <ChevronRight size={20} />
          </span>
          <ArrowRight size={26} strokeWidth={2.5} />
        </Link>
        <div className="partner-account-body">
          <Link href="/agent/progress/" className="account-title">
            <h2>主账户</h2>
            <ChevronRight size={23} />
          </Link>
          <div className="account-currency-row">
            <span className="currency-emblem">¥</span>
            <div>
              <span className="account-caption">历史净收益 · CNY</span>
              <strong>{displayAmount(overview?.totalEarned, hidden)}</strong>
            </div>
          </div>
          <div className="account-estimate">
            <span>今日预计 · UTC</span>
            <strong
              className={
                overview?.todayEstimatedEarnings?.startsWith("-")
                  ? "text-[var(--negative)]"
                  : "text-[var(--positive)]"
              }
            >
              {displayAmount(overview?.todayEstimatedEarnings, hidden)}
            </strong>
          </div>
          <div className="partner-shortcuts">
            {[
              { href: "/agent/team/", label: "直属团队", Icon: UsersRound },
              { href: "/agent/progress/", label: "收益分析", Icon: ArrowRight },
              { href: "/agent/withdrawals/", label: "提现记录", Icon: History },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href}>
                <Icon size={16} strokeWidth={1.7} />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section aria-label="最新分润" className="partner-activity">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-[18px] font-semibold tracking-tight">交易</h2>
          <Link
            href="/agent/ledger/"
            className="activity-all flex min-h-11 items-center gap-1 text-sm text-[var(--agent-accent-text)]"
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
        ) : recentLoading && !recent.length ? (
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
      <div className="mt-5">
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
          <WithdrawalPanel
            demo={demo}
            hidden={hidden}
            refreshKey={revision}
            onComplete={refresh}
          />
        </Sheet>
      )}
    </>
  );
}
