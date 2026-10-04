"use client";

import type { AuditItem } from "@/lib/admin-types";

export const surface = "rounded-xl border border-white/[0.08] bg-[#121212]";
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={
        "inline-block animate-pulse rounded-xl bg-white/[0.07] " + className
      }
    />
  );
}
export function Status({ status }: { status: AuditItem["settlementStatus"] }) {
  const settled = status === "SETTLED";
  const labels = {
    PENDING: "待结算",
    PROCESSING: "结算中",
    SETTLED: "已结算",
    REVERSED: "已冲正",
  };
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold " +
        (settled
          ? "border-[var(--positive)]/20 bg-[var(--positive)]/10 text-[#36C990]"
          : "border-white/[0.08] bg-white/[0.04] text-[#929292]")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (settled ? "bg-[var(--positive)]" : "bg-[#929292]")
        }
      />
      {labels[status]}
    </span>
  );
}
