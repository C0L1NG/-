"use client";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import type { TeamMember, TeamPage } from "@/lib/types";
import { displayAmount } from "@/lib/money";
import { useAgent } from "./agent-context";
import { PageHeading, Sheet, Skeleton, panel } from "./agent-ui";
import { RefreshStatus } from "./live-refresh";

export function TeamMemberRow({
  member,
  hidden,
  onClick,
}: {
  member: TeamMember;
  hidden: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--agent-soft)] text-sm font-bold">
        {member.avatarUrl ? (
          <img
            src={member.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          member.displayName.slice(0, 2)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{member.displayName}</strong>
        <span className="mt-1 block text-xs text-[var(--agent-muted)]">
          {member.joinedAt.slice(0, 10)} 加入
        </span>
      </span>
      <span className="text-right">
        <strong className="block font-mono text-sm text-[var(--agent-accent-text)]">
          {displayAmount(member.contributionCommission, hidden)}
        </strong>
        <span className="mt-1 block text-xs text-[var(--agent-muted)]">
          累计贡献
        </span>
      </span>
    </>
  );
  const classes =
    "flex w-full items-center gap-3 border-b border-[var(--agent-line)] px-4 py-4 text-left last:border-b-0";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={
        classes + " transition-colors hover:bg-[var(--agent-surface-raised)]"
      }
    >
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}

export function AgentTeam() {
  const { demo, demoData, overview, hidden, revision, refresh, updatedAt } =
    useAgent();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TeamPage | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [at, setAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<TeamMember | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
      setSelected(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setSelected(null);
    if (demo) {
      const all = demoData.team.filter(
        (member) => !search || member.displayName.includes(search),
      );
      setData({
        items: all.slice((page - 1) * 8, page * 8),
        page,
        pageSize: 8,
        total: all.length,
        totalPages: Math.ceil(all.length / 8),
      });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    agentGet<TeamPage>(
      "/api/agent/team?" +
        new URLSearchParams({ page: String(page), pageSize: "8", q: search }),
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("团队暂时无法读取，请重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, demoData, page, search, revision]);
  return (
    <>
      <Link
        href="/agent/progress/"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--agent-muted)]"
      >
        <ArrowLeft size={16} />
        返回进展
      </Link>
      <PageHeading
        eyebrow="Your people"
        title="我的直属团队"
        subtitle="查看全部伙伴，以及他们带来的累计净佣金。"
      />
      <RefreshStatus
        demo={demo}
        at={demo ? updatedAt : at}
        busy={loading}
        onRefresh={refresh}
      />
      <label className={panel + " my-4 flex items-center gap-2 px-4"}>
        <Search size={17} className="text-[var(--agent-muted)]" />
        <input
          aria-label="搜索直属伙伴"
          placeholder="搜索昵称"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={80}
          className="min-h-12 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <p className="mb-3 text-xs text-[var(--agent-muted)]">
        {data?.total ?? overview?.directAgentCount ?? 0} 位伙伴 ·
        只展示本人直属成员
      </p>
      <div className={panel + " overflow-hidden"}>
        {error ? (
          <p role="alert" className="p-5 text-sm">
            {error}
            <button
              className="ml-2 text-[var(--agent-accent-text)]"
              onClick={refresh}
            >
              重试
            </button>
          </p>
        ) : loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : data?.items.length ? (
          data.items.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              hidden={hidden}
              onClick={() => setSelected(member)}
            />
          ))
        ) : (
          <p className="p-6 text-sm leading-6 text-[var(--agent-muted)]">
            {overview?.currentCommissionRatePercent === 49
              ? "二级伙伴不能继续招募代理，直属团队为零。"
              : search
                ? "没有匹配的伙伴，请换个关键词。"
                : "还没有直属伙伴。"}
          </p>
        )}
      </div>
      {(data?.totalPages ?? 0) > 1 && (
        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
            className="min-h-11 rounded-full px-4 disabled:opacity-30"
          >
            上一页
          </button>
          <span className="font-mono text-xs">
            {page}/{data?.totalPages}
          </span>
          <button
            disabled={loading || page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((value) => value + 1)}
            className="min-h-11 rounded-full px-4 disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
      {selected && (
        <Sheet
          title={selected.displayName + " · 伙伴详情"}
          onClose={() => setSelected(null)}
        >
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--agent-muted)]">加入时间</dt>
              <dd>{selected.joinedAt.slice(0, 10)} UTC</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--agent-muted)]">伙伴累计净收益</dt>
              <dd className="font-mono">
                {displayAmount(selected.totalEarned, hidden)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--agent-muted)]">为我贡献的佣金</dt>
              <dd className="font-mono text-[var(--agent-accent-text)]">
                {displayAmount(selected.contributionCommission, hidden)}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-6 text-[var(--agent-muted)]">
            奖励比例为订单利润的 21%，收益已扣除退款冲正。
          </p>
        </Sheet>
      )}
    </>
  );
}
