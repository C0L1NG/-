import { AdminMobileShell } from "@/components/admin-mobile-context";

export default function AdminMobileDemoLayout({ children }: { children: React.ReactNode }) {
  return <AdminMobileShell demo>{children}</AdminMobileShell>;
}
