"use client";

import { RotateCcw, ShoppingBag, UsersRound, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { LedgerItem } from "@/lib/types";
import { displayAmount } from "@/lib/money";

export const panel =
  "rounded-xl border border-[var(--agent-line)] bg-[var(--agent-surface)]";
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={
        "inline-block animate-pulse rounded-xl bg-[var(--agent-soft)] " +
        className
      }
    />
  );
}
export function PageHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-6 border-b border-[var(--agent-line)] pb-5">
      <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-[var(--agent-muted)]">
        {eyebrow}
      </p>
      <h1 className="text-[26px] font-semibold tracking-tight text-[var(--agent-text)]">
        {title}
      </h1>
      <p className="mt-2 text-[13px] leading-6 text-[var(--agent-muted)]">
        {subtitle}
      </p>
    </header>
  );
}
export function LedgerRow({
  item,
  hidden = false,
  onClick,
}: {
  item: LedgerItem;
  hidden?: boolean;
  onClick?: () => void;
}) {
  const refund = item.entryType === "refund";
  const own = item.roleType === "PROMOTER";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-[var(--agent-line)] py-4 text-left transition-colors hover:bg-[var(--agent-surface-raised)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--agent-line)] bg-[var(--agent-soft)] text-[var(--agent-accent-text)]">
        {refund ? (
          <RotateCcw size={19} strokeWidth={1.7} />
        ) : own ? (
          <ShoppingBag size={19} strokeWidth={1.7} />
        ) : (
          <UsersRound size={19} strokeWidth={1.7} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[var(--agent-text)]">
          {refund ? "退款冲正" : own ? "自己出单" : "团队奖励"}{" "}
          <span className="font-mono text-[11px] font-medium text-[var(--agent-muted)]">
            #{item.orderNo.split("-").at(-1)}
          </span>
        </span>
        <span className="mt-1.5 block text-[12px] leading-5 text-[var(--agent-muted)]">
          {item.ratePercent}% {own ? "自身出单" : "团队奖励"} ·{" "}
          {item.settlementStatus === "REVERSED" ? "已冲正" : "已结算"}
          <span className="block text-[11px]">
            {item.settledAt.slice(11, 16)} UTC
          </span>
        </span>
      </span>
      <span
        className={
          "max-w-[42%] break-all text-right font-mono text-[14px] font-semibold tracking-tight " +
          (refund
            ? "text-[var(--negative)]"
            : item.settlementStatus === "REVERSED"
              ? "text-[var(--agent-muted)]"
              : "text-[var(--positive)]")
        }
      >
        {item.settlementStatus === "REVERSED" && !refund && !hidden
          ? "原 "
          : ""}
        {displayAmount(
          item.commissionAmount,
          hidden,
          item.settlementStatus !== "REVERSED",
        )}
      </span>
    </button>
  );
}
export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ),
      );
      const first = items[0],
        last = items.at(-1);
      if (first && !ref.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (!first) {
        event.preventDefault();
        ref.current.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/65 px-2"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="mb-2 max-h-[90dvh] overflow-y-auto w-full max-w-[430px] rounded-t-2xl sm:rounded-xl border border-[var(--agent-line,rgba(255,255,255,0.08))] bg-[var(--agent-surface-raised,#191919)] p-6 pb-[max(26px,env(safe-area-inset-bottom))] text-[var(--agent-text,#F5F5F5)] "
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-extrabold tracking-[-0.04em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--agent-soft,#242424)] text-[var(--agent-muted,#929292)]"
          >
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function LedgerDetail({
  item,
  onClose,
  hidden = false,
}: {
  item: LedgerItem;
  onClose: () => void;
  hidden?: boolean;
}) {
  return (
    <Sheet title="分润详情" onClose={onClose}>
      <div className={panel + " space-y-4 p-5 text-[13px]"}>
        <div className="flex justify-between gap-3">
          <span className="text-[var(--agent-muted)]">订单编号</span>
          <span className="break-all text-right font-mono">{item.orderNo}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--agent-muted)]">订单利润池</span>
          <span className="font-mono">
            {displayAmount(item.orderProfitAmount, hidden)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--agent-muted)]">分润来源</span>
          <span>
            {item.roleType === "PROMOTER" ? "自己出单" : "团队奖励"} ·{" "}
            {item.ratePercent}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--agent-muted)]">
            {item.entryType === "refund"
              ? "退款扣回"
              : item.settlementStatus === "REVERSED"
                ? "原入账金额（已冲正）"
                : "实际入账"}
          </span>
          <span
            className={
              "font-mono font-bold " +
              (item.settlementStatus === "REVERSED"
                ? "text-[var(--agent-muted)]"
                : "text-[var(--agent-accent-text)]")
            }
          >
            {displayAmount(
              item.commissionAmount,
              hidden,
              item.settlementStatus !== "REVERSED",
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--agent-muted)]">
            {item.entryType === "refund" ? "冲正时间" : "结算时间"}
          </span>
          <span className="font-mono">
            {item.settledAt.slice(0, 16).replace("T", " ")} UTC
          </span>
        </div>
      </div>
    </Sheet>
  );
}
