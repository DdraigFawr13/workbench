/**
 * Claude exit detection in an agent window:
 * - the shell's echo of the launch line ("user@host:~/repo$ claude ...") is not taken as Claude
 *   exiting, so a new agent window keeps Claude mode (and its status badge)
 * - a shell prompt after Claude Code has run still ends Claude mode
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cli-integration-handler', () => ({}));
vi.mock('../../ipc-handlers/utils', () => ({ safeSendToRenderer: vi.fn() }));

import { CLAUDE_EXIT_GRACE_MS, handleTerminalData, type EventHandlerCallbacks } from '../terminal-event-handler';
import type { TerminalProcess } from '../types';

const callbacks = (): EventHandlerCallbacks => ({
  onRateLimit: vi.fn(),
  onOAuthToken: vi.fn(),
  onOnboardingComplete: vi.fn(),
  onClaudeBusyChange: vi.fn(),
  onClaudeExit: vi.fn(),
});

const LAUNCH_ECHO = "user@host:~/repo$ claude --session-id 1234; printf '\\033]777;workbench-cli-exit\\007'\r\n";
const PROMPT = 'user@host:~/repo$ ';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleTerminalData', () => {
  it('does not take the echoed launch line as Claude exiting', () => {
    const terminal = { id: 'echo', isCLIMode: true } as TerminalProcess;
    const cb = callbacks();
    handleTerminalData(terminal, LAUNCH_ECHO, cb);
    handleTerminalData(terminal, PROMPT, cb);
    expect(cb.onClaudeExit).not.toHaveBeenCalled();
  });

  it('takes a shell prompt after Claude Code ran as Claude exiting', () => {
    const terminal = { id: 'exit', isCLIMode: true } as TerminalProcess;
    const cb = callbacks();
    handleTerminalData(terminal, LAUNCH_ECHO, cb);
    vi.advanceTimersByTime(CLAUDE_EXIT_GRACE_MS);
    handleTerminalData(terminal, `Goodbye!\r\n${PROMPT}`, cb);
    expect(cb.onClaudeExit).toHaveBeenCalledWith(terminal);
  });

  it('gives each new Claude mode its own grace period', () => {
    const terminal = { id: 'again', isCLIMode: true } as TerminalProcess;
    const cb = callbacks();
    handleTerminalData(terminal, LAUNCH_ECHO, cb);
    vi.advanceTimersByTime(CLAUDE_EXIT_GRACE_MS);
    terminal.isCLIMode = false;
    handleTerminalData(terminal, PROMPT, cb);
    terminal.isCLIMode = true;
    handleTerminalData(terminal, LAUNCH_ECHO, cb);
    expect(cb.onClaudeExit).not.toHaveBeenCalled();
  });
});
