/**
 * @vitest-environment jsdom
 */
/**
 * The status shown in the app:
 * - an agent window's header names its session's state in herdr's words
 * - the sidebar lists the project's agent windows and their state; selecting one opens it
 * - the collapsed Agents icon names how many of the project's windows ask for the user (a
 *   question, or a turn finished out of use), not working ones, other projects' or closed windows
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../../../shared/i18n';
import { useTerminalStore, type Terminal } from '../../stores/terminal-store';
import { useAgentStatusStore } from '../agent-status-store';
import { AgentStatusBadge } from '../AgentStatusBadge';
import { AgentsAttentionDot } from '../AgentsAttentionDot';
import { AgentsSidebarList } from '../AgentsSidebarList';

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
  it("names the session's state in herdr's words, idle included", () => {
    const { rerender, container } = render(<AgentStatusBadge terminalId="a" />);
    expect(screen.getByText('needs input')).toBeInTheDocument();
    rerender(<AgentStatusBadge terminalId="b" />);
    expect(screen.getByText('finished')).toBeInTheDocument();
    useAgentStatusStore.getState().setStatus('b', 'idle');
    rerender(<AgentStatusBadge terminalId="b" />);
    expect(screen.getByText('idle')).toBeInTheDocument();
    rerender(<AgentStatusBadge terminalId="none" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AgentsSidebarList', () => {
  it("lists the project's agent windows with their state, and selecting one opens it", () => {
    const onSelect = vi.fn();
    render(<AgentsSidebarList projectPath="/repo" onSelect={onSelect} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['a●needs input', 'b●finished', 'c●working']);
    fireEvent.click(rows[1]);
    expect(useTerminalStore.getState().activeTerminalId).toBe('b');
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('AgentsAttentionDot', () => {
  it("names how many of the project's windows ask for the user", () => {
    render(<AgentsAttentionDot projectPath="/repo" />);
    expect(screen.getByText('2 agent windows need attention')).toBeInTheDocument();
  });

  it('shows nothing when no window asks', () => {
    useAgentStatusStore.setState({ statuses: { c: 'working' } });
    const { container } = render(<AgentsAttentionDot projectPath="/repo" />);
    expect(container).toBeEmptyDOMElement();
  });
});
