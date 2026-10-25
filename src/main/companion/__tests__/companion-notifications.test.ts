/**
 * The phone companion's Web Push notifications:
 * - which task states and agent window changes notify, and which do not (restored tasks, moves by
 *   hand, stopped runs, unchanged states)
 * - a phone subscribes and unsubscribes over the API, gets a test notification, and the key pair
 *   is made once and kept
 * - nothing is sent while the companion is off; a subscription the push service dropped is removed
 * - a message web-push prepares is signed with the VAPID key and decrypts with the phone's key to
 *   the notification
 * - the server serves the service worker and the install manifest
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';

vi.mock('../../insights/task-tools', () => ({ runTaskTool: vi.fn() }));
vi.mock('../../app-logger', () => ({ appLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../project-store', () => ({
  projectStore: { getProjects: () => [], getProject: () => undefined },
}));

import { CompanionStore } from '../companion-store';
import { CompanionServer } from '../companion-server';
import { CompanionNotifier, agentNotification, pushOptions, taskNotification, testNotification, type PushSend } from '../companion-notifier';
import {
  onAgentWindowStatusChange,
  resetAgentWindowStatusesForTests,
  setAgentWindowStatus,
} from '../../agent-status/agent-window-status-store';
import type { Project, Task } from '../../../shared/types';
import type { TaskHookEvents } from '../../task-hooks';

const project = { id: 'p1', name: 'Workbench', path: '/work/workbench' } as Project;
const task = { id: 't1', specId: '001-export', title: 'Add CSV export' } as Task;
const stateEvent = (changes: Partial<TaskHookEvents['state']>): TaskHookEvents['state'] => ({
  project,
  task,
  status: 'human_review',
  ...changes,
});

/** What the phone's browser does with a message (RFC 8291, one aes128gcm record) */
function decryptOnPhone(body: Buffer, phone: ECDH, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverKey = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), phone.getPublicKey(), serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', phone.computeSecret(serverKey), authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // The last record ends with the delimiter 2, then zero padding
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf-8');
}

const subscription = (n = 1) => ({ endpoint: `https://push.example/send/${n}`, keys: { p256dh: 'key', auth: 'secret' } });

let dir: string;
let store: CompanionStore;
let server: CompanionServer;
let notifier: CompanionNotifier;
let send: ReturnType<typeof vi.fn<PushSend>>;
let base: string;

