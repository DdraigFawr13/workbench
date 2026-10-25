/**
 * The phone page's calls to the companion server (src/main/companion/companion-api.ts). The
 * device token from pairing is kept in this browser's storage and sent as a bearer token.
 */

const TOKEN_KEY = 'workbench.companion.token';

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: nothing was kept
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) throw new UnauthorizedError(data.error || 'Unauthorized');
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export async function pair(code: string, deviceName: string): Promise<void> {
  const { token } = await request<{ token: string }>('POST', '/api/pair', { code, deviceName });
  localStorage.setItem(TOKEN_KEY, token);
}

export interface CompanionProject {
  id: string;
  name: string;
}

/** A task as list_tasks summarizes it (src/main/insights/task-tools.ts) */
export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  column: string;
  reviewReason?: string;
  prUrl?: string;
  prState?: string;
  baseBranch?: string;
  updatedAt: string;
}

/** A task as get_task details it */
export interface TaskDetail extends TaskSummary {
  description: string;
  allowedMoves: string[];
  subtasks: { title: string; status: string }[];
  run?: {
    triage?: { model: string; effort: string; needsPlan: boolean; scope?: string };
    plan?: string;
    steps: { name: string; model?: string; costUsd?: number; error?: string }[];
    totalCostUsd?: number;
    validation?: {
      status: 'passed' | 'failed' | 'partial';
      summary: string;
      checks: { name: string; passed: boolean; details?: string }[];
      findings: { severity: string; description: string; fixed: boolean }[];
    };
    summary?: string;
  };
  worktree?: { branch: string; baseBranch: string; commits: number; filesChanged: number; additions: number; deletions: number };
  /** A PR action started from the phone that runs in the background (companion-api.ts) */
  phoneAction?: { action: string; state: 'running' | 'failed'; error?: string; startedAt: string };
}

export interface LogEntry {
  at: string;
  step: string;
  type: string;
  tool?: string;
  content: string;
}

/** An agent window of the project and what its Claude Code session is doing */
export interface AgentWindowSummary {
  id: string;
  title: string;
  status: 'working' | 'needs-input' | 'finished' | 'idle';
  /** When the status last changed (ISO 8601) */
  since: string;
}

const projectPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export const api = {
  projects: () => request<CompanionProject[]>('GET', '/api/projects'),
  tasks: (projectId: string) => request<TaskSummary[]>('GET', `${projectPath(projectId)}/tasks`),
  agents: (projectId: string) => request<AgentWindowSummary[]>('GET', `${projectPath(projectId)}/agents`),
  task: (projectId: string, taskId: string) => request<TaskDetail>('GET', `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}`),
  logs: (projectId: string, taskId: string, limit = 30) =>
    request<LogEntry[]>('GET', `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/logs?limit=${limit}`),
  action: <T = unknown>(projectId: string, action: string, args: Record<string, unknown>) =>
    request<T>('POST', `${projectPath(projectId)}/actions/${action}`, args),
};
