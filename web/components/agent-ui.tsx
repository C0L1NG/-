"use client";

import { ShoppingBag, UsersRound, X } from "lucide-react";
import type { LedgerItem } from "@/lib/types";

export const panel = "rounded-3xl border border-[var(--agent-line)] bg-[var(--agent-surface)]";
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={"inline-block animate-pulse rounded-xl bg-[var(--agent-soft)] " + className} />;
}
export function PageHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <header className="mb-8"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9FE870]">{eyebrow}</p><h1 className="mt-3 text-[32px] font-extrabold tracking-[-0.065em] text-[var(--agent-text)]">{title}</h1><p className="mt-2 text-[12px] leading-5 text-[var(--agent-muted)]">{subtitle}</p></header>;
}
export function LedgerRow({ item, hidden = false, onClick }: { item: LedgerItem; hidden?: boolean; onClick?: () => void }) {
  const own = item.roleType === "PROMOTER";
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-3xl border border-[var(--agent-line)] bg-[var(--agent-surface)] px-4 py-4 text-left transition-[background-color,transform] hover:bg-[var(--agent-surface-raised)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-[#9FE870]">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[#A6DB89]">{own ? <ShoppingBag size={19} strokeWidth={1.7} /> : <UsersRound size={19} strokeWidth={1.7} />}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-[var(--agent-text)]">{own ? "自己出单" : "团队奖励"} <span className="font-mono text-[10px] font-medium text-[var(--agent-muted)]">#{item.orderNo.split("-").at(-1)}</span></span><span className="mt-1.5 block truncate text-[10px] text-[var(--agent-muted)]">{item.ratePercent}% {own ? "自身出单" : "下级出单奖励"} · {item.settledAt.slice(0, 16).replace("T", " ")} UTC</span></span>
    <span className="shrink-0 font-mono text-[14px] font-bold tracking-[-0.055em] text-[var(--agent-accent-text)]">{hidden ? "+¥••••" : "+¥" + item.commissionAmount}</span>
  </button>;
}
export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/65 px-2" onClick={onClose}><div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="mb-2 w-full max-w-[430px] rounded-[30px] border border-[var(--agent-line)] bg-[var(--agent-surface-raised)] p-6 pb-[max(26px,env(safe-area-inset-bottom))] text-[var(--agent-text)] shadow-[0_20px_80px_rgba(0,0,0,.35)]"><div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-extrabold tracking-[-0.04em]">{title}</h2><button type="button" onClick={onClose} aria-label="关闭" className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--agent-soft)] text-[var(--agent-muted)]"><X size={17} /></button></div>{children}</div></div>;
}
export function LedgerDetail({ item, onClose }: { item: LedgerItem; onClose: () => void }) {
  return <Sheet title="分润详情" onClose={onClose}><div className={panel + " space-y-4 p-5 text-[12px]"}><div className="flex justify-between gap-3"><span className="text-[var(--agent-muted)]">订单编号</span><span className="break-all text-right font-mono">{item.orderNo}</span></div><div className="flex justify-between"><span className="text-[var(--agent-muted)]">可分配利润 X</span><span className="font-mono">¥{item.orderProfitAmount}</span></div><div className="flex justify-between"><span className="text-[var(--agent-muted)]">分润来源</span><span>{item.roleType === "PROMOTER" ? "自己出单" : "团队奖励"} · {item.ratePercent}%</span></div><div className="flex justify-between"><span className="text-[var(--agent-muted)]">实际入账</span><span className="font-mono font-bold text-[var(--agent-accent-text)]">+¥{item.commissionAmount}</span></div><div className="flex justify-between"><span className="text-[var(--agent-muted)]">结算时间</span><span className="font-mono">{item.settledAt.slice(0, 16).replace("T", " ")} UTC</span></div></div></Sheet>;
}
