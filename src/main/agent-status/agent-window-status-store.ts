/**
 * Agent window status store
 * =========================
 *
 * The status each agent window's Claude Code session has (working, needs input, finished), as the
 * project windows read it from their agent windows' screens (src/renderer/lib/agent-window-watcher.ts)
 * and report it. The main process keeps it for the phone companion, which has no screen to read.
 */

import type { AgentWindowStatus, AgentWindowStatusEntry, AgentWindowStatusReport } from '../../shared/types';

/** By terminal id */
const entries = new Map<string, AgentWindowStatusEntry>();

/** Called when a window's status changes (`previous` is undefined for a window not seen before) */
type StatusListener = (entry: AgentWindowStatusEntry, previous: AgentWindowStatus | undefined) => void;
const listeners = new Set<StatusListener>();

/** Listen for status changes (the phone companion's notifications); returns a function that stops it */
export function onAgentWindowStatusChange(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A window reported its status (null: it has none now, or it closed) */
export function setAgentWindowStatus(
  terminalId: string,
  entry: AgentWindowStatusReport | null,
  now: Date = new Date()
): void {
  if (!entry) {
    entries.delete(terminalId);
    return;
  }
  const previous = entries.get(terminalId);
  const since = previous && previous.status === entry.status ? previous.since : now.toISOString();
  const next: AgentWindowStatusEntry = { terminalId, title: entry.title, projectPath: entry.projectPath, status: entry.status, since };
  entries.set(terminalId, next);
  if (previous?.status === entry.status) return;
  for (const listener of listeners) {
    try {
      listener(next, previous?.status);
    } catch {
      // A failing listener never affects the report or other listeners
    }
  }
}

/** The agent windows of a project that have a status, those asking for the user first */
export function getAgentWindowStatuses(projectPath: string, samePath: (a: string, b: string) => boolean): AgentWindowStatusEntry[] {
  const rank = { 'needs-input': 0, finished: 1, working: 2, idle: 3 } as const;
  return [...entries.values()]
    .filter((entry) => entry.projectPath && samePath(entry.projectPath, projectPath))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title));
}

/** Forget every window (tests) */
export function resetAgentWindowStatusesForTests(): void {
  entries.clear();
  listeners.clear();
}
