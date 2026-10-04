import { Suspense } from "react";
import { AdminMobileTreasury } from "@/components/admin-mobile-treasury";
export const metadata = { title: "老板资金待办" };
export default function Page() {
  return (
    <Suspense
      fallback={<p className="text-sm text-[#8E9B8A]">正在读取资金待办…</p>}
    >
      <AdminMobileTreasury />
    </Suspense>
  );
}
