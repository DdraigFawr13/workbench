/**
 * Reading an agent window's status from its title and screen:
 * - a spinner title is working, whatever the screen shows
 * - permission prompts (boxed or not) and forms are questions; a conversation quoting one is not
 * - the status line of a running turn is working
 * - a turn that ends out of view stays finished until the window is seen
 */
import { describe, expect, it } from 'vitest';
import { nextAgentWindowStatus, observeAgentWindow } from '../agent-window-status';

const IDLE_TITLE = '✳ Fix the tests';
const WORKING_TITLE = '⠋ Fix the tests';

const BASH_PROMPT = [
  '● Running the tests.',
  '',
  '────────────────────────────────────────',
  ' Bash command',
  '',
  '   npm test',
  '   Run the tests',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for npm test commands in /repo",
  '   3. No, and tell Claude what to do differently (esc)',
  '',
  ' Esc to cancel · Tab to amend · ctrl+e to explain',
];

const BOXED_EDIT_PROMPT = [
  '╭──────────────────────────────────────╮',
  '│ Edit file                            │',
  '│ src/app.ts                           │',
  '│ Do you want to make this edit to app.ts? │',
  '│ ❯ 1. Yes                             │',
  '│   2. No, and tell Claude what to do differently (esc) │',
  '╰──────────────────────────────────────╯',
];

const QUESTION_FORM = [
  '────────────────────────────────────────',
  ' Which database should the cache use?',
  ' ❯ 1. Redis',
  '   2. SQLite',
  '',
  ' Enter to select · ↑/↓ to navigate · Esc to cancel',
];

const WORKING_SCREEN = [
  '● Reading the files.',
  '',
  '✻ Thinking… (12s · ↑ 1.2k tokens)',
  '',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ⏵⏵ accept edits on (shift+tab to cycle) · esc to interrupt',
];

const IDLE_SCREEN = [
  '● Done. Do you want to keep the old API? Answer below.',
  '  1. Yes, keep it',
  '  2. No, remove it',
  '',
  '────────────────────────────────────────',
  '❯ ',
  '────────────────────────────────────────',
  '  ? for shortcuts',
];

describe('observeAgentWindow', () => {
  it('takes a spinner title as working, whatever the screen shows', () => {
    expect(observeAgentWindow(WORKING_TITLE, IDLE_SCREEN)).toBe('working');
    expect(observeAgentWindow('◐ Fix the tests', BASH_PROMPT)).toBe('working');
  });

  it('sees permission prompts and forms as questions', () => {
    expect(observeAgentWindow(IDLE_TITLE, BASH_PROMPT)).toBe('needs-input');
    expect(observeAgentWindow(IDLE_TITLE, BOXED_EDIT_PROMPT)).toBe('needs-input');
    expect(observeAgentWindow(IDLE_TITLE, QUESTION_FORM)).toBe('needs-input');
  });

  it('does not take a conversation that quotes a question as one', () => {
    expect(observeAgentWindow(IDLE_TITLE, IDLE_SCREEN)).toBe('idle');
  });

  it('reads the status line of a running turn when the title says nothing', () => {
    expect(observeAgentWindow('', WORKING_SCREEN)).toBe('working');
    expect(observeAgentWindow('', ['', '✶ Compacting conversation…', ''])).toBe('working');
    expect(observeAgentWindow('', ['user@host:~/repo$ '])).toBe('idle');
  });
});

describe('nextAgentWindowStatus', () => {
  it('keeps a turn that ended out of view finished until the window is seen', () => {
    expect(nextAgentWindowStatus('working', 'idle', false)).toBe('finished');
    expect(nextAgentWindowStatus('finished', 'idle', false)).toBe('finished');
    expect(nextAgentWindowStatus('finished', 'idle', true)).toBe('idle');
    expect(nextAgentWindowStatus('working', 'idle', true)).toBe('idle');
  });

  it('does not call a window finished that was not working', () => {
    expect(nextAgentWindowStatus(undefined, 'idle', false)).toBe('idle');
    expect(nextAgentWindowStatus('needs-input', 'idle', false)).toBe('idle');
  });

  it('follows what the window shows while it works or asks', () => {
    expect(nextAgentWindowStatus('finished', 'working', false)).toBe('working');
    expect(nextAgentWindowStatus('working', 'needs-input', true)).toBe('needs-input');
  });
});
