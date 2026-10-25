/**
 * @vitest-environment jsdom
 */
/**
 * The phone page against a mocked companion API:
 * - the board opens on Human Review and scrolls that column's button into view
 * - the board lists the agent windows that work, ask or finished, and leaves idle ones out
 * - while a PR action runs in the background, the task screen shows it and disables moves,
 *   feedback and the PR buttons; a failed action shows its error
 * - a notification's address opens its task
 * - the notifications panel says why plain HTTP and iPhone Safari outside the home screen can't
 *   receive notifications
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../../shared/i18n';
import type { TaskDetail, TaskSummary } from '../api';

const api = vi.hoisted(() => ({
  projects: vi.fn(),
  tasks: vi.fn(),
  agents: vi.fn(),
  task: vi.fn(),
  logs: vi.fn(),
  action: vi.fn(),
}));
vi.mock('../api', () => ({
  api,
  getToken: () => 'token',
  forgetToken: vi.fn(),
  pair: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

import { CompanionApp } from '../CompanionApp';

const now = '2026-10-25T09:00:00.000Z';
const tasks: TaskSummary[] = [
  { id: '004-merge', title: 'Add CSV export', column: 'human_review', status: 'human_review', prUrl: 'https://github.com/o/r/pull/4', prState: 'open', updatedAt: now },
  { id: '002-run', title: 'Fix Safari export', column: 'in_progress', status: 'in_progress', updatedAt: now },
];
const detail = (phoneAction?: TaskDetail['phoneAction']): TaskDetail => ({
  ...tasks[0],
  description: 'Add a CSV export button.',
  allowedMoves: ['backlog', 'done'],
  subtasks: [],
  ...(phoneAction ? { phoneAction } : {}),
});

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  api.projects.mockResolvedValue([{ id: 'p1', name: 'Workbench' }]);
  api.tasks.mockResolvedValue(tasks);
  api.agents.mockResolvedValue([]);
  api.task.mockResolvedValue(detail());
  api.logs.mockResolvedValue([]);
  window.history.replaceState(null, '', '/');
});

describe('board', () => {
  it('lists the agent windows that work, ask or finished, and leaves idle ones out', async () => {
    api.agents.mockResolvedValue([
      { id: 't1', title: 'Docs window', status: 'needs-input', since: now },
      { id: 't2', title: 'Idle window', status: 'idle', since: now },
    ]);
    render(<CompanionApp />);
    expect(await screen.findByText('Docs window')).toBeInTheDocument();
    expect(screen.getByText('needs input')).toBeInTheDocument();
    expect(screen.queryByText('Idle window')).not.toBeInTheDocument();
  });

  it('opens on Human Review and scrolls its column button into view', async () => {
    render(<CompanionApp />);
    const column = await screen.findByRole('button', { name: /Human Review 1/ });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(column);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center' });
    expect(screen.getByText('Add CSV export')).toBeInTheDocument();
  });
});

describe('task screen', () => {
  async function openTask() {
    render(<CompanionApp />);
    (await screen.findByText('Add CSV export')).click();
  }

  it('disables moves, feedback and the PR buttons while a merge runs in the background', async () => {
    api.task.mockResolvedValue(detail({ action: 'merge_pull_request', state: 'running', startedAt: now }));
    await openTask();

    expect(await screen.findByText('Merging the pull request')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge pull request' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to Done' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('offers the merge again with the error after a background merge fails', async () => {
    api.task.mockResolvedValue(detail({ action: 'merge_pull_request', state: 'failed', error: 'Conflicts remain', startedAt: now }));
    await openTask();

    expect(await screen.findByText('Merging the pull request failed: Conflicts remain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge pull request' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move to Done' })).toBeEnabled();
  });
});

describe('notifications', () => {
  it("opens the task a notification names and leaves the address plain", async () => {
    window.history.replaceState(null, '', '/?project=p1&task=004-merge');
    render(<CompanionApp />);
    expect(await screen.findByText('Add a CSV export button.')).toBeInTheDocument();
    expect(api.task).toHaveBeenCalledWith('p1', '004-merge');
    expect(window.location.search).toBe('');
  });

  it('says that plain HTTP pages get no notifications', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    render(<CompanionApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText(/need the https address from Tailscale/)).toBeInTheDocument();
  });

  it('tells iPhone Safari to add the page to the home screen', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    render(<CompanionApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    userAgent.mockRestore();
  });
});
