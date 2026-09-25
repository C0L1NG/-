"use client";

import { ArrowDown, ChevronDown, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import { demoAuditItems } from "@/lib/admin-demo-data";
import type { AuditItem, AuditPage } from "@/lib/admin-types";
import { Skeleton, Status, surface } from "./admin-dark-ui";
import { useAdminMobile } from "./admin-mobile-context";

const PAGE_SIZE = 6;
export function AdminMobileAudit() {
  const { demo, notify } = useAdminMobile();
  const [items, setItems] = useState<AuditItem[]>(demo ? demoAuditItems.slice(0, PAGE_SIZE) : []);
  const [page, setPage] = useState(1), [total, setTotal] = useState(demo ? demoAuditItems.length : 0);
  const [pages, setPages] = useState(demo ? Math.ceil(demoAuditItems.length / PAGE_SIZE) : 1);
  const [loading, setLoading] = useState(!demo), [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (demo) { setItems(demoAuditItems.slice(0, page * PAGE_SIZE)); return; }
    const controller = new AbortController(); setLoading(true);
    adminGet<AuditPage>(`/api/admin/commission-audit?page=${page}&pageSize=${PAGE_SIZE}`, controller.signal)
      .then((result) => { setItems((old) => page === 1 ? result.items : [...old, ...result.items]); setTotal(result.total); setPages(result.totalPages); })
      .catch(() => { if (!controller.signal.aborted) notify("审计流水暂时不可用"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [demo, page, notify]);
  return <>
    <header className="mb-8"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9FE870]">Audit trail / 03</p><h1 className="mt-3 text-[30px] font-extrabold tracking-[-0.065em]">资金流审计</h1><p className="mt-2 text-[12px] leading-5 text-[#8E9B8A]">每笔订单的利润与三方分账，展开即见。</p></header>
    <div className={surface + " flex items-center justify-between px-4 py-3"}><span className="flex items-center gap-2 text-[11px] text-[#AFC0A7]"><ShieldCheck size={16} className="text-[#9FE870]" />全网订单 · 实时流水</span><span className="rounded-full bg-[#9FE870]/10 px-2.5 py-1 font-mono text-[10px] font-bold text-[#9FE870]">{total} 笔</span></div>
    <div className="mt-5 space-y-3">{loading && items.length === 0 ? [0, 1, 2].map((index) => <div key={index} className={surface + " h-[155px] p-5"}><Skeleton className="h-full w-full" /></div>) : items.length ? items.map((item, index) => <div key={item.id}>{(index === 0 || item.createdAt.slice(0, 10) !== items[index - 1].createdAt.slice(0, 10)) && <p className="mb-2 mt-5 px-1 font-mono text-[10px] text-[#748970]">{item.createdAt.slice(0, 10)} UTC</p>}<AuditCard item={item} open={expanded === item.id} onToggle={() => setExpanded((old) => old === item.id ? null : item.id)} /></div>) : <p className={surface + " px-5 py-12 text-center text-[12px] text-[#8E9B8A]"}>暂无订单流水。</p>}</div>
    {page < pages && <button type="button" disabled={loading} onClick={() => setPage((value) => value + 1)} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-[#141C13] text-[12px] font-bold disabled:opacity-50">{loading ? "正在加载…" : "查看更多订单"}<ArrowDown size={15} /></button>}
    <p className="mt-7 flex items-center justify-center gap-1.5 text-[10px] text-[#71846D]"><Sparkles size={12} className="text-[#9FE870]" />入账金额以实际结算流水为准</p>
  </>;
}
function AuditCard({ item, open, onToggle }: { item: AuditItem; open: boolean; onToggle: () => void }) {
  const direct = item.promoterCommission, mentor = item.mentorCommission;
  return <section className={surface + " overflow-hidden transition-colors hover:bg-[#182217]"}><button type="button" onClick={onToggle} aria-expanded={open} aria-label={(open ? "收起" : "展开") + item.orderNo + "资金分账"} className="w-full p-4 text-left"><div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[#9FE870]"><ReceiptText size={16} strokeWidth={1.6} /></span><span className="min-w-0 flex-1"><span className="block truncate font-mono text-[12px] font-bold">{item.orderNo}</span><span className="mt-1 block text-[10px] text-[#81927B]">{item.promoter.displayName} 出单 · {item.createdAt.slice(11, 16)} UTC</span></span><Status settled={item.settlementStatus === "SETTLED"} /></div><div className="mt-5 flex items-end justify-between"><span><span className="block text-[10px] text-[#8E9B8A]">订单利润池 X</span><span className="mt-1.5 block font-mono text-[23px] font-bold tracking-[-0.065em]">¥{item.profitAmount}</span></span><span className="flex items-center gap-1 text-[10px] font-semibold text-[#9FE870]">{open ? "收起分账" : "查看分账"}<ChevronDown size={15} className={open ? "rotate-180 transition-transform" : "transition-transform"} /></span></div></button>{open && <div className="border-t border-white/[0.06] px-4 pb-5 pt-4"><p className="mb-3 text-[10px] text-[#8E9B8A]">资金流向 · 平台 / 出单人 / 直属导师</p><div className="space-y-2"><SplitRow label="平台留存" detail="固定抽取利润池 30%" amount={item.platform?.amount ?? null} accent /><SplitRow label={direct?.recipientName ?? "出单代理"} detail={`自身出单 ${direct?.ratePercent ?? "—"}%`} amount={direct?.amount ?? null} /><SplitRow label={mentor?.recipientName ?? "无直接导师"} detail={mentor ? "直属上级 21%" : "一级代理独享 70% 奖金池"} amount={mentor?.amount ?? null} /></div><p className="mt-4 text-right text-[10px] text-[#748970]">订单总成交 <span className="font-mono text-[#BECFB5]">¥{item.totalAmount}</span></p></div>}</section>;
}
function SplitRow({ label, detail, amount, accent = false }: { label: string; detail: string; amount: string | null; accent?: boolean }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-[#101810] px-4 py-3"><span className={"h-2 w-2 shrink-0 rounded-full " + (accent ? "bg-[#9FE870]" : "bg-[#61775A]")} /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold">{label}</span><span className="mt-1 block text-[9px] text-[#778A72]">{detail}</span></span><span className={"font-mono text-[13px] font-bold " + (accent ? "text-[#9FE870]" : "text-[#E5EEE0]")}>{amount ? "+¥" + amount : "—"}</span></div>;
}
