import { AdminDashboard } from "@/components/admin-dashboard";

export default function Page() {
  return (
    <>
      <AdminDashboard demo />
      <a
        href="/agent/"
        className="fixed bottom-5 right-5 z-30 rounded-lg border border-white/15 bg-[#1A1A1A]/95 px-4 py-2.5 text-[12px] font-semibold text-[#F5F5F5] backdrop-blur-md transition-colors hover:bg-[#262626]"
      >
        查看代理商端 ↗
      </a>
    </>
  );
}
