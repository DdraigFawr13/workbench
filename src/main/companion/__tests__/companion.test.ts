/**
 * The phone companion over real HTTP requests (the task tools and the project store are mocked):
 * - a phone pairs once with a one-time code; wrong, expired or reused codes are refused
 * - every API request needs a paired device's token; a revoked phone is refused at once
 * - only the stored token's hash is on disk
 * - phone actions run through the task tools, delete_task is not offered, and the board reloads
 * - the server serves the built page and its assets, nothing else
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const runTaskTool = vi.fn();
vi.mock('../../insights/task-tools', () => ({
  runTaskTool: (...args: unknown[]) => runTaskTool(...args),
}));
vi.mock('../../project-store', () => ({
  projectStore: {
    getProjects: () => [{ id: 'p1', name: 'Workbench', path: '/secret/path' }],
    getProject: (id: string) => (id === 'p1' ? { id: 'p1', name: 'Workbench' } : undefined),
  },
}));

import { CompanionStore } from '../companion-store';
import { CompanionServer } from '../companion-server';

let dir: string;
let now: number;
let store: CompanionStore;
let server: CompanionServer;
let base: string;
const onTasksChanged = vi.fn();

async function start(): Promise<void> {
  // Port 0 is refused by the config check, so listen through the server with a free port found first
  const probe = (await import('node:net')).createServer();
  const port = await new Promise<number>((resolve) => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port)));
  await new Promise((resolve) => probe.close(resolve));
  store.setConfig({ enabled: true, port: Math.max(port, 1024), listen: 'localhost' });
  await server.apply(store.getConfig());
  base = `http://127.0.0.1:${store.getConfig().port}`;
}

async function api(method: string, route: string, options: { token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function pair(): Promise<string> {
  const { code } = store.createPairingCode();
  const { status, body } = await api('POST', '/api/pair', { body: { code, deviceName: 'Morgan phone' } });
  expect(status).toBe(200);
  return body.token as string;
}

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(tmpdir(), 'companion-'));
  now = Date.parse('2026-10-25T09:00:00Z');
  store = new CompanionStore(path.join(dir, 'companion.json'), () => now);
  const rendererDir = path.join(dir, 'renderer');
  mkdirSync(path.join(rendererDir, 'assets'), { recursive: true });
  writeFileSync(path.join(rendererDir, 'companion.html'), '<!doctype html><title>Companion</title>');
  writeFileSync(path.join(rendererDir, 'index.html'), '<!doctype html><title>Desktop</title>');
  writeFileSync(path.join(rendererDir, 'assets', 'companion-abc.js'), 'console.info(1)');
  server = new CompanionServer({ store, rendererDir, onTasksChanged });
  await start();
});

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('pairing', () => {
  it('pairs a phone once with a code typed in any case, and stores only the token hash', async () => {
    const { code } = store.createPairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    const first = await api('POST', '/api/pair', { body: { code: typed, deviceName: 'Morgan phone' } });
    expect(first.status).toBe(200);
    expect(first.body.device).toMatchObject({ name: 'Morgan phone' });

    const again = await api('POST', '/api/pair', { body: { code, deviceName: 'Other' } });
    expect(again.status).toBe(401);

    const onDisk = readFileSync(path.join(dir, 'companion.json'), 'utf-8');
    expect(onDisk).not.toContain(first.body.token);
    expect(store.listDevices()).toEqual([expect.objectContaining({ name: 'Morgan phone' })]);
    expect(JSON.stringify(store.listDevices())).not.toContain('tokenHash');
  });

  it('refuses an expired code', async () => {
    const { code } = store.createPairingCode();
    now += 11 * 60 * 1000;
    expect((await api('POST', '/api/pair', { body: { code } })).status).toBe(401);
  });

  it('cancels the code after five wrong attempts', async () => {
    const { code } = store.createPairingCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await api('POST', '/api/pair', { body: { code: 'WRONG234' } })).status).toBe(401);
    }
    expect((await api('POST', '/api/pair', { body: { code } })).status).toBe(401);
  });
});

describe('API', () => {
  it('needs a paired device token, and a revoked phone is refused at once', async () => {
    expect((await api('GET', '/api/projects')).status).toBe(401);
    expect((await api('GET', '/api/projects', { token: 'made-up' })).status).toBe(401);

    const token = await pair();
    const projects = await api('GET', '/api/projects', { token });
    expect(projects).toEqual({ status: 200, body: [{ id: 'p1', name: 'Workbench' }] });

    store.revokeDevice(store.listDevices()[0].id);
    expect((await api('GET', '/api/projects', { token })).status).toBe(401);
  });

  it('reads the board, a task and its logs through the task tools', async () => {
    const token = await pair();
    runTaskTool.mockResolvedValue([{ id: '001-a' }]);
    expect((await api('GET', '/api/projects/p1/tasks', { token })).body).toEqual([{ id: '001-a' }]);
    expect(runTaskTool).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'p1' }), 'list_tasks', {});

    await api('GET', '/api/projects/p1/tasks/001-a', { token });
    expect(runTaskTool).toHaveBeenLastCalledWith(expect.anything(), 'get_task', { taskId: '001-a' });

    await api('GET', '/api/projects/p1/tasks/001-a/logs?limit=20', { token });
    expect(runTaskTool).toHaveBeenLastCalledWith(expect.anything(), 'get_task_logs', { taskId: '001-a', limit: 20 });

    expect((await api('GET', '/api/projects/nope/tasks', { token })).status).toBe(404);
  });

  it('runs allowed actions, refuses delete_task, and reports tool errors', async () => {
    const token = await pair();
    runTaskTool.mockImplementation(async (context: { onTasksChanged: () => void }) => {
      context.onTasksChanged();
      return { id: '001-a', action: 'started' };
    });
    const started = await api('POST', '/api/projects/p1/actions/start_task', { token, body: { taskId: '001-a' } });
    expect(started).toEqual({ status: 200, body: { id: '001-a', action: 'started' } });
    expect(runTaskTool).toHaveBeenLastCalledWith(expect.anything(), 'start_task', { taskId: '001-a' });
    expect(onTasksChanged).toHaveBeenCalledWith('p1');

    runTaskTool.mockClear();
    const deleted = await api('POST', '/api/projects/p1/actions/delete_task', { token, body: { taskId: '001-a' } });
    expect(deleted.status).toBe(403);
    expect(runTaskTool).not.toHaveBeenCalled();

    runTaskTool.mockRejectedValue(new Error('Stop the task before editing it'));
    const refused = await api('POST', '/api/projects/p1/actions/update_task', { token, body: { taskId: '001-a' } });
    expect(refused).toEqual({ status: 400, body: { error: 'Stop the task before editing it' } });
  });
});

describe('page', () => {
  it('serves the companion page and its assets, nothing else from the renderer folder', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Companion');
    expect((await fetch(`${base}/assets/companion-abc.js`)).status).toBe(200);
    expect((await fetch(`${base}/index.html`)).status).toBe(404);
    expect((await fetch(`${base}/assets/../index.html`)).status).toBe(404);
    expect((await fetch(`${base}/assets/%2e%2e/index.html`)).status).toBe(404);
  });

  it('stops listening when switched off', async () => {
    store.setConfig({ enabled: false });
    await server.apply(store.getConfig());
    expect(server.running).toBe(false);
    await expect(fetch(`${base}/`)).rejects.toThrow();
  });
});
