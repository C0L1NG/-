"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AuditItem } from "@/lib/admin-types";
import { displayAmount } from "@/lib/money";
import { Status } from "./admin-dark-ui";
export function AdminAuditTable({ items }: { items: AuditItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-[#262626]">
      <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
        <caption className="sr-only">
          全网订单利润与平台、出单人、导师的分账记录
        </caption>
        <thead className="border-b border-[#262626] bg-[#151515] text-xs text-[#969696]">
          <tr>
            {[
              "订单 / 时间 UTC",
              "利润池",
              "平台 · 30%",
              "出单代理 · 49% / 70%",
              "直属导师 · 21%",
              "状态",
            ].map((label) => (
              <th key={label} scope="col" className="px-5 py-3.5 font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <AuditRow
              key={item.id}
              item={item}
              open={open === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
function AuditRow({
  item,
  open,
  onToggle,
}: {
  item: AuditItem;
  open: boolean;
  onToggle: () => void;
}) {
  const reversed = item.settlementStatus === "REVERSED";
  const amount = (value?: string) =>
    (reversed && value ? "原 " : "") + displayAmount(value);
  return (
    <>
      <tr className="border-b border-[#222] bg-[#0F0F0F] transition-colors hover:bg-[#1A1A1A]">
        <td className="px-5 py-4">
          <button
            type="button"
            aria-expanded={open}
            aria-label={(open ? "收起" : "展开") + item.orderNo + "订单信息"}
            onClick={onToggle}
            className="flex items-center gap-3 text-left"
          >
            <span>
              <span className="block font-mono text-xs">{item.orderNo}</span>
              <span className="mt-1 block text-xs text-[#828282]">
                {item.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            </span>
            <ChevronDown size={14} className={open ? "rotate-180" : ""} />
          </button>
        </td>
        <td className="whitespace-nowrap px-5 py-4 font-mono">
          {displayAmount(item.profitAmount)}
        </td>
        <td
          className={
            "whitespace-nowrap px-5 py-4 font-mono " +
            (reversed ? "text-[#929292]" : "text-[var(--positive)]")
          }
        >
          {amount(item.platform?.amount)}
        </td>
        <td className="px-5 py-4">
          <span className="block whitespace-nowrap font-mono">
            {amount(item.promoterCommission?.amount)}
          </span>
          <span className="mt-1 block text-xs text-[#929292]">
            {item.promoterCommission?.recipientName ?? "待分润"} ·{" "}
            {item.promoterCommission?.ratePercent ?? "—"}%
          </span>
        </td>
        <td className="px-5 py-4">
          <span className="block whitespace-nowrap font-mono">
            {amount(item.mentorCommission?.amount)}
          </span>
          <span className="mt-1 block text-xs text-[#929292]">
            {item.mentorCommission?.recipientName ?? "无直接上级"}
          </span>
        </td>
        <td className="px-5 py-4">
          <Status status={item.settlementStatus} />
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#262626] bg-[#171717]">
          <td colSpan={6} className="px-5 py-4 text-sm text-[#A3A3A3]">
            订单成交额{" "}
            <span className="mr-6 font-mono text-white">
              {displayAmount(item.totalAmount)}
            </span>
            出单人{" "}
            <span className="mr-6 text-white">{item.promoter.displayName}</span>
            {reversed
              ? "已退款：以上为原始分账，净收益已扣回。"
              : "按订单锁定的直属关系分配；上上级不参与分润。"}
          </td>
        </tr>
      )}
    </>
  );
}
