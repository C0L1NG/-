import { adminGet } from "@/lib/admin-api";
import { demoAuditItems } from "@/lib/admin-demo-data";
import type { AuditItem, AuditPage } from "@/lib/admin-types";

function cell(value: string | number | undefined) {
  const text = String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function exportAdminAudit(demo: boolean): Promise<number> {
  const items: AuditItem[] = [];
  if (demo) items.push(...demoAuditItems);
  else {
    let page = 1, totalPages = 1;
    do {
      const result = await adminGet<AuditPage>(`/api/admin/commission-audit?page=${page}&pageSize=100&period=all`);
      items.push(...result.items); totalPages = result.totalPages; page++;
    } while (page <= totalPages);
  }
  const headings = ["订单号", "订单时间 UTC", "订单总额", "利润池 X", "平台留存 30%", "出单人", "出单人比例", "出单人入账", "直属导师", "导师比例", "导师入账", "结算状态"];
  const rows = items.map((item) => [item.orderNo, item.createdAt, item.totalAmount, item.profitAmount,
    item.platform?.amount ?? "", item.promoterCommission?.recipientName ?? "",
    item.promoterCommission?.ratePercent ?? "", item.promoterCommission?.amount ?? "",
    item.mentorCommission?.recipientName ?? "", item.mentorCommission?.ratePercent ?? "",
    item.mentorCommission?.amount ?? "", item.settlementStatus].map(cell).join(","));
  const csv = "\uFEFF" + [headings.map(cell).join(","), ...rows].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `platform-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return items.length;
}
