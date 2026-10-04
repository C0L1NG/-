"use client";

import { ArrowDown, CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { dateIncludes, type DateBounds } from "@/lib/date-range";
import { displayAmount, sumMoney } from "@/lib/money";
import type { AgentActivitySummary } from "@/lib/api-contract.generated";
import { DateFilter } from "./date-filter";
import { RefreshStatus } from "./live-refresh";
import type { LedgerItem, LedgerPage } from "@/lib/types";
import { useAgent } from "./agent-context";
import {
  LedgerDetail,
  LedgerRow,
  PageHeading,
  Skeleton,
  panel,
} from "./agent-ui";

type Filter = "all" | "own" | "team";
const PAGE_SIZE = 8;
function demoPage(
  all: LedgerItem[],
  filter: Filter,
  page: number,
  bounds: DateBounds,
): LedgerPage {
  const filtered = all.filter(
    (item) =>
      dateIncludes(item.settledAt, bounds) &&
      (filter === "all" ||
        item.roleType === (filter === "own" ? "PROMOTER" : "PARENT")),
  );
  return {
    page,
    pageSize: PAGE_SIZE,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / PAGE_SIZE),
    items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

export function AgentLedger() {
  const { demo, hidden, demoData, revision, refresh, updatedAt } = useAgent();
  const [bounds, setBounds] = useState<DateBounds>({});
  const [net, setNet] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [items, setItems] = useState<LedgerItem[]>(
    demo ? demoPage(demoData.ledger, "all", 1, {}).items : [],
  );
  const [totalPages, setTotalPages] = useState(
    demo ? demoPage(demoData.ledger, "all", 1, {}).totalPages : 1,
  );
  const [total, setTotal] = useState(demo ? demoData.ledger.length : 0);
  const [loading, setLoading] = useState(!demo);
  const [selected, setSelected] = useState<LedgerItem | null>(null);

  useEffect(() => {
    if (demo) {
      const result = demoPage(demoData.ledger, filter, page, bounds);
      setNet(
        sumMoney(
          demoData.ledger
            .filter(
              (item) =>
                dateIncludes(item.settledAt, bounds) &&
                (filter === "all" ||
                  item.roleType === (filter === "own" ? "PROMOTER" : "PARENT")),
            )
            .map((item) => item.commissionAmount),
        ),
      );
      setItems((old) =>
        page === 1
          ? result.items
          : Array.from(
              new Map(
                [...old, ...result.items].map((item) => [item.id, item]),
              ).values(),
            ),
      );
      setTotalPages(result.totalPages);
      setTotal(result.total);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (bounds.from) params.set("from", bounds.from);
    if (bounds.to) params.set("to", bounds.to);
    if (filter !== "all")
      params.set("roleType", filter === "own" ? "PROMOTER" : "PARENT");
    const summaryParams = new URLSearchParams(params);
    summaryParams.delete("page");
    summaryParams.delete("pageSize");
    Promise.all([
      agentGet<LedgerPage>("/api/agent/activity?" + params, controller.signal),
      agentGet<AgentActivitySummary>(
        "/api/agent/activity-summary?" + summaryParams,
        controller.signal,
      ),
    ])
      .then(([result, summary]) => {
        if (controller.signal.aborted) return;
        setNet(summary.netEarnings);
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
        setTotalPages(result.totalPages);
        setTotal(result.total);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("分润明细暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, demoData, filter, page, revision, bounds]);

  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [revision, demoData]);

  function changeFilter(value: Filter) {
    if (value === filter) return;
    setFilter(value);
    setPage(1);
    setItems([]);
    setSelected(null);
    setNet(null);
  }
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "全部" },
    {
      value: "own",
      label: "自身出单 49% / 70%",
    },
    { value: "team", label: "团队奖励 21%" },
  ];

  return (
    <>
      <PageHeading
        eyebrow="Money in motion / 03"
        title="分润明细"
        subtitle="订单利润、分润比例与实际入账，逐笔可查。"
      />
      <RefreshStatus
        demo={demo}
        at={demo ? updatedAt : at}
        busy={loading}
        onRefresh={refresh}
      />
      <div className="mt-3 mb-5">
        <DateFilter
          demo={demo}
          onChange={(value) => {
            setBounds(value);
            setPage(1);
            setItems([]);
            setNet(null);
            setSelected(null);
          }}
        />
      </div>
      <div
        className={panel + " mb-5 flex items-center justify-between gap-3 p-4"}
      >
        <span className="text-sm text-[var(--agent-muted)]">
          所选范围净入账
        </span>
        <strong className="font-mono text-lg text-[var(--agent-accent-text)]">
          {loading ? "读取中…" : displayAmount(net, hidden)}
        </strong>
      </div>
      <div
        role="group"
        aria-label="筛选分润来源"
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none]"
      >
        {filters.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => changeFilter(value)}
            aria-pressed={filter === value}
            className={
              "h-10 shrink-0 rounded-full px-4 text-[11px] font-bold transition-colors " +
              (filter === value
                ? "bg-[var(--action-bg)] text-[var(--action-text)]"
                : "border border-[var(--agent-line)] bg-[var(--agent-surface)] text-[var(--agent-muted)]")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-5 mt-5 flex items-center justify-between">
        <span className="text-[11px] text-[var(--agent-muted)]">
          {total} 笔分润记录
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-[var(--agent-muted)]">
          <CalendarDays size={13} />
          按结算时间排序
        </span>
      </div>
      <div className="space-y-2.5">
        {error ? (
          <div
            role="alert"
            className="rounded-xl bg-white/5 p-5 text-sm text-[#929292]"
          >
            {error}
            <button
              className="ml-3 text-[var(--agent-accent-text)]"
              onClick={refresh}
            >
              重试
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          [0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={panel + " flex h-[78px] items-center gap-3 px-4"}
            >
              <Skeleton className="h-11 w-11 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))
        ) : items.length ? (
          items.map((item, index) => (
            <div key={item.id}>
              {(index === 0 ||
                item.settledAt.slice(0, 10) !==
                  items[index - 1].settledAt.slice(0, 10)) && (
                <p className="mb-2 mt-6 px-1 font-mono text-[10px] font-semibold text-[var(--agent-muted)]">
                  {item.settledAt.slice(0, 10)} UTC
                </p>
              )}
              <LedgerRow
                item={item}
                hidden={hidden}
                onClick={() => setSelected(item)}
              />
            </div>
          ))
        ) : (
          <p
            className={
              panel +
              " px-5 py-12 text-center text-[12px] text-[var(--agent-muted)]"
            }
          >
            当前筛选下没有记录。
          </p>
        )}
      </div>
      {page < totalPages && (
        <button
          type="button"
          disabled={loading || Boolean(error)}
          onClick={() => setPage((value) => value + 1)}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[var(--agent-line)] bg-[var(--agent-surface)] text-[12px] font-bold text-[var(--agent-text)] disabled:opacity-50"
        >
          {loading ? "正在加载…" : "加载更早记录"}
          <ArrowDown size={15} />
        </button>
      )}
      <p className="mt-7 text-center text-[10px] text-[var(--agent-muted)]">
        金额以平台结算流水为准 · 时间以 UTC 显示
      </p>
      {selected && (
        <LedgerDetail
          item={selected}
          hidden={hidden}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
