/**
 * The status of this project window's agent windows (working, needs input, finished), by terminal
 * id, as agent-window-watcher.ts reads it from their screens. Kept apart from the terminal store so
 * the feature stays in its own folder (docs/DECISIONS.md).
 */

import { create } from 'zustand';
import type { AgentWindowStatus } from '../../shared/types';
import { needsAttention } from '../../shared/utils/agent-window-status';

interface AgentStatusState {
  statuses: Record<string, AgentWindowStatus>;
  /** A window's status changed (undefined: it has none, or it closed) */
  setStatus: (terminalId: string, status: AgentWindowStatus | undefined) => void;
}

export const useAgentStatusStore = create<AgentStatusState>((set) => ({
  statuses: {},
  setStatus: (terminalId, status) =>
    set((state) => {
      if (state.statuses[terminalId] === status) return state;
      const statuses = { ...state.statuses };
      if (status) statuses[terminalId] = status;
      else delete statuses[terminalId];
      return { statuses };
    }),
}));

/** How many of the given windows ask for the user (a question, or a turn finished out of use) */
export function countNeedingAttention(statuses: Record<string, AgentWindowStatus>, terminalIds: string[]): number {
  return terminalIds.filter((id) => needsAttention(statuses[id])).length;
}
