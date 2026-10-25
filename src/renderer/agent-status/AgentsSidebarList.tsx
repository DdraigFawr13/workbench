import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isProjectTerminal, useTerminalStore } from '../stores/terminal-store';
import { cn } from '../lib/utils';
import { useAgentStatusStore } from './agent-status-store';
import { AgentStatusIndicator } from './AgentStatusIndicator';

/**
 * herdr's sidebar "agents" list: each agent window of the project with a status, its title and
 * its state. Selecting a row selects that window on the Agents page.
 */
export function AgentsSidebarList({ projectPath, onSelect }: { projectPath?: string; onSelect: () => void }) {
  const { t } = useTranslation('agentStatus');
  const terminals = useTerminalStore((state) => state.terminals);
  const windows = useMemo(
    () => terminals.filter((terminal) => terminal.isCLIMode && isProjectTerminal(terminal, projectPath)),
    [terminals, projectPath]
  );
  const activeTerminalId = useTerminalStore((state) => state.activeTerminalId);
  const statuses = useAgentStatusStore((state) => state.statuses);
  const shown = windows.filter((window) => statuses[window.id]);
  if (shown.length === 0) return null;

  return (
    <section className="px-2 pb-2" aria-label={t('agents')}>
      <h3 className="flex h-8 items-center px-2 font-mono text-xs text-muted-foreground">{t('agents')}</h3>
      <ul className="flex flex-col gap-px">
        {shown.map((window) => (
          <li key={window.id}>
            <button
              type="button"
              onClick={() => {
                useTerminalStore.getState().setActiveTerminal(window.id);
                onSelect();
              }}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-(--nav-item-radius) px-2 text-left font-mono text-xs',
                'hover:bg-nav-hover hover:text-nav-hover-foreground',
                window.id === activeTerminalId ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className="min-w-0 flex-1 truncate">{window.title}</span>
              <AgentStatusIndicator status={statuses[window.id]} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
