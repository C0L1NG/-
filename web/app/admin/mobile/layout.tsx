import { AdminMobileShell } from "@/components/admin-mobile-context";

export default function AdminMobileLayout({ children }: { children: React.ReactNode }) {
  return <AdminMobileShell>{children}</AdminMobileShell>;
}
