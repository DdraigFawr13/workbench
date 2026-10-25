import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { isProjectTerminal, useTerminalStore } from '../stores/terminal-store';
import { countNeedingAttention, useAgentStatusStore } from './agent-status-store';

/**
 * How many of the project's agent windows ask for the user, on the sidebar's Agents row: a number,
 * or a dot when the sidebar is collapsed. Nothing when none do.
 */
export function AgentsAttentionCount({ projectPath, collapsed }: { projectPath?: string; collapsed: boolean }) {
  const { t } = useTranslation('agentStatus');
  const terminalIds = useTerminalStore(
    useShallow((state) => state.terminals.filter((terminal) => terminal.isCLIMode && isProjectTerminal(terminal, projectPath)).map((terminal) => terminal.id))
  );
  const count = useAgentStatusStore((state) => countNeedingAttention(state.statuses, terminalIds));
  if (count === 0) return null;
  const label = <span className="sr-only">{t('needAttention', { count })}</span>;
  if (collapsed) {
    return (
      <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-warning">
        {label}
      </span>
    );
  }
  return (
    <span className="mr-1.5 rounded-full bg-warning/15 px-1.5 text-xs font-medium tabular-nums text-warning">
      <span aria-hidden="true">{count}</span>
      {label}
    </span>
  );
}
