import { useTranslation } from 'react-i18next';
import type { AgentWindowStatus } from '../../shared/types';
import { cn } from '../lib/utils';

/**
 * herdr's status indicator: a dot in the state's color and the state in lower-case monospace
 * (herdr colors: working yellow, blocked red, done teal, idle green; src/client/shell.rs)
 */
const DOT_CLASS: Record<AgentWindowStatus, string> = {
  working: 'text-warning animate-pulse',
  'needs-input': 'text-destructive',
  finished: 'text-info',
  idle: 'text-success',
};

export function AgentStatusIndicator({ status, className }: { status: AgentWindowStatus; className?: string }) {
  const { t } = useTranslation('agentStatus');
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-xs text-muted-foreground', className)}
      title={t(`${status}Description`)}
    >
      <span aria-hidden="true" className={cn('text-xs leading-none', DOT_CLASS[status])}>
        {status === 'idle' ? '○' : '●'}
      </span>
      {t(status)}
    </span>
  );
}
