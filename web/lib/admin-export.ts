import type { AuditItem } from "@/lib/admin-types";
import { filteredDemoAudit, type AuditFilters } from "./admin-filters";

function cell(value: string | number | undefined) {
  const text = String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function fetchAuditExport(
  filters: AuditFilters,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams(
    Object.entries(filters).filter(
      ([, value]) => value != null && value !== "",
    ),
  );
  const response = await fetch("/api/admin/commission-export?" + params, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "登录已过期，请重新登录后导出"
        : response.status === 403
          ? "当前账户没有导出权限"
          : "对账导出失败，请稍后重试",
    );
  if (!response.headers.get("content-type")?.includes("text/csv"))
    throw new Error("导出格式异常，请稍后重试");
  return response.blob();
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `platform-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportAdminAudit(
  demo: boolean,
  filters: AuditFilters = {},
): Promise<number | null> {
  const items: AuditItem[] = [];
  if (demo) items.push(...filteredDemoAudit(filters));
  else {
    download(await fetchAuditExport(filters));
    return null;
  }
  const headings = [
    "订单号",
    "订单时间 UTC",
    "订单总额",
    "利润池 X",
    "平台留存 30%",
    "出单人",
    "出单人比例",
    "出单人入账",
    "直属导师",
    "导师比例",
    "导师入账",
    "结算状态",
  ];
  const rows = items.map((item) =>
    [
      item.orderNo,
      item.createdAt,
      item.totalAmount,
      item.profitAmount,
      item.platform?.amount ?? "",
      item.promoterCommission?.recipientName ?? "",
      item.promoterCommission?.ratePercent ?? "",
      item.promoterCommission?.amount ?? "",
      item.mentorCommission?.recipientName ?? "",
      item.mentorCommission?.ratePercent ?? "",
      item.mentorCommission?.amount ?? "",
      item.settlementStatus,
    ]
      .map(cell)
      .join(","),
  );
  const csv = "\uFEFF" + [headings.map(cell).join(","), ...rows].join("\r\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  return items.length;
}
