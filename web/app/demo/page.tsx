import { AdminDashboard } from "@/components/admin-dashboard";

export const metadata = {
  title: "老板总控后台 · 公开演示",
  description: "使用虚构数据展示全局资金、团队树与分润审计。",
};

export default function DemoPage() {
  return <AdminDashboard demo />;
}
