"use client";

import {
  ArrowDown,
  ChevronDown,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Download,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { adminGet } from "@/lib/admin-api";
import { demoAuditItems } from "@/lib/admin-demo-data";
import { filteredDemoAudit } from "@/lib/admin-filters";
import type { DateBounds } from "@/lib/date-range";
import { exportAdminAudit } from "@/lib/admin-export";
import { displayAmount } from "@/lib/money";
import { DateFilter } from "./date-filter";
import { RefreshStatus } from "./live-refresh";
import type { AuditItem, AuditPage } from "@/lib/admin-types";
import { Skeleton, Status, surface } from "./admin-dark-ui";
import { useAdminMobile } from "./admin-mobile-context";

const PAGE_SIZE = 6;
export function AdminMobileAudit() {
  const { demo, revision, refresh, notify } = useAdminMobile();
  const [bounds, setBounds] = useState<DateBounds>({});
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [at, setAt] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AuditItem[]>(
    demo ? demoAuditItems.slice(0, PAGE_SIZE) : [],
  );
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(demo ? demoAuditItems.length : 0);
  const [pages, setPages] = useState(
    demo ? Math.ceil(demoAuditItems.length / PAGE_SIZE) : 1,
  );
  const [loading, setLoading] = useState(!demo),
    [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
      setExpanded(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [revision]);
  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportAdminAudit(demo, { ...bounds, q: search });
      notify(count === null ? "对账文件已下载" : `已导出 ${count} 笔演示订单`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    if (demo) {
      const all = filteredDemoAudit({ ...bounds, q: search });
      setItems(all.slice(0, page * PAGE_SIZE));
      setTotal(all.length);
      setPages(Math.ceil(all.length / PAGE_SIZE));
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    adminGet<AuditPage>(
      `/api/admin/commission-audit?${new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), q: search, ...bounds })}`,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setAt(new Date().toISOString());
        setItems((old) =>
          page === 1
            ? result.items
            : Array.from(
                new Map(
                  [...old, ...result.items].map((item) => [item.id, item]),
                ).values(),
              ),
        );
        setTotal(result.total);
        setPages(result.totalPages);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("审计流水暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, page, revision, bounds, search]);
  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--positive)]">
          Audit trail / 03
        </p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight">
          资金流审计
        </h1>
        <p className="mt-2 text-[12px] leading-5 text-[#929292]">
          每笔订单的利润与三方分账，展开即见。
        </p>
      </header>
      <RefreshStatus demo={demo} at={at} busy={loading} onRefresh={refresh} />
      <div className="mt-3 mb-4">
        <DateFilter
          demo={demo}
          onChange={(value) => {
            setBounds(value);
            setPage(1);
            setItems([]);
            setExpanded(null);
          }}
        />
      </div>
      <label className="mb-4 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#121212] px-4">
        <Search size={16} className="text-[#929292]" />
        <input
          aria-label="搜索审计订单或出单人"
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="订单号或出单人"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <div className={surface + " flex items-center justify-between px-4 py-3"}>
        <span className="flex items-center gap-2 text-xs text-[#B1B1B1]">
          <ShieldCheck size={16} className="text-[var(--positive)]" />
          全网订单 · 已结算与冲正
        </span>
        <span className="rounded-full bg-[var(--action-bg)]/10 px-2.5 py-1 font-mono text-xs font-bold text-[var(--positive)]">
          {total} 笔
        </span>
      </div>
      <button
        type="button"
        disabled={exporting || loading || query.trim() !== search}
        onClick={download}
        className="mt-3 flex min-h-11 items-center gap-2 rounded-full px-2 text-sm text-[var(--positive)] disabled:opacity-40"
      >
        <Download size={15} />
        {exporting ? "正在导出…" : "导出当前筛选"}
      </button>
      <div className="mt-5 space-y-3">
        {error ? (
          <div
            role="alert"
            className="rounded-xl bg-white/5 p-5 text-sm text-[#929292]"
          >
            {error}
            <button className="ml-3 text-[var(--positive)]" onClick={refresh}>
              重试
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          [0, 1, 2].map((index) => (
            <div key={index} className={surface + " h-[155px] p-5"}>
              <Skeleton className="h-full w-full" />
            </div>
          ))
        ) : items.length ? (
          items.map((item, index) => (
            <div key={item.id}>
              {(index === 0 ||
                item.createdAt.slice(0, 10) !==
                  items[index - 1].createdAt.slice(0, 10)) && (
                <p className="mb-2 mt-5 px-1 font-mono text-xs text-[#898989]">
                  {item.createdAt.slice(0, 10)} UTC
                </p>
              )}
              <AuditCard
                item={item}
                open={expanded === item.id}
                onToggle={() =>
                  setExpanded((old) => (old === item.id ? null : item.id))
                }
              />
            </div>
          ))
        ) : (
          <p
            className={
              surface + " px-5 py-12 text-center text-[12px] text-[#929292]"
            }
          >
            暂无订单流水。
          </p>
        )}
      </div>
      {page < pages && (
        <button
          type="button"
          disabled={loading || Boolean(error)}
          onClick={() => setPage((value) => value + 1)}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-[#121212] text-[12px] font-bold disabled:opacity-50"
        >
          {loading ? "正在加载…" : "查看更多订单"}
          <ArrowDown size={15} />
        </button>
      )}
      <p className="mt-7 flex items-center justify-center gap-1.5 text-xs text-[#898989]">
        <Sparkles size={12} className="text-[var(--positive)]" />
        入账金额以实际结算流水为准
      </p>
    </>
  );
}
function AuditCard({
  item,
  open,
  onToggle,
}: {
  item: AuditItem;
  open: boolean;
  onToggle: () => void;
}) {
  const direct = item.promoterCommission,
    mentor = item.mentorCommission;
  const reversed = item.settlementStatus === "REVERSED";
  return (
    <section
      className={
        surface + " overflow-hidden transition-colors hover:bg-[#191919]"
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={(open ? "收起" : "展开") + item.orderNo + "资金分账"}
        className="w-full p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[var(--positive)]">
            <ReceiptText size={16} strokeWidth={1.6} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[12px] font-bold">
              {item.orderNo}
            </span>
            <span className="mt-1 block text-[12px] text-[#A5A5A5]">
              {item.promoter.displayName} 出单 · {item.createdAt.slice(11, 16)}{" "}
              UTC
            </span>
          </span>
          <Status status={item.settlementStatus} />
        </div>
        <div className="mt-5 flex items-end justify-between">
          <span>
            <span className="block text-xs text-[#929292]">订单利润池 X</span>
            <span className="mt-1.5 block font-mono text-[23px] font-bold tracking-[-0.065em]">
              {displayAmount(item.profitAmount)}
            </span>
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold text-[var(--positive)]">
            {open ? "收起分账" : "查看分账"}
            <ChevronDown
              size={15}
              className={
                open
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-4 pb-5 pt-4">
          <p className="mb-3 text-[12px] text-[#929292]">
            资金流向 · 平台 / 出单人 / 直属导师
          </p>
          <div className="space-y-2">
            <SplitRow
              label="平台留存"
              detail="固定抽取利润池 30%"
              amount={item.platform?.amount ?? null}
              accent={!reversed}
              reversed={reversed}
            />
            <SplitRow
              label={direct?.recipientName ?? "出单代理"}
              detail={`自身出单 ${direct?.ratePercent ?? "—"}%`}
              amount={direct?.amount ?? null}
              reversed={reversed}
            />
            <SplitRow
              label={mentor?.recipientName ?? "无直接导师"}
              detail={mentor ? "直属上级 21%" : "一级代理独享 70% 奖金池"}
              amount={mentor?.amount ?? null}
              reversed={reversed}
            />
          </div>
          <p className="mt-4 text-right text-xs text-[#898989]">
            订单总成交{" "}
            <span className="font-mono text-[#C4C4C4]">
              {displayAmount(item.totalAmount)}
            </span>
          </p>
          {reversed && (
            <p className="mt-3 text-sm leading-6 text-[#929292]">
              本单已退款，展示原始分账；净收益已扣回。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function SplitRow({
  label,
  detail,
  amount,
  accent = false,
  reversed = false,
}: {
  label: string;
  detail: string;
  amount: string | null;
  accent?: boolean;
  reversed?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-[#0D0D0D] px-4 py-3">
      <span
        className={
          "h-2 w-2 shrink-0 rounded-full " +
          (accent ? "bg-[var(--action-bg)]" : "bg-[#777777]")
        }
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">{label}</span>
        <span className="mt-1 block text-[12px] text-[#929292]">{detail}</span>
      </span>
      <span
        className={
          "font-mono text-[13px] font-bold " +
          (accent ? "text-[var(--positive)]" : "text-[#EEEEEE]")
        }
      >
        {amount
          ? (reversed ? "原 " : "") + displayAmount(amount, false, !reversed)
          : "—"}
      </span>
    </div>
  );
}
