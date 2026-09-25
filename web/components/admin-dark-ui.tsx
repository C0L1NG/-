"use client";

import { ChevronRight, ReceiptText } from "lucide-react";
import type { AgentNode, AuditItem } from "@/lib/admin-types";

export const surface = "rounded-[26px] border border-white/[0.08] bg-[#141C13]";
export function cents(value: string): number {
  const [whole = "0", fraction = ""] = value.replace(/,/g, "").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
export function money(value: number): string {
  return (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function findAgent(nodes: AgentNode[], id: string): AgentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findAgent(node.children, id);
    if (child) return child;
  }
  return null;
}
export function teamGmv(node: AgentNode): number {
  return node.children.reduce((sum, child) => sum + cents(child.ownGmv), cents(node.ownGmv));
}
export function teamPlatform(node: AgentNode): number {
  return node.children.reduce((sum, child) => sum + cents(child.platformContribution), cents(node.platformContribution));
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={"inline-block animate-pulse rounded-xl bg-white/[0.07] " + className} />;
}
export function Status({ settled }: { settled: boolean }) {
  return <span className={"inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold " + (settled ? "border-[#9FE870]/20 bg-[#9FE870]/10 text-[#AEEB8D]" : "border-white/[0.08] bg-white/[0.04] text-[#8E9B8A]")}><span className={"h-1.5 w-1.5 rounded-full " + (settled ? "bg-[#9FE870]" : "bg-[#8E9B8A]")} />{settled ? "已结算" : "待处理"}</span>;
}
function Stage({ label, title, amount, accent = false, last = false }: { label: string; title: string; amount: string; accent?: boolean; last?: boolean }) {
  return <div className="relative min-w-0 py-1 pr-3"><p className="truncate text-[9px] font-semibold uppercase tracking-[0.11em] text-[#6F806C]">{label}</p><p className="mt-2 truncate text-[11px] font-medium text-[#ABB9A6]">{title}</p><p className={"mt-2 truncate font-mono text-[15px] font-bold tracking-[-0.05em] " + (accent ? "text-[#9FE870]" : "text-[#F4F5F0]")}>{amount}</p>{!last && <ChevronRight size={14} strokeWidth={1.4} className="absolute -right-2 top-1/2 -translate-y-1/2 text-[#566653]" />}</div>;
}
export function AuditFlowCard({ item }: { item: AuditItem }) {
  const direct = item.promoterCommission, mentor = item.mentorCommission;
  return <article className={surface + " group p-5 transition-[background-color,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#9FE870]/20 hover:bg-[#182217]"}>
    <div className="mb-5 flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[#9FE870]"><ReceiptText size={14} strokeWidth={1.6} /></span><span className="truncate font-mono text-[12px] font-semibold text-[#E7F0E1]">{item.orderNo}</span><span className="hidden text-[10px] text-[#758571] sm:inline">{item.createdAt.slice(0, 16).replace("T", " ")} UTC</span></div><Status settled={item.settlementStatus === "SETTLED"} /></div>
    <div className="grid grid-cols-[1.1fr_.8fr_.8fr_1fr_1fr] gap-5 rounded-[18px] border border-white/[0.04] bg-[#101810] px-5 py-4">
      <Stage label="ORDER / 出单" title={item.promoter.displayName} amount={"¥" + item.totalAmount} />
      <Stage label="PROFIT / X" title="可分配利润" amount={"¥" + item.profitAmount} />
      <Stage label="PLATFORM / 30%" title="平台留存" amount={item.platform ? "+¥" + item.platform.amount : "—"} accent />
      <Stage label={"PROMOTER / " + (direct?.ratePercent ?? "—") + "%"} title={direct?.recipientName ?? "待分润"} amount={direct ? "+¥" + direct.amount : "—"} />
      <Stage label={"MENTOR / " + (mentor?.ratePercent ?? 0) + "%"} title={mentor?.recipientName ?? "无直接上级"} amount={mentor ? "+¥" + mentor.amount : "—"} last />
    </div>
  </article>;
}
