import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isProjectTerminal, useTerminalStore } from '../stores/terminal-store';
import { countNeedingAttention, useAgentStatusStore } from './agent-status-store';

/**
 * A dot on the collapsed sidebar's Agents icon while any of the project's agent windows asks for
 * the user (the expanded sidebar lists the windows instead, AgentsSidebarList.tsx)
 */
export function AgentsAttentionDot({ projectPath }: { projectPath?: string }) {
  const { t } = useTranslation('agentStatus');
  const terminalIds = useTerminalStore(
    useShallow((state) => state.terminals.filter((terminal) => terminal.isCLIMode && isProjectTerminal(terminal, projectPath)).map((terminal) => terminal.id))
  );
  const count = useAgentStatusStore((state) => countNeedingAttention(state.statuses, terminalIds));
  if (count === 0) return null;
  return (
    <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-destructive">
      <span className="sr-only">{t('needAttention', { count })}</span>
    </span>
  );
}
