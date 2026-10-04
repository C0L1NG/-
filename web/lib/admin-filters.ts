import { demoAuditItems } from "./admin-demo-data";
import { dateBounds, dateIncludes, type DateBounds } from "./date-range";
export type AuditFilters = DateBounds & {
  period?: "all" | "month";
  q?: string;
};
export function filteredDemoAudit(filters: AuditFilters = {}) {
  const bounds =
    filters.from || filters.to
      ? filters
      : dateBounds(
          filters.period === "month" ? "month" : "all",
          new Date("2026-10-03T12:00:00Z"),
        );
  const query = filters.q?.trim().toLowerCase();
  return demoAuditItems.filter(
    (item) =>
      dateIncludes(item.createdAt, bounds) &&
      (!query ||
        item.orderNo.toLowerCase().includes(query) ||
        item.promoter.displayName.toLowerCase().includes(query)),
  );
}
