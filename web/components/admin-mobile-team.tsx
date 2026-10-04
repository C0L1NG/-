"use client";
import { AdminNetwork } from "./admin-network";
import { useAdminMobile } from "./admin-mobile-context";
export function AdminMobileTeam() {
  const { demo, revision } = useAdminMobile();
  return (
    <AdminNetwork demo={demo} period="month" mobile refreshKey={revision} />
  );
}
