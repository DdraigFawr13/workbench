/**
 * Phone companion IPC handlers (Settings > Phone): switch the companion server on or off, pair a
 * phone with a one-time code, and revoke paired phones. Also connects the notifications to the
 * task states and the agent windows' status.
 */

import { app, ipcMain, type BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';
import type { CompanionConfig, CompanionPairingCode, CompanionStatus } from '../../shared/types/companion';
import { CompanionStore } from '../companion/companion-store';
import { CompanionServer, companionUrls } from '../companion/companion-server';
import { CompanionNotifier, agentNotification, taskNotification, testNotification } from '../companion/companion-notifier';
import { samePath } from '../companion/companion-api';
import { onAgentWindowStatusChange } from '../agent-status/agent-window-status-store';
import { taskHooks } from '../task-hooks';
import { projectStore } from '../project-store';
import { appLog } from '../app-logger';
import { safeSendToRenderer } from './utils';

let store: CompanionStore | null = null;
let server: CompanionServer | null = null;
/** Why the server could not start with the current config */
let startError: string | undefined;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function status(): CompanionStatus {
  const config = store!.getConfig();
  return {
    config,
    running: server?.running === true,
    ...(startError ? { error: startError } : {}),
    urls: companionUrls(config),
    devices: store!.listDevices(),
  };
}

async function applyConfig(): Promise<void> {
  try {
    await server!.apply(store!.getConfig());
    startError = undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    startError = code === 'EADDRINUSE' ? `Port ${store!.getConfig().port} is in use by another program` : errorMessage(error);
    appLog.error('[Companion] Server could not start:', error);
  }
}

export function registerCompanionHandlers(getMainWindow: () => BrowserWindow | null): void {
  store = new CompanionStore(path.join(app.getPath('userData'), 'companion.json'));
  const notifier = new CompanionNotifier({
    store,
    isActive: () => server?.running === true,
    onError: (error) => appLog.error('[Companion] A notification could not be sent:', error),
  });
  taskHooks.on('state', (event) => notifier.notify(taskNotification(event)));
  onAgentWindowStatusChange((entry, previous) => {
    const project = entry.projectPath ? projectStore.getProjects().find((candidate) => samePath(candidate.path, entry.projectPath!)) : undefined;
    void notifier.notify(agentNotification(entry, previous, project));
  });
  server = new CompanionServer({
    store,
    // The bundled main process runs from out/main; the renderer is built into out/renderer
    rendererDir: path.join(path.dirname(fileURLToPath(import.meta.url)), '../renderer'),
    devServerUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
    onTasksChanged: (projectId) => safeSendToRenderer(getMainWindow, IPC_CHANNELS.TASK_LIST_CHANGED, projectId),
    push: {
      publicKey: () => notifier.publicKey(),
      setSubscription: (deviceId, subscription) => store!.setPushSubscription(deviceId, subscription),
      sendTest: (deviceId) => notifier.notify(testNotification(), deviceId),
    },
  });
  if (store.getConfig().enabled) void applyConfig();

  ipcMain.handle(IPC_CHANNELS.COMPANION_GET_STATUS, async (): Promise<IPCResult<CompanionStatus>> => {
    return { success: true, data: status() };
  });

  ipcMain.handle(
    IPC_CHANNELS.COMPANION_SET_CONFIG,
    async (_event, changes: Partial<CompanionConfig>): Promise<IPCResult<CompanionStatus>> => {
      try {
        store!.setConfig(changes);
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
      await applyConfig();
      return { success: true, data: status() };
    }
  );

  ipcMain.handle(IPC_CHANNELS.COMPANION_CREATE_PAIRING_CODE, async (): Promise<IPCResult<CompanionPairingCode>> => {
    return { success: true, data: store!.createPairingCode() };
  });

  ipcMain.handle(IPC_CHANNELS.COMPANION_REVOKE_DEVICE, async (_event, deviceId: string): Promise<IPCResult<CompanionStatus>> => {
    store!.revokeDevice(deviceId);
    return { success: true, data: status() };
  });
}

/** Close the companion server (app quit) */
export function stopCompanionServer(): Promise<void> {
  return server?.stop() ?? Promise.resolve();
}
