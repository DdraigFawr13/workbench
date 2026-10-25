/**
 * Phone companion mock for browser mode (Settings > Phone)
 */
import type { CompanionStatus } from '../../../shared/types';

const status = (): CompanionStatus => ({
  config: { enabled: false, port: 47821, listen: 'localhost' },
  running: false,
  urls: ['http://127.0.0.1:47821'],
  devices: []
});

export const companionMock = {
  getCompanionStatus: async () => ({ success: true, data: status() }),
  setCompanionConfig: async () => ({ success: true, data: status() }),
  createCompanionPairingCode: async () => ({
    success: true,
    data: { code: 'ABCD2345', expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
  }),
  revokeCompanionDevice: async () => ({ success: true, data: status() })
};
