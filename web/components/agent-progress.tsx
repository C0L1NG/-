"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { agentGet } from "@/lib/api";
import { displayAmount, moneyCents, sumMoney } from "@/lib/money";
import type { AgentProgress as ProgressData } from "@/lib/api-contract.generated";
import { useAgent } from "./agent-context";
import { PageHeading, Skeleton, panel } from "./agent-ui";
import { RefreshStatus } from "./live-refresh";
import { TeamMemberRow } from "./agent-team";

export function AgentProgress() {
  const { demo, overview, hidden, revision, refresh, demoData, updatedAt } =
    useAgent();
  const [summary, setSummary] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    agentGet<ProgressData>("/api/agent/progress", controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setSummary(result);
          setAt(new Date().toISOString());
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("本月分润与团队贡献暂时不可用");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, revision]);
  const monthItems = demoData.ledger.filter((item) =>
    item.settledAt.startsWith("2026-10"),
  );
  const own = demo
    ? sumMoney(
        monthItems
          .filter((item) => item.roleType === "PROMOTER")
          .map((item) => item.commissionAmount),
      )
    : summary?.ownEarnings;
  const team = demo
    ? sumMoney(
        monthItems
          .filter((item) => item.roleType === "PARENT")
          .map((item) => item.commissionAmount),
      )
    : summary?.teamEarnings;
  const total = demo
    ? sumMoney(monthItems.map((item) => item.commissionAmount))
    : summary?.monthEarned;
  const leaders = demo
    ? [...demoData.team]
        .sort((a, b) => {
          const diff =
            moneyCents(b.contributionCommission)! -
            moneyCents(a.contributionCommission)!;
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        })
        .slice(0, 4)
    : (summary?.leaders ?? []);
  const ownCents = moneyCents(own),
    teamCents = moneyCents(team),
    totalCents = moneyCents(total);
  const showShare =
    ownCents !== null &&
    teamCents !== null &&
    totalCents !== null &&
    ownCents >= 0n &&
    teamCents >= 0n &&
    totalCents > 0n;
  const share = showShare
    ? Number((ownCents * 100n + totalCents / 2n) / totalCents)
    : 0;
  return (
    <>
      <PageHeading
        eyebrow="Your momentum / 02"
        title="你的进展"
        subtitle="本月收益与团队累计贡献，清楚看见每一步。"
      />
      <RefreshStatus
        demo={demo}
        at={demo ? updatedAt : at}
        busy={loading}
        onRefresh={refresh}
      />
      {error ? (
        <div role="alert" className={panel + " p-5 text-sm"}>
          {error}
          <button
            className="ml-3 text-[var(--agent-accent-text)]"
            onClick={refresh}
          >
            重试
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              href="/agent/team/"
              className={
                panel +
                " flex min-h-44 flex-col p-4 transition-colors hover:bg-[var(--agent-surface-raised)]"
              }
            >
              <div className="flex items-center justify-between text-[var(--agent-muted)]">
                <span className="text-[13px]">直属团队</span>
                <UsersRound size={17} />
              </div>
              <strong className="mt-6 text-4xl font-bold tracking-tight">
                {overview?.directAgentCount ?? "—"}
                <span className="ml-1 text-sm font-normal text-[var(--agent-muted)]">
                  人
                </span>
              </strong>
              <span className="mt-auto flex items-center gap-1 text-xs text-[var(--agent-accent-text)]">
                查看全部伙伴
                <ArrowRight size={13} />
              </span>
            </Link>
            <section className={panel + " flex min-h-44 flex-col p-4"}>
              <div className="flex items-center justify-between text-[var(--agent-muted)]">
                <span className="text-[13px]">本月累计分成</span>
                <ArrowUpRight size={17} />
              </div>
              <strong className="mt-6 break-all font-mono text-[23px] tracking-tight text-[var(--agent-accent-text)]">
                {loading ? (
                  <Skeleton className="h-7 w-24" />
                ) : (
                  displayAmount(total, hidden)
                )}
              </strong>
              <span className="mt-auto self-start rounded-full bg-[var(--action-bg)]/10 px-2.5 py-1 text-xs text-[var(--agent-accent-text)]">
                {demo ? "2026-10" : summary?.month} · 净入账
              </span>
            </section>
          </div>
          <section className={panel + " mt-5 p-5"}>
            <h2 className="text-base font-bold">本月收益来源</h2>
            {showShare && (
              <div
                aria-label={`本人出单占比 ${share}%`}
                className="mt-5 h-2.5 overflow-hidden rounded-full bg-[var(--agent-soft)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--action-bg)]"
                  style={{ width: share + "%" }}
                />
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs leading-5 text-[var(--agent-muted)]">
                  自身出单 · {overview?.currentCommissionRatePercent ?? "—"}%
                </p>
                <p className="mt-2 font-mono text-base font-bold">
                  {displayAmount(own, hidden)}
                </p>
              </div>
              <div>
                <p className="text-xs leading-5 text-[var(--agent-muted)]">
                  团队奖励 · 21%
                </p>
                <p className="mt-2 font-mono text-base font-bold text-[var(--agent-accent-text)]">
                  {displayAmount(team, hidden)}
                </p>
              </div>
            </div>
            <p className="mt-5 text-xs leading-5 text-[var(--agent-muted)]">
              {showShare
                ? `本人出单占本月净分润 ${share}% · UTC`
                : "收益包含退款扣回，负收益时不显示比例。"}
            </p>
          </section>
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">团队贡献前四名</h2>
              <Link
                href="/agent/team/"
                className="flex min-h-11 items-center gap-1 text-xs text-[var(--agent-accent-text)]"
              >
                查看全部
                <ArrowRight size={13} />
              </Link>
            </div>
            <p className="mb-3 text-xs text-[var(--agent-muted)]">
              累计净贡献 · 直属成员带来的 21% 导师奖励
            </p>
            <div className={panel + " overflow-hidden"}>
              {loading ? (
                <div className="p-5">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : leaders.length ? (
                leaders.map((member) => (
                  <TeamMemberRow
                    key={member.id}
                    member={member}
                    hidden={hidden}
                  />
                ))
              ) : (
                <p className="p-6 text-sm leading-6 text-[var(--agent-muted)]">
                  {overview?.currentCommissionRatePercent === 49
                    ? "二级伙伴专注自身出单，不发展下一层代理。"
                    : "还没有直属伙伴，分享邀请开启你的团队。"}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
