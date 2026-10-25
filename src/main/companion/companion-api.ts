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
 *   GET  /api/projects/:projectId/agents               its agent windows' status (working, needs input, finished)
 *   POST /api/projects/:projectId/actions/:action      run an action (body: its arguments)
 *   GET  /api/push                                     the key to subscribe with, and whether this phone is subscribed
 *   POST /api/push/subscribe                           receive notifications (body: { subscription }); sends a test one
 *   POST /api/push/unsubscribe                         stop receiving them
 *
 * Creating and merging a PR run Claude Code and can take minutes, longer than a phone keeps a
 * request open. They answer 202 at once and continue in the background; the task's details then
 * carry `phoneAction` (running, or failed with its error) until the next one starts.
 */

import path from 'path';
import type { CompanionDevice, CompanionPushSubscription } from '../../shared/types/companion';
import { appLog } from '../app-logger';
import { runTaskTool } from '../insights/task-tools';
import { projectStore } from '../project-store';
import { getAgentWindowStatuses } from '../agent-status/agent-window-status-store';
import { isWindows } from '../platform';
import { isPushSubscription } from './companion-store';

/** Whether two project paths name the same folder (case-folded on Windows) */
export const samePath = (a: string, b: string) =>
  isWindows() ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

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

/** Actions that answer at once and finish in the background */
export const BACKGROUND_ACTIONS: readonly string[] = ['create_pull_request', 'merge_pull_request'];

/** The latest background action of a task, shown on its details */
export interface PhoneAction {
  action: string;
  state: 'running' | 'failed';
  error?: string;
  startedAt: string;
}

/** By `projectId/taskId`; a finished action is removed, a failed one stays until the next starts */
const phoneActions = new Map<string, PhoneAction>();

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

/** Notifications (companion-notifier.ts); absent, the push routes answer 404 */
export interface CompanionPushRoutes {
  publicKey: () => string;
  /** Store the phone's subscription (null removes it); false when the device is gone */
  setSubscription: (deviceId: string, subscription: CompanionPushSubscription | null) => boolean;
  /** Send the test notification to one phone */
  sendTest: (deviceId: string) => Promise<void>;
}

export interface CompanionApiDeps {
  /** A phone action changed a project's tasks: the desktop board reloads them */
  onTasksChanged: (projectId: string) => void;
  push?: CompanionPushRoutes;
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
  if (resource === 'push') return handlePush(request, parts.slice(2), deps.push);
  if (resource !== 'projects') return fail(404, 'Not found');

  if (request.method === 'GET' && parts.length === 2) {
    return ok(projectStore.getProjects().map((project) => ({ id: project.id, name: project.name })));
  }
  const project = projectId ? projectStore.getProject(projectId) : undefined;
  if (!project) return fail(404, 'The project is not open in Workbench');

  if (request.method === 'GET' && sub === 'agents' && parts.length === 4) {
    return ok(getAgentWindowStatuses(project.path, samePath).map(({ terminalId, title, status, since }) => ({ id: terminalId, title, status, since })));
  }

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
    if (parts.length === 5) {
      const result = await run('get_task', { taskId: id });
      const phoneAction = phoneActions.get(`${projectId}/${id}`);
      if (result.status === 200 && phoneAction && result.body && typeof result.body === 'object') {
        result.body = { ...result.body, phoneAction };
      }
      return result;
    }
    if (parts.length === 6 && leaf === 'logs') return run('get_task_logs', { taskId: id, limit: Number(request.query.get('limit')) || undefined });
  }
  if (request.method === 'POST' && sub === 'actions' && parts.length === 5) {
    if (!(COMPANION_ACTIONS as readonly string[]).includes(id)) return fail(403, `"${id}" is not available from the phone`);
    if (BACKGROUND_ACTIONS.includes(id)) return runInBackground(id, request.body, context);
    return run(id, request.body);
  }
  return fail(404, 'Not found');
}

async function handlePush(request: CompanionApiRequest, rest: string[], push: CompanionPushRoutes | undefined): Promise<CompanionApiResponse> {
  if (!push) return fail(404, 'Not found');
  if (request.method === 'GET' && rest.length === 0) {
    return ok({ publicKey: push.publicKey(), subscribed: request.device.notifications });
  }
  if (request.method !== 'POST' || rest.length !== 1) return fail(404, 'Not found');
  if (rest[0] === 'subscribe') {
    const subscription = request.body.subscription;
    if (!isPushSubscription(subscription)) return fail(400, 'The push subscription is not valid');
    if (!push.setSubscription(request.device.id, subscription)) return fail(401, 'This phone is not paired with Workbench');
    push.sendTest(request.device.id).catch((error: unknown) => {
      appLog.error(`[companion] The test notification failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return ok({ subscribed: true });
  }
  if (rest[0] === 'unsubscribe') {
    push.setSubscription(request.device.id, null);
    return ok({ subscribed: false });
  }
  return fail(404, 'Not found');
}

function runInBackground(action: string, args: Record<string, unknown>, context: { projectId: string; onTasksChanged: () => void }): CompanionApiResponse {
  const taskId = typeof args.taskId === 'string' ? args.taskId : '';
  if (!taskId) return fail(400, 'taskId is required');
  const key = `${context.projectId}/${taskId}`;
  const current = phoneActions.get(key);
  if (current?.state === 'running') return fail(409, `The task is already running "${current.action}"`);

  const entry: PhoneAction = { action, state: 'running', startedAt: new Date().toISOString() };
  phoneActions.set(key, entry);
  runTaskTool(context, action, args).then(
    () => {
      if (phoneActions.get(key) === entry) phoneActions.delete(key);
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      appLog.error(`[companion] ${action} failed for task ${taskId}: ${message}`);
      if (phoneActions.get(key) === entry) phoneActions.set(key, { ...entry, state: 'failed', error: message });
    }
  );
  return { status: 202, body: { started: true, action } };
}
