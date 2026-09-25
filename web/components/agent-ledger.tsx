"use client";

import { ArrowDown, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { demoLedgerItems } from "@/lib/demo-data";
import type { LedgerItem, LedgerPage } from "@/lib/types";
import { useAgent } from "./agent-context";
import { LedgerDetail, LedgerRow, PageHeading, Skeleton, panel } from "./agent-ui";

type Filter = "all" | "own" | "team";
const PAGE_SIZE = 8;
function demoPage(filter: Filter, page: number): LedgerPage {
  const filtered = demoLedgerItems.filter((item) => filter === "all" || item.roleType === (filter === "own" ? "PROMOTER" : "PARENT"));
  return { page, pageSize: PAGE_SIZE, total: filtered.length, totalPages: Math.ceil(filtered.length / PAGE_SIZE), items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

export function AgentLedger() {
  const { demo, overview, hidden, notify } = useAgent();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<LedgerItem[]>(demo ? demoPage("all", 1).items : []);
  const [totalPages, setTotalPages] = useState(demo ? demoPage("all", 1).totalPages : 1);
  const [total, setTotal] = useState(demo ? demoLedgerItems.length : 0);
  const [loading, setLoading] = useState(!demo);
  const [selected, setSelected] = useState<LedgerItem | null>(null);

  useEffect(() => {
    if (demo) {
      const result = demoPage(filter, page);
      setItems((old) => page === 1 ? result.items : [...old, ...result.items]);
      setTotalPages(result.totalPages); setTotal(result.total);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (filter !== "all") params.set("roleType", filter === "own" ? "PROMOTER" : "PARENT");
    agentGet<LedgerPage>("/api/agent/ledger?" + params, controller.signal)
      .then((result) => {
        setItems((old) => page === 1 ? result.items : [...old, ...result.items]);
        setTotalPages(result.totalPages); setTotal(result.total);
      }).catch(() => { if (!controller.signal.aborted) notify("分润明细暂时不可用"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [demo, filter, page, notify]);

  function changeFilter(value: Filter) { setFilter(value); setPage(1); setItems([]); }
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "own", label: `自身出单 ${overview?.currentCommissionRatePercent ?? 49}%` },
    { value: "team", label: "团队奖励 21%" },
  ];

  return <>
    <PageHeading eyebrow="Money in motion / 03" title="分润明细" subtitle="订单利润、分润比例与实际入账，逐笔可查。" />
    <div role="group" aria-label="筛选分润来源" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">{filters.map(({ value, label }) => <button key={value} type="button" onClick={() => changeFilter(value)} aria-pressed={filter === value} className={"h-10 shrink-0 rounded-full px-4 text-[11px] font-bold transition-colors " + (filter === value ? "bg-[#9FE870] text-[#0A1408]" : "border border-[var(--agent-line)] bg-[var(--agent-surface)] text-[var(--agent-muted)]")}>{label}</button>)}</div>
    <div className="mb-5 mt-5 flex items-center justify-between"><span className="text-[11px] text-[var(--agent-muted)]">{total} 笔分润记录</span><span className="flex items-center gap-1.5 text-[10px] text-[var(--agent-muted)]"><CalendarDays size={13} />按结算时间排序</span></div>
    <div className="space-y-2.5">{loading && items.length === 0 ? [0, 1, 2, 3].map((index) => <div key={index} className={panel + " flex h-[78px] items-center gap-3 px-4"}><Skeleton className="h-11 w-11 rounded-full" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-16" /></div>) : items.length ? items.map((item, index) => <div key={item.id}>{(index === 0 || item.settledAt.slice(0, 10) !== items[index - 1].settledAt.slice(0, 10)) && <p className="mb-2 mt-6 px-1 font-mono text-[10px] font-semibold text-[var(--agent-muted)]">{item.settledAt.slice(0, 10)} UTC</p>}<LedgerRow item={item} hidden={hidden} onClick={() => setSelected(item)} /></div>) : <p className={panel + " px-5 py-12 text-center text-[12px] text-[var(--agent-muted)]"}>当前筛选下没有记录。</p>}</div>
    {page < totalPages && <button type="button" disabled={loading} onClick={() => setPage((value) => value + 1)} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[var(--agent-line)] bg-[var(--agent-surface)] text-[12px] font-bold text-[var(--agent-text)] disabled:opacity-50">{loading ? "正在加载…" : "加载更早记录"}<ArrowDown size={15} /></button>}
    <p className="mt-7 text-center text-[10px] text-[var(--agent-muted)]">金额以平台结算流水为准 · 时间以 UTC 显示</p>
    {selected && <LedgerDetail item={selected} onClose={() => setSelected(null)} />}
  </>;
}
