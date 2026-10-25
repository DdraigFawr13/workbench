/**
 * Agent window status
 * ===================
 *
 * What the Claude Code session in an agent window is doing, read from the window itself: its title
 * (Claude Code sets it through OSC 0/2) and the text on its screen. Hooks can't tell this per
 * window: Claude Code runs its sessions in one daemon shared by the machine, so the window id a
 * hook reports is unreliable (see live-agent/live-agent-relay.ts).
 *
 * The patterns are a subset of herdr's Claude Code screen manifest
 * (https://github.com/herdrdev/herdr, src/detect/manifests/claude.toml, version 2026.10.11.1,
 * Apache License 2.0), in herdr's order: a working title first, then a question on screen, then
 * a working status line.
 */

import type { AgentWindowStatus } from '../types/agent-status';

/** What one look at the window shows */
export type ObservedAgentState = 'working' | 'needs-input' | 'idle';

/** Claude Code's busy spinner at the start of the title: braille (2.1.227 and older) or half circles */
const TITLE_WORKING = /^[\u2800-\u28FF\u25D0-\u25D3] /;

/** The status line of a running turn: "⏵⏵ ... esc to interrupt" or "✻ Thinking… (12s · ...)" */
const STATUS_LINE_WORKING = [
  /^\s*[⏸⏵].*esc to interrupt(?:\s|·|$)/,
  /^\s*[*·✢✳✶✻✽]\s+\S.*…(?:\s+\(\d+[smh](?:\s|·)|\s*$)/,
];

/** A numbered option of a permission prompt ("❯ 1. Yes", "3. No, and tell Claude...") */
const YES_NO_OPTION = /^\s*❯?\s*[123]\.\s*(?:yes|no)\b/i;

/** The "❯" cursor on a numbered option: a dialog is open, not a conversation quoting one */
const OPTION_CURSOR = /^\s*❯\s*\d+\.\s/;

/** How many non-empty lines at the bottom of the screen the status line is looked for in */
const STATUS_LINE_REGION = 12;

/** A line without the side borders of a box (older Claude Code versions draw dialogs in one) */
const withoutBoxBorder = (line: string) => line.replace(/^\s*[│┃]\s?/, '').replace(/\s*[│┃]\s*$/, '');

const isHorizontalRule = (line: string) => /^\s*─{3,}/.test(line);

/** The lines below the last horizontal rule (Claude Code draws its dialogs and prompt box between rules) */
function afterLastRule(lines: string[]): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isHorizontalRule(lines[i])) return lines.slice(i + 1);
  }
  return lines;
}

/** Whether the screen shows Claude Code asking the user something: a permission prompt or a form */
export function isQuestionOnScreen(lines: string[]): boolean {
  const screen = lines.join('\n').toLowerCase();
  // Permission prompts: "Do you want to proceed?" (Bash) or "Do you want to make this edit...?"
  if (screen.includes('do you want to') && lines.some((line) => YES_NO_OPTION.test(line)) && lines.some((line) => OPTION_CURSOR.test(line))) {
    return true;
  }
  if (screen.includes('waiting for permission')) return true;
  // Forms and pickers (AskUserQuestion, plan approval): a footer naming Enter and Esc
  const footer = afterLastRule(lines).join('\n').toLowerCase();
  if (!footer.includes('esc to cancel')) return false;
  return footer.includes('enter to confirm')
    || (footer.includes('enter to select') && /(?:arrow keys|arrows|↑\/↓|↑↓) to navigate/.test(footer));
}

/** Whether the bottom of the screen shows the status line of a running turn */
export function isStatusLineWorking(lines: string[]): boolean {
  const bottom = lines.filter((line) => line.trim() !== '').slice(-STATUS_LINE_REGION);
  return bottom.some((line) => STATUS_LINE_WORKING.some((pattern) => pattern.test(line)));
}

/**
 * What the window shows now: `title` is its last title, `lines` the rows of its screen (top to
 * bottom, without trailing spaces)
 */
export function observeAgentWindow(title: string, screen: string[]): ObservedAgentState {
  if (TITLE_WORKING.test(title)) return 'working';
  const lines = screen.map(withoutBoxBorder);
  if (isQuestionOnScreen(lines)) return 'needs-input';
  if (isStatusLineWorking(lines)) return 'working';
  return 'idle';
}

/**
 * The window's status after a look: a turn that ends while the window isn't in use stays
 * "finished" until the user selects it. `seen`: the window is the selected one, on screen in the
 * focused app window.
 */
export function nextAgentWindowStatus(
  previous: AgentWindowStatus | undefined,
  observed: ObservedAgentState,
  seen: boolean
): AgentWindowStatus {
  if (observed !== 'idle') return observed;
  if (seen) return 'idle';
  return previous === 'working' || previous === 'finished' ? 'finished' : 'idle';
}

/** Statuses that ask for the user: shown as a count on the sidebar */
export function needsAttention(status: AgentWindowStatus | undefined): boolean {
  return status === 'needs-input' || status === 'finished';
}
