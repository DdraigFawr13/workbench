/**
 * What the Claude Code session in an agent window is doing (src/shared/utils/agent-window-status.ts):
 * running a turn, asking the user something, finished while another window was in use, or waiting
 */
export type AgentWindowStatus = 'working' | 'needs-input' | 'finished' | 'idle';

/** What a project window reports about one of its agent windows */
export interface AgentWindowStatusReport {
  title: string;
  projectPath?: string;
  status: AgentWindowStatus;
}

/** An agent window's status as the main process keeps it (for the phone companion) */
export interface AgentWindowStatusEntry extends AgentWindowStatusReport {
  terminalId: string;
  /** When the status last changed (ISO 8601) */
  since: string;
}
