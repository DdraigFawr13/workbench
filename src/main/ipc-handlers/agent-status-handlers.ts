import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import type { AgentWindowStatusReport } from '../../shared/types';
import { setAgentWindowStatus } from '../agent-status/agent-window-status-store';

/** The project windows report their agent windows' status (read from the screens) for the phone companion */
export function registerAgentStatusHandlers(): void {
  ipcMain.on(IPC_CHANNELS.TERMINAL_AGENT_STATUS, (_, terminalId: string, report: AgentWindowStatusReport | null) => {
    if (typeof terminalId === 'string') setAgentWindowStatus(terminalId, report);
  });
}
