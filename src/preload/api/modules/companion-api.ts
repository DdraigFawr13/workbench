import { IPC_CHANNELS } from '../../../shared/constants';
import type { CompanionConfig, CompanionPairingCode, CompanionStatus, IPCResult } from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/** Phone companion (Settings > Phone) */
export interface CompanionAPI {
  /** The companion's settings, whether its server runs, its addresses and the paired phones */
  getCompanionStatus: () => Promise<IPCResult<CompanionStatus>>;
  /** Change the settings; the server starts, restarts or stops to match */
  setCompanionConfig: (changes: Partial<CompanionConfig>) => Promise<IPCResult<CompanionStatus>>;
  /** A one-time code for pairing a phone (replaces the previous one) */
  createCompanionPairingCode: () => Promise<IPCResult<CompanionPairingCode>>;
  /** Sign a paired phone out */
  revokeCompanionDevice: (deviceId: string) => Promise<IPCResult<CompanionStatus>>;
}

export const createCompanionAPI = (): CompanionAPI => ({
  getCompanionStatus: () => invokeIpc(IPC_CHANNELS.COMPANION_GET_STATUS),
  setCompanionConfig: (changes: Partial<CompanionConfig>) => invokeIpc(IPC_CHANNELS.COMPANION_SET_CONFIG, changes),
  createCompanionPairingCode: () => invokeIpc(IPC_CHANNELS.COMPANION_CREATE_PAIRING_CODE),
  revokeCompanionDevice: (deviceId: string) => invokeIpc(IPC_CHANNELS.COMPANION_REVOKE_DEVICE, deviceId),
});
