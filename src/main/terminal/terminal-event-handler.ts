/**
 * Terminal Event Handler
 * Manages terminal data output events and processing
 */

import * as OutputParser from './output-parser';
import * as ClaudeIntegration from './cli-integration-handler';
import type { TerminalProcess, WindowGetter } from './types';
import { IPC_CHANNELS } from '../../shared/constants';
import { safeSendToRenderer } from '../ipc-handlers/utils';

/**
 * Event handler callbacks
 */
export interface EventHandlerCallbacks {
  onRateLimit: (terminal: TerminalProcess, data: string) => void;
  onOAuthToken: (terminal: TerminalProcess, data: string) => void;
  onOnboardingComplete: (terminal: TerminalProcess, data: string) => void;
  onClaudeBusyChange: (terminal: TerminalProcess, isBusy: boolean) => void;
  onClaudeExit: (terminal: TerminalProcess) => void;
}

// Track the last known busy state per terminal to avoid duplicate events
const lastBusyState = new Map<string, boolean>();

/**
 * How long after a window enters Claude mode a shell prompt is not taken as Claude exiting. The
 * shell echoes the typed launch line, which starts with its prompt ("user@host:~/repo$ claude ..."),
 * and that echo arrives right after the window enters Claude mode, before Claude Code starts.
 */
export const CLAUDE_EXIT_GRACE_MS = 3000;

// When each terminal's output was first seen in its current Claude mode
const claudeModeSince = new Map<string, number>();

/**
 * Handle terminal data output
 */
export function handleTerminalData(
  terminal: TerminalProcess,
  data: string,
  callbacks: EventHandlerCallbacks
): void {
  // Check for rate limit messages
  if (terminal.isCLIMode) {
    callbacks.onRateLimit(terminal, data);
  }

  // Check for OAuth token
  callbacks.onOAuthToken(terminal, data);

  // Check for onboarding complete (after login, Claude shows ready state)
  callbacks.onOnboardingComplete(terminal, data);

  if (!terminal.isCLIMode) claudeModeSince.delete(terminal.id);
  else if (!claudeModeSince.has(terminal.id)) claudeModeSince.set(terminal.id, Date.now());

  // Detect Claude busy state changes (only when in Claude mode)
  if (terminal.isCLIMode) {
    const busyState = OutputParser.detectClaudeBusyState(data);
    if (busyState !== null) {
      const isBusy = busyState === 'busy';
      const lastState = lastBusyState.get(terminal.id);

      // Only emit if state actually changed
      if (lastState !== isBusy) {
        lastBusyState.set(terminal.id, isBusy);
        callbacks.onClaudeBusyChange(terminal, isBusy);
      }
    }

    // Detect Claude exit (returned to shell prompt)
    // Only check if not busy - busy output takes precedence - and not while the launch line echoes
    const pastLaunch = Date.now() - (claudeModeSince.get(terminal.id) ?? 0) >= CLAUDE_EXIT_GRACE_MS;
    if (pastLaunch && busyState !== 'busy' && OutputParser.detectClaudeExit(data)) {
      callbacks.onClaudeExit(terminal);
      // Clear busy state tracking since Claude has exited
      lastBusyState.delete(terminal.id);
      claudeModeSince.delete(terminal.id);
    }
  }
}

/**
 * Create event handler callbacks from TerminalManager context
 */
export function createEventCallbacks(
  getWindow: WindowGetter,
  lastNotifiedRateLimitReset: Map<string, string>,
  switchProfileCallback: (terminalId: string, profileId: string) => Promise<void>
): EventHandlerCallbacks {
  return {
    onRateLimit: (terminal, data) => {
      ClaudeIntegration.handleRateLimit(
        terminal,
        data,
        lastNotifiedRateLimitReset,
        getWindow,
        switchProfileCallback
      );
    },
    onOAuthToken: (terminal, data) => {
      ClaudeIntegration.handleOAuthToken(terminal, data, getWindow);
    },
    onOnboardingComplete: (terminal, data) => {
      ClaudeIntegration.handleOnboardingComplete(terminal, data, getWindow);
    },
    onClaudeBusyChange: (terminal, isBusy) => {
      safeSendToRenderer(getWindow, IPC_CHANNELS.TERMINAL_CLAUDE_BUSY, terminal.id, isBusy);
    },
    onClaudeExit: (terminal) => {
      ClaudeIntegration.handleClaudeExit(terminal, getWindow);
    }
  };
}
