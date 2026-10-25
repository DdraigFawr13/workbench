/**
 * @vitest-environment jsdom
 */
/**
 * The status shown in the app:
 * - an agent window's header names what its session does, and shows nothing while it waits
 * - the Agents row counts the project's agent windows that ask for the user (a question, or a
 *   turn finished out of use), not working ones, other projects' or closed windows
 */
import { beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import '../../../shared/i18n';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import { useAgentStatusStore } from '../agent-status-store';
import { AgentStatusBadge } from '../AgentStatusBadge';
import { AgentsAttentionCount } from '../AgentsAttentionCount';

const agentWindow = (id: string, projectPath: string): Terminal => ({
  id,
  title: id,
  status: 'running',
  cwd: projectPath,
  createdAt: new Date(),
  isCLIMode: true,
  projectPath,
});

beforeEach(() => {
  useTerminalStore.setState({ terminals: [agentWindow('a', '/repo'), agentWindow('b', '/repo'), agentWindow('c', '/repo'), agentWindow('d', '/other')] });
  useAgentStatusStore.setState({
    statuses: { a: 'needs-input', b: 'finished', c: 'working', d: 'needs-input', closed: 'needs-input' },
  });
});

describe('AgentStatusBadge', () => {
  it('names what the session does, and shows nothing while it waits', () => {
    const { rerender, container } = render(<AgentStatusBadge terminalId="a" />);
    expect(screen.getByText('Needs input')).toBeInTheDocument();
    rerender(<AgentStatusBadge terminalId="b" />);
    expect(screen.getByText('Finished')).toBeInTheDocument();
    useAgentStatusStore.getState().setStatus('b', 'idle');
    rerender(<AgentStatusBadge terminalId="b" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AgentsAttentionCount', () => {
  it("counts the project's windows that ask for the user", () => {
    render(<AgentsAttentionCount projectPath="/repo" collapsed={false} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('2 agent windows need attention')).toBeInTheDocument();
  });

  it('shows nothing when no window asks', () => {
    useAgentStatusStore.setState({ statuses: { c: 'working' } });
    const { container } = render(<AgentsAttentionCount projectPath="/repo" collapsed />);
    expect(container).toBeEmptyDOMElement();
  });
});
