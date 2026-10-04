"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAdminMobile } from "./admin-mobile-context";
import { AdminTreasury } from "./admin-treasury";
import type { TreasuryFocus } from "./admin-operations";
export function AdminMobileTreasury() {
  const { demo, refresh } = useAdminMobile();
  const params = useSearchParams();
  const tab = params.get("tab"),
    status = params.get("status"),
    eventStatus = params.get("eventStatus");
  const focus = useMemo<TreasuryFocus>(
    () => ({
      tab: tab === "account" || tab === "events" ? tab : "review",
      status:
        status === "pending" || status === "processing" ? status : undefined,
      eventStatus:
        eventStatus === "pending" || eventStatus === "failed"
          ? eventStatus
          : undefined,
    }),
    [tab, status, eventStatus],
  );
  return (
    <>
      <Link
        href="/admin/mobile/"
        className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-[#929292]"
      >
        <ArrowLeft size={16} />
        返回大盘
      </Link>
      <AdminTreasury demo={demo} focus={focus} onComplete={refresh} />
    </>
  );
}
