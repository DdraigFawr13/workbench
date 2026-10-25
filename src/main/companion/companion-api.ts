/**
 * Companion API
 * =============
 *
 * The JSON routes the phone page calls (after the server checked its device token). Reading and
 * changing tasks goes through the Claude chat's task tools (`insights/task-tools.ts`), so the
 * phone follows the same IPC handlers and board rules as the desktop board.
 *
 *   GET  /api/session                                  the paired device
 *   GET  /api/projects                                 open projects
 *   GET  /api/projects/:projectId/tasks                the board (archived tasks left out)
 *   GET  /api/projects/:projectId/tasks/:taskId        a task's details
 *   GET  /api/projects/:projectId/tasks/:taskId/logs   its latest log entries (?limit=)
 *   POST /api/projects/:projectId/actions/:action      run an action (body: its arguments)
 */

import type { CompanionDevice } from '../../shared/types/companion';
import { runTaskTool } from '../insights/task-tools';
import { projectStore } from '../project-store';

/**
 * Task tools the phone may run. delete_task is left out: it can't be undone, so it stays a
 * desktop action.
 */
export const COMPANION_ACTIONS = [
  'create_task',
  'update_task',
  'start_task',
  'stop_task',
  'move_task',
  'retry_task',
  'request_changes',
  'create_pull_request',
  'merge_pull_request',
  'archive_tasks',
  'unarchive_tasks',
] as const;

export interface CompanionApiRequest {
  method: string;
  /** Path without the query string */
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  device: CompanionDevice;
}

export interface CompanionApiResponse {
  status: number;
  body: unknown;
}

export interface CompanionApiDeps {
  /** A phone action changed a project's tasks: the desktop board reloads them */
  onTasksChanged: (projectId: string) => void;
}

const ok = (body: unknown): CompanionApiResponse => ({ status: 200, body });
const fail = (status: number, error: string): CompanionApiResponse => ({ status, body: { error } });

export async function handleCompanionApi(request: CompanionApiRequest, deps: CompanionApiDeps): Promise<CompanionApiResponse> {
  const parts = request.path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api') return fail(404, 'Not found');
  const [, resource, projectId, sub, id, leaf] = parts;

  if (request.method === 'GET' && resource === 'session' && parts.length === 2) {
    return ok({ device: request.device });
  }
  if (resource !== 'projects') return fail(404, 'Not found');

  if (request.method === 'GET' && parts.length === 2) {
    return ok(projectStore.getProjects().map((project) => ({ id: project.id, name: project.name })));
  }
  if (!projectId || !projectStore.getProject(projectId)) return fail(404, 'The project is not open in Workbench');

  const context = { projectId, onTasksChanged: () => deps.onTasksChanged(projectId) };
  const run = async (tool: string, args: Record<string, unknown>): Promise<CompanionApiResponse> => {
    try {
      return ok(await runTaskTool(context, tool, args));
    } catch (error) {
      // The task tools' errors are written for the user ("Stop the task before editing it")
      return fail(400, error instanceof Error ? error.message : String(error));
    }
  };

  if (request.method === 'GET' && sub === 'tasks') {
    if (parts.length === 4) return run('list_tasks', {});
    if (parts.length === 5) return run('get_task', { taskId: id });
    if (parts.length === 6 && leaf === 'logs') return run('get_task_logs', { taskId: id, limit: Number(request.query.get('limit')) || undefined });
  }
  if (request.method === 'POST' && sub === 'actions' && parts.length === 5) {
    if (!(COMPANION_ACTIONS as readonly string[]).includes(id)) return fail(403, `"${id}" is not available from the phone`);
    return run(id, request.body);
  }
  return fail(404, 'Not found');
}
