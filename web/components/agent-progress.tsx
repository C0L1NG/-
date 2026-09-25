"use client";

import { ArrowUpRight, ChartNoAxesCombined, UsersRound, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { demoLedgerItems, demoTeamMembers } from "@/lib/demo-data";
import type { LedgerItem, LedgerPage, TeamMember, TeamPage } from "@/lib/types";
import { useAgent } from "./agent-context";
import { PageHeading, Skeleton, panel } from "./agent-ui";

function cents(value: string): number { return Math.round(Number(value.replace(/,/g, "")) * 100); }
function yuan(value: number): string { return (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function utcMonth() {
  const now = new Date();
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) };
}

export function AgentProgress() {
  const { demo, overview, loading, hidden, notify } = useAgent();
  const [monthItems, setMonthItems] = useState<LedgerItem[]>(demo ? demoLedgerItems : []);
  const [team, setTeam] = useState<TeamMember[]>(demo ? demoTeamMembers : []);
  const [monthLoading, setMonthLoading] = useState(!demo);
  const [teamLoading, setTeamLoading] = useState(!demo);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    async function loadMonth() {
      const range = utcMonth();
      const results: LedgerItem[] = [];
      let page = 1, totalPages = 1;
      do {
        const params = new URLSearchParams({ page: String(page), pageSize: "100", ...range });
        const result = await agentGet<LedgerPage>("/api/agent/ledger?" + params, controller.signal);
        results.push(...result.items); totalPages = result.totalPages; page++;
      } while (page <= totalPages);
      if (!controller.signal.aborted) setMonthItems(results);
    }
    loadMonth().catch(() => { if (!controller.signal.aborted) notify("本月分润暂时不可用"); })
      .finally(() => { if (!controller.signal.aborted) setMonthLoading(false); });
    agentGet<TeamPage>("/api/agent/team?page=1&pageSize=100", controller.signal)
      .then((result) => setTeam(result.items))
      .catch(() => { if (!controller.signal.aborted) notify("团队贡献暂时不可用"); })
      .finally(() => { if (!controller.signal.aborted) setTeamLoading(false); });
    return () => controller.abort();
  }, [demo, notify]);

  const ownCents = monthItems.filter((item) => item.roleType === "PROMOTER").reduce((sum, item) => sum + cents(item.commissionAmount), 0);
  const teamCents = monthItems.filter((item) => item.roleType === "PARENT").reduce((sum, item) => sum + cents(item.commissionAmount), 0);
  const totalCents = ownCents + teamCents;
  const ownShare = totalCents ? Math.round(ownCents / totalCents * 100) : 0;
  const leaders = [...team].sort((a, b) => cents(b.contributionCommission) - cents(a.contributionCommission)).slice(0, 4);

  return <>
    <PageHeading eyebrow="Your momentum / 02" title="你的进展" subtitle="团队一起前进，每一笔贡献都清楚可见。" />
    <div className="grid grid-cols-2 gap-3">
      <section className={panel + " flex min-h-[190px] flex-col p-5"}><div className="flex items-start justify-between text-[var(--agent-muted)]"><span className="text-[11px] font-medium">直属团队</span><UsersRound size={17} strokeWidth={1.5} /></div><div className="mt-7 flex items-baseline gap-1">{loading ? <Skeleton className="h-9 w-12" /> : <><span className="font-mono text-[36px] font-extrabold leading-none tracking-[-0.075em]">{overview?.directAgentCount ?? "—"}</span><span className="text-[11px] text-[var(--agent-muted)]">人</span></>}</div><div className="mt-auto flex items-center"><div className="flex pl-1">{[0, 1, 2].map((index) => <span key={index} className="-ml-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--agent-surface)] bg-[#294625] text-[9px] font-bold text-[#C6EDA9]"><UsersRound size={11} /></span>)}</div><span className="ml-2 text-[10px] text-[var(--agent-muted)]">直属伙伴</span></div></section>
      <section className={panel + " flex min-h-[190px] flex-col p-5"}><div className="flex items-start justify-between text-[var(--agent-muted)]"><span className="text-[11px] font-medium">本月累计分成</span><ArrowUpRight size={17} strokeWidth={1.5} /></div><div className="mt-8 truncate font-mono text-[clamp(19px,5.3vw,25px)] font-bold tracking-[-0.075em] text-[var(--agent-accent-text)]">{monthLoading ? <Skeleton className="h-7 w-28" /> : hidden ? "¥••••" : "¥" + yuan(totalCents)}</div><span className="mt-auto self-start rounded-full bg-[#9FE870]/10 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--agent-accent-text)]">本月已入账</span></section>
    </div>

    <section className={panel + " mt-5 p-5"}><div className="flex items-center justify-between"><div><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--agent-muted)]">Order mix</span><h2 className="mt-1.5 text-[16px] font-bold">本月出单贡献</h2></div><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[#9FE870]"><ChartNoAxesCombined size={17} strokeWidth={1.6} /></span></div><div className="mt-6 h-2.5 overflow-hidden rounded-full bg-[var(--agent-soft)]"><div className="h-full rounded-full bg-[#9FE870] transition-[width] duration-500" style={{ width: ownShare + "%" }} /></div><div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-[10px] text-[var(--agent-muted)]">自己出单 · 49% / 70%</p><p className="mt-1.5 font-mono text-[15px] font-bold">{hidden ? "¥••••" : "¥" + yuan(ownCents)}</p></div><div><p className="text-[10px] text-[var(--agent-muted)]">直属团队奖励 · 21%</p><p className="mt-1.5 font-mono text-[15px] font-bold text-[var(--agent-accent-text)]">{hidden ? "¥••••" : "¥" + yuan(teamCents)}</p></div></div><p className="mt-5 text-[10px] text-[var(--agent-muted)]">荧光色进度表示本人出单收益占本月总分润 {ownShare}%</p></section>

    <section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[var(--agent-muted)]">Your people</p><h2 className="mt-2 text-[19px] font-extrabold tracking-[-0.04em]">团队贡献</h2></div><span className="text-[10px] text-[var(--agent-muted)]">直属下线</span></div><div className={panel + " overflow-hidden"}>{teamLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div> : leaders.length ? leaders.map((member, index) => <div key={member.id} className={"flex items-center gap-3 px-4 py-3.5 " + (index ? "border-t border-[var(--agent-line)]" : "")}><span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.06] text-[11px] font-bold text-[var(--agent-text)]">{member.avatarUrl ? <img src={member.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : member.displayName.slice(0, 2)}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold">{member.displayName}</span><span className="mt-1 block text-[10px] text-[var(--agent-muted)]">直接发展的伙伴</span></span><span className="text-right"><span className="block font-mono text-[13px] font-bold text-[var(--agent-accent-text)]">+¥{member.contributionCommission}</span><span className="mt-1 block text-[10px] text-[var(--agent-muted)]">贡献佣金</span></span></div>) : <p className="p-6 text-center text-[12px] text-[var(--agent-muted)]">还没有直属伙伴</p>}</div><p className="mt-4 flex items-center gap-1.5 text-[10px] text-[var(--agent-muted)]"><Zap size={12} className="text-[#9FE870]" />只统计直属下线带来的 21% 导师分润</p></section>
  </>;
}
