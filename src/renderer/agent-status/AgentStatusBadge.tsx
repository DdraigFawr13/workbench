import { useAgentStatusStore } from './agent-status-store';
import { AgentStatusIndicator } from './AgentStatusIndicator';

/** What an agent window's Claude Code session is doing, beside the window's title */
export function AgentStatusBadge({ terminalId }: { terminalId: string }) {
  const status = useAgentStatusStore((state) => state.statuses[terminalId]);
  if (!status) return null;
  return <AgentStatusIndicator status={status} />;
}
