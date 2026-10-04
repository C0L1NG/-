import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "老板总控后台 · 公开演示",
  description: "使用虚构数据展示二级分销平台的资金、代理拓扑与分润审计。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
