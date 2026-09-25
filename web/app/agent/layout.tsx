import { AgentShell } from "@/components/agent-context";
import "./agent-theme.css";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return <AgentShell>{children}</AgentShell>;
}
