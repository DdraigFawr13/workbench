import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { useAgentStatusStore } from './agent-status-store';

/** What an agent window's Claude Code session is doing, beside the window's title (idle shows nothing) */
export function AgentStatusBadge({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation('agentStatus');
  const status = useAgentStatusStore((state) => state.statuses[terminalId]);
  if (!status || status === 'idle') return null;
  return (
    <Badge
      variant={status === 'needs-input' ? 'warning' : status === 'finished' ? 'info' : 'muted'}
      className="shrink-0 whitespace-nowrap font-medium"
      title={t(`${status}Description`)}
    >
      {t(status)}
    </Badge>
  );
}