async function api(method: string, route: string, options: { token?: string; body?: unknown } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function pairDevice(): { token: string; deviceId: string } {
  const { code } = store.createPairingCode();
  const paired = store.redeemPairingCode(code, 'Phone')!;
  return { token: paired.token, deviceId: paired.device.id };
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetAgentWindowStatusesForTests();
  dir = mkdtempSync(path.join(tmpdir(), 'companion-push-'));
  store = new CompanionStore(path.join(dir, 'companion.json'));
  send = vi.fn<PushSend>().mockResolvedValue(undefined);
  notifier = new CompanionNotifier({ store, isActive: () => server.running, send });
  const rendererDir = path.join(dir, 'renderer');
  mkdirSync(rendererDir, { recursive: true });
  writeFileSync(path.join(rendererDir, 'companion.html'), '<!doctype html>');
  writeFileSync(path.join(rendererDir, 'companion-sw.js'), "self.addEventListener('push', () => {})");
  writeFileSync(path.join(rendererDir, 'companion.webmanifest'), '{"name":"Workbench"}');
  server = new CompanionServer({
    store,
    rendererDir,
    onTasksChanged: vi.fn(),
    push: {
      publicKey: () => notifier.publicKey(),
      setSubscription: (deviceId, value) => store.setPushSubscription(deviceId, value),
      sendTest: (deviceId) => notifier.notify(testNotification(), deviceId),
    },
  });
  const probe = createServer();
  const port = await new Promise<number>((resolve) => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port)));
  await new Promise((resolve) => probe.close(resolve));
  store.setConfig({ enabled: true, port: Math.max(port, 1024), listen: 'localhost' });
  await server.apply(store.getConfig());
  base = `http://127.0.0.1:${store.getConfig().port}`;
});

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('task notifications', () => {
  it('notifies a task ready for review, with checks failed, failed, rate limited or merged', () => {
    expect(taskNotification(stateEvent({ state: 'human_review', previousState: 'qa_review', reviewReason: 'completed' }))).toEqual({
      title: 'Task ready for review',
      body: 'Add CSV export in Workbench',
      tag: 'task:p1:t1',
      url: '/?project=p1&task=t1',
    });
    const title = (changes: Partial<TaskHookEvents['state']>) => taskNotification(stateEvent(changes))?.title;
    expect(title({ state: 'human_review', previousState: 'qa_review', reviewReason: 'qa_rejected' })).toBe('Task checks failed');
    expect(title({ state: 'human_review', previousState: 'coding', reviewReason: 'errors' })).toBe('Task failed');
    expect(title({ state: 'error', previousState: 'coding', reviewReason: 'errors' })).toBe('Task failed');
    expect(title({ state: 'queued', previousState: 'coding', status: 'queue' })).toBe('Task paused by a rate limit');
    expect(title({ state: 'done', previousState: 'pr_created', status: 'done' })).toBe('Pull request merged');
  });

  it('stays silent for restored tasks, moves by hand, stopped runs and other states', () => {
    const silent = (changes: Partial<TaskHookEvents['state']>) => expect(taskNotification(stateEvent(changes))).toBeNull();
    // Restored in a state (the machine was just created)
    silent({ state: 'human_review', reviewReason: 'completed' });
    // A move the user made by hand
    silent({ status: 'done' });
    // The same state again (a stage-only merge keeps the task in review)
    silent({ state: 'human_review', previousState: 'human_review', reviewReason: 'completed' });
    silent({ state: 'human_review', previousState: 'coding', reviewReason: 'stopped' });
    silent({ state: 'queued', previousState: 'backlog', status: 'queue' });
    silent({ state: 'coding', previousState: 'planning', status: 'in_progress' });
    silent({ state: 'done', previousState: 'human_review', status: 'done' });
  });
});

describe('agent notifications', () => {
  const entry = (status: 'working' | 'needs-input' | 'finished' | 'idle') => ({
    terminalId: 'term-1',
    title: 'Claude 1',
    projectPath: '/work/workbench',
    status,
    since: '2026-10-25T09:00:00.000Z',
  });

  it('notifies an agent that needs input or finished a turn out of view', () => {
    expect(agentNotification(entry('needs-input'), 'working', project)).toEqual({
      title: 'Agent needs input',
      body: 'Claude 1 in Workbench',
      tag: 'agent:term-1',
      url: '/?project=p1',
    });
    expect(agentNotification(entry('finished'), 'working', project)?.title).toBe('Agent finished');
  });

  it('stays silent for idle and working windows, and windows of no open project', () => {
    expect(agentNotification(entry('idle'), 'working', project)).toBeNull();
    expect(agentNotification(entry('working'), 'needs-input', project)).toBeNull();
    expect(agentNotification(entry('finished'), undefined, project)).toBeNull();
    expect(agentNotification(entry('needs-input'), 'working', undefined)).toBeNull();
  });

  it('reports each status change of a window once, with its previous status', () => {
    const listener = vi.fn();
    onAgentWindowStatusChange(listener);
    const report = (status: 'working' | 'needs-input') => setAgentWindowStatus('term-1', { title: 'Claude 1', projectPath: '/w', status });
    report('working');
    report('working');
    report('needs-input');
    expect(listener.mock.calls.map(([next, previous]) => [next.status, previous])).toEqual([
      ['working', undefined],
      ['needs-input', 'working'],
    ]);
  });
});

