import { AgentShell } from "@/components/agent-context";
import "./agent-theme.css";

export default function AgentDemoLayout({ children }: { children: React.ReactNode }) {
  return <AgentShell demo>{children}</AgentShell>;
}
