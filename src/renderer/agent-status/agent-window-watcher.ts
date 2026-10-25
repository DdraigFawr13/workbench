/**
 * Agent window watcher
 * ====================
 *
 * Reads what an agent window's Claude Code session is doing from the window's xterm (its title
 * and screen, see shared/utils/agent-window-status.ts) and keeps it in the agent status store,
 * where the window header and the sidebar show it. Each change is also reported to the main process
 * for the phone companion.
 *
 * A turn that ends while the window isn't the one in use (another window of the grid, another
 * view, another app) stays "finished" until the user selects the window, as in herdr.
 */

import type { Terminal as XTerm } from '@xterm/xterm';
import { nextAgentWindowStatus, observeAgentWindow } from '../../shared/utils/agent-window-status';
import { useTerminalStore } from '../stores/terminal-store';
import { useAgentStatusStore } from './agent-status-store';

/** How long output settles before the screen is read again (ms) */
const READ_DELAY_MS = 250;

/** The rows of the screen (not the scrollback), top to bottom */
function screenLines(xterm: XTerm): string[] {
  const buffer = xterm.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < xterm.rows; row++) {
    lines.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '');
  }
  return lines;
}

/** Whether the window is the selected one, on screen in the focused app window */
function isSeen(terminalId: string, element: HTMLElement): boolean {
  return useTerminalStore.getState().activeTerminalId === terminalId
    && element.isConnected && element.offsetParent !== null && document.visibilityState === 'visible' && document.hasFocus();
}

/** Watch an agent window; returns the function that stops watching */
export function watchAgentWindow(terminalId: string, xterm: XTerm, element: HTMLElement): () => void {
  let title = '';
  /** What the main process was last told (status and window title) */
  let reported = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const update = () => {
    timer = null;
    const terminal = useTerminalStore.getState().terminals.find((t) => t.id === terminalId);
    if (!terminal) return;
    const { statuses, setStatus } = useAgentStatusStore.getState();
    const status = terminal.isCLIMode
      ? nextAgentWindowStatus(statuses[terminalId], observeAgentWindow(title, screenLines(xterm)), isSeen(terminalId, element))
      : undefined;
    setStatus(terminalId, status);
    const report = status ? `${status}\n${terminal.title}` : '';
    if (report === reported) return;
    reported = report;
    window.electronAPI?.reportAgentWindowStatus?.(
      terminalId,
      status ? { title: terminal.title, projectPath: terminal.projectPath, status } : null
    );
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(update, READ_DELAY_MS);
  };

  const subscriptions = [
    xterm.onWriteParsed(schedule),
    xterm.onTitleChange((next) => {
      title = next;
      schedule();
    }),
  ];
  // Seeing the window clears "finished": selecting it, the app gaining focus, or the window being shown
  const stopFollowingSelection = useTerminalStore.subscribe((state, previous) => {
    if (state.activeTerminalId !== previous.activeTerminalId) schedule();
  });
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(schedule);
  observer?.observe(element);

  return () => {
    if (timer) clearTimeout(timer);
    for (const subscription of subscriptions) subscription.dispose();
    stopFollowingSelection();
    window.removeEventListener('focus', schedule);
    document.removeEventListener('visibilitychange', schedule);
    observer?.disconnect();
    if (reported) window.electronAPI?.reportAgentWindowStatus?.(terminalId, null);
  };
}