describe('subscriptions', () => {
  it('subscribes a phone, sends it a test notification, and unsubscribes it', async () => {
    const { token, deviceId } = pairDevice();
    const before = await api('GET', '/api/push', { token });
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{80,}$/), subscribed: false });

    expect((await api('POST', '/api/push/subscribe', { token, body: { subscription: { endpoint: 'http://plain' } } })).status).toBe(400);
    expect((await api('POST', '/api/push/subscribe', { token, body: { subscription: subscription() } })).status).toBe(200);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ title: 'Notifications are on' });
    expect(store.listDevices()).toEqual([expect.objectContaining({ id: deviceId, notifications: true })]);
    expect((await api('GET', '/api/push', { token })).body).toEqual({ publicKey: before.body.publicKey, subscribed: true });

    await api('POST', '/api/push/unsubscribe', { token, body: {} });
    expect(store.listPushSubscriptions()).toEqual([]);
    expect((await api('GET', '/api/push')).status).toBe(401);
  });

  it('keeps the key pair across restarts and forgets a revoked phone with its subscription', () => {
    const { deviceId } = pairDevice();
    store.setPushSubscription(deviceId, subscription());
    const key = notifier.publicKey();
    const reloaded = new CompanionStore(path.join(dir, 'companion.json'));
    expect(reloaded.getVapidKeys(() => ({ publicKey: 'new', privateKey: 'new' })).publicKey).toBe(key);
    expect(reloaded.listPushSubscriptions()).toHaveLength(1);
    reloaded.revokeDevice(deviceId);
    expect(reloaded.listPushSubscriptions()).toEqual([]);
    // The private key stays on this computer, in the file written with owner-only permissions
    expect(readFileSync(path.join(dir, 'companion.json'), 'utf-8')).toContain('privateKey');
  });

  it('sends to every subscribed phone, nothing while off, and drops subscriptions the push service no longer knows', async () => {
    const first = pairDevice();
    const second = pairDevice();
    store.setPushSubscription(first.deviceId, subscription(1));
    store.setPushSubscription(second.deviceId, subscription(2));
    send.mockImplementation(async (target) => {
      if (target.endpoint.endsWith('/2')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    });

    await notifier.notify(testNotification());
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.listPushSubscriptions().map((target) => target.deviceId)).toEqual([first.deviceId]);

    send.mockClear();
    await server.stop();
    await notifier.notify(testNotification());
    expect(send).not.toHaveBeenCalled();
  });

  it('reports other delivery errors without failing the caller', async () => {
    const onError = vi.fn();
    const failing = new CompanionNotifier({ store, isActive: () => true, send: () => Promise.reject(new Error('offline')), onError });
    const { deviceId } = pairDevice();
    store.setPushSubscription(deviceId, subscription());
    await expect(failing.notify(testNotification())).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
    expect(store.listPushSubscriptions()).toHaveLength(1);
  });
});

describe('web-push', () => {
  it('signs a message with VAPID and encrypts it so that only the phone decrypts it to the notification', () => {
    // The phone's keys, as a browser makes them for a subscription
    const phone = createECDH('prime256v1');
    phone.generateKeys();
    const authSecret = randomBytes(16);
    const notification = taskNotification(stateEvent({ state: 'error', previousState: 'coding', reviewReason: 'errors' }))!;
    const keys = store.getVapidKeys(() => webpush.generateVAPIDKeys());

    const request = webpush.generateRequestDetails(
      {
        endpoint: 'https://push.example/send/abc',
        keys: { p256dh: phone.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
      },
      JSON.stringify(notification),
      pushOptions(keys)
    );

    expect(request.endpoint).toBe('https://push.example/send/abc');
    expect(request.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: 3600, Urgency: 'high' });
    expect(request.headers.Authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${keys.publicKey}$`));
    expect(JSON.parse(decryptOnPhone(request.body as Buffer, phone, authSecret))).toEqual({
      title: 'Task failed',
      body: 'Add CSV export in Workbench',
      tag: 'task:p1:t1',
      url: '/?project=p1&task=t1',
    });
  });
});

describe('page files', () => {
  it('serves the service worker and the install manifest uncached', async () => {
    const worker = await fetch(`${base}/companion-sw.js`);
    expect(worker.status).toBe(200);
    expect(worker.headers.get('content-type')).toContain('text/javascript');
    expect(worker.headers.get('cache-control')).toBe('no-cache');
    const manifest = await fetch(`${base}/companion.webmanifest`);
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json');
    expect((await fetch(`${base}/other.js`)).status).toBe(404);
  });
});
