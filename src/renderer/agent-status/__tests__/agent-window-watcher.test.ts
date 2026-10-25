/**
 * @vitest-environment jsdom
 */
/**
 * The agent window watcher against a real xterm buffer:
 * - a permission prompt on the screen makes the window "needs input", reported to the main process
 * - a turn that ends while the window can't be seen leaves it "finished"
 * - a window not running Claude Code has no status, and stopping the watch clears the report
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Terminal as XTerm } from '@xterm/xterm';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import { useAgentStatusStore } from '../agent-status-store';
import { watchAgentWindow } from '../agent-window-watcher';

const report = vi.fn();

function addWindow(isCLIMode: boolean): void {
  const terminal: Terminal = {
    id: 't1',
    title: 'Fix the tests',
    status: 'running',
    cwd: '/repo',
    createdAt: new Date(),
    isCLIMode,
    projectPath: '/repo',
  };
  useTerminalStore.setState({ terminals: [terminal] });
}

const status = () => useAgentStatusStore.getState().statuses.t1;

/** Write to the xterm and let the watcher read the screen */
async function show(xterm: XTerm, text: string): Promise<void> {
  // xterm parses on its own timers, which are fake here too
  const written = new Promise<void>((resolve) => xterm.write(text, resolve));
  await vi.advanceTimersByTimeAsync(50);
  await written;
  await vi.advanceTimersByTimeAsync(300);
}

let xterm: XTerm;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  report.mockClear();
  useAgentStatusStore.setState({ statuses: {} });
  (window as unknown as { electronAPI: unknown }).electronAPI = { reportAgentWindowStatus: report };
  xterm = new XTerm({ cols: 80, rows: 12, allowProposedApi: true });
});

afterEach(() => {
  stop?.();
  xterm.dispose();
  vi.useRealTimers();
});

describe('watchAgentWindow', () => {
  it('reports a permission prompt, then a finished turn while the window is out of view', async () => {
    addWindow(true);
    stop = watchAgentWindow('t1', xterm, document.createElement('div'));

    await show(xterm, '\x1b]0;⠋ Fix the tests\x07● Running the tests.\r\n');
    expect(status()).toBe('working');

    await show(xterm, '\x1b]0;✳ Fix the tests\x07 Do you want to proceed?\r\n ❯ 1. Yes\r\n   2. No\r\n');
    expect(status()).toBe('needs-input');
    expect(report).toHaveBeenLastCalledWith('t1', { title: 'Fix the tests', projectPath: '/repo', status: 'needs-input' });

    await show(xterm, '\x1b]0;⠋ Fix the tests\x07\x1b[2J\x1b[H● Done.\r\n');
    expect(status()).toBe('working');
    // The element isn't on screen (jsdom has no layout), so the window counts as unseen
    await show(xterm, '\x1b]0;✳ Fix the tests\x07\r\n❯ \r\n');
    expect(status()).toBe('finished');
  });

  it('gives a window not running Claude Code no status, and clears the report when stopped', async () => {
    addWindow(false);
    stop = watchAgentWindow('t1', xterm, document.createElement('div'));
    await show(xterm, '\x1b]0;⠋ build\x07working\r\n');
    expect(status()).toBeUndefined();
    expect(report).not.toHaveBeenCalled();

    useTerminalStore.setState({ terminals: [{ ...useTerminalStore.getState().terminals[0], isCLIMode: true }] });
    await show(xterm, 'more\r\n');
    expect(status()).toBe('working');
    stop();
    expect(report).toHaveBeenLastCalledWith('t1', null);
  });
});
