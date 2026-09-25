"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Eye, EyeOff, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { demoLedgerItems } from "@/lib/demo-data";
import type { LedgerItem, LedgerPage } from "@/lib/types";
import { useAgent } from "./agent-context";
import { LedgerDetail, LedgerRow, Sheet, Skeleton } from "./agent-ui";

export function AgentHome() {
  const { demo, overview, loading, hidden, setHidden, notify } = useAgent();
  const [recent, setRecent] = useState<LedgerItem[]>(demo ? demoLedgerItems.slice(0, 2) : []);
  const [recentLoading, setRecentLoading] = useState(!demo);
  const [selected, setSelected] = useState<LedgerItem | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    agentGet<LedgerPage>("/api/agent/ledger?page=1&pageSize=2", controller.signal)
      .then((result) => setRecent(result.items))
      .catch(() => { if (!controller.signal.aborted) notify("近期分润暂时不可用"); })
      .finally(() => { if (!controller.signal.aborted) setRecentLoading(false); });
    return () => controller.abort();
  }, [demo, notify]);

  const name = overview?.displayName || "代理伙伴";
  const level = overview?.currentCommissionRatePercent === 49 ? "Lv.2 认证合伙人" : "Lv.1 认证合伙人";
  return <>
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.13] bg-[#28421F] text-[14px] font-extrabold text-[#9FE870] shadow-[inset_-6px_-6px_0_rgba(159,232,112,.12)]">
          {overview?.avatarUrl ? <img src={overview.avatarUrl} alt={name + "的头像"} className="h-full w-full object-cover" /> : name.slice(0, 2)}
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--agent-bg)] bg-[#9FE870]" />
        </span>
        <span className="min-w-0"><span className="block text-[10px] text-[var(--agent-muted)]">WELCOME BACK</span><span className="mt-1 block truncate text-[17px] font-bold tracking-[-0.04em]">{name}</span></span>
      </div>
      <span className="shrink-0 rounded-full border border-[var(--agent-line)] bg-[var(--agent-surface)] px-3 py-2 text-[10px] font-semibold text-[var(--agent-text)]">{level}</span>
    </header>

    <div className="mb-7 mt-11"><p className="text-[10px] font-bold uppercase tracking-[0.21em] text-[#9FE870]">Your money, clearly</p><h1 className="mt-3 text-[29px] font-extrabold tracking-[-0.06em]">每一份收获，都看得见<span className="text-[#9FE870]">.</span></h1><p className="mt-2 text-[12px] text-[var(--agent-muted)]">分润安心入账，分享从容向前。</p></div>

    <section aria-label="我的可提现佣金" className="relative overflow-hidden rounded-[30px] border border-[var(--agent-line)] bg-gradient-to-br from-[var(--agent-hero-from)] to-[var(--agent-hero-to)] p-6 shadow-[0_18px_45px_-24px_rgba(0,0,0,.45)]">
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/[0.07]" /><span aria-hidden="true" className="pointer-events-none absolute -right-6 top-0 h-40 w-40 rounded-full border border-white/[0.04]" />
      <div className="relative flex items-center justify-between"><span className="text-[12px] font-semibold text-[var(--agent-muted)]">我的可提现佣金</span><span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--agent-line)] bg-white/[0.05] px-2.5 py-1.5 text-[10px] text-[var(--agent-text)]"><span className="h-1.5 w-1.5 rounded-full bg-[#9FE870]" />可用余额</span></div>
      <div className="relative mt-8 flex min-w-0 items-center justify-between gap-1">
        {loading ? <Skeleton className="h-12 w-52" /> : <span className="min-w-0 whitespace-nowrap font-mono text-[clamp(34px,8.8vw,43px)] font-extrabold tracking-[-0.09em] text-[var(--agent-text)]"><span className="mr-1.5 text-[23px] font-semibold text-[var(--agent-muted)]">¥</span>{hidden ? "••••••" : overview?.balance ?? "—"}</span>}
        <button type="button" onClick={() => setHidden(!hidden)} aria-label={hidden ? "显示金额" : "隐藏金额"} aria-pressed={hidden} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--agent-muted)] hover:bg-white/[0.08]">{hidden ? <EyeOff size={18} strokeWidth={1.7} /> : <Eye size={18} strokeWidth={1.7} />}</button>
      </div>
      <div className="relative mt-5 flex items-center gap-2 text-[10px] text-[var(--agent-muted)]"><Wallet size={13} strokeWidth={1.7} />收益已入账，可随时查看来源</div>
      <div className="relative mt-9 grid grid-cols-2 gap-2.5"><button type="button" onClick={() => setWithdrawOpen(true)} className="flex h-12 items-center justify-center gap-1 rounded-full bg-[#9FE870] px-2 text-[12px] font-extrabold text-[#0A1408] transition-transform active:scale-[0.97]">申请提现 <ArrowUpRight size={16} /></button><Link href="/agent/profile/#invite" className="flex h-12 items-center justify-center rounded-full border border-[var(--agent-line)] bg-white/[0.06] px-2 text-[12px] font-bold text-[var(--agent-text)] transition-transform active:scale-[0.97]">快捷分享</Link></div>
    </section>

    <div className="mt-7 flex items-center justify-between rounded-2xl border border-[var(--agent-line)] bg-[var(--agent-surface)] px-4 py-3"><span className="flex items-center gap-2 text-[11px] text-[var(--agent-muted)]"><Sparkles size={15} className="text-[#9FE870]" />今日预计收益</span><span className="font-mono text-[15px] font-bold text-[var(--agent-accent-text)]">{hidden ? "¥••••" : "¥" + (overview?.todayEstimatedEarnings ?? "0.00")}</span></div>

    <section className="mt-11" aria-labelledby="recent-heading"><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[var(--agent-muted)]">Activity</p><h2 id="recent-heading" className="mt-2 text-[19px] font-extrabold tracking-[-0.045em]">最新分润</h2></div><span className="rounded-full border border-[var(--agent-line)] px-2.5 py-1.5 text-[10px] text-[var(--agent-muted)]">最近 2 笔</span></div><div className="space-y-2.5">{recentLoading ? [0, 1].map((index) => <div key={index} className="h-[78px] animate-pulse rounded-3xl bg-[var(--agent-surface)]" />) : recent.length ? recent.map((item) => <LedgerRow key={item.id} item={item} hidden={hidden} onClick={() => setSelected(item)} />) : <p className="rounded-3xl border border-[var(--agent-line)] bg-[var(--agent-surface)] p-6 text-center text-[12px] text-[var(--agent-muted)]">还没有分润记录</p>}</div><Link href="/agent/ledger/" className="mt-5 flex items-center justify-center gap-2 rounded-full border border-[var(--agent-line)] py-3.5 text-[12px] font-bold text-[var(--agent-text)]">查看全部明细 <ArrowRight size={15} /></Link></section>

    <p className="mt-12 flex items-center justify-center gap-1.5 text-[10px] text-[var(--agent-muted)]"><ShieldCheck size={13} />平台统一结算 · 严格二级分润</p>
    {selected && <LedgerDetail item={selected} onClose={() => setSelected(null)} />}
    {withdrawOpen && <Sheet title="申请提现" onClose={() => setWithdrawOpen(false)}><p className="rounded-2xl border border-[var(--agent-line)] bg-[var(--agent-surface)] p-5 text-[13px] leading-6 text-[var(--agent-muted)]">提现申请尚未接入。可用余额与入账流水可以正常查看，正式申请请联系平台管理员。</p><button type="button" onClick={() => setWithdrawOpen(false)} className="mt-5 h-12 w-full rounded-full bg-[#9FE870] text-[12px] font-extrabold text-[#0A1408]">知道了</button></Sheet>}
  </>;
}
