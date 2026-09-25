import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "老板总控 · Admin Dashboard",
  description: "二级分销平台全局资金、团队关系与分润审计",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
