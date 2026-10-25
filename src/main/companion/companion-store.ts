/**
 * Companion store
 * ===============
 *
 * The phone companion's settings and paired phones, kept in `companion.json` in the app's data
 * folder. A phone pairs by sending a one-time code shown in Settings and gets a device token;
 * only the token's SHA-256 hash is stored, so the file can't be used to sign in.
 *
 * It also keeps the server's VAPID key pair, which signs Web Push messages, and each phone's push
 * subscription. Revoking a phone removes its subscription with it.
 */

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompanionConfig, CompanionDevice, CompanionPairingCode, CompanionPushSubscription } from '../../shared/types/companion';

export const DEFAULT_COMPANION_CONFIG: CompanionConfig = { enabled: false, port: 47821, listen: 'localhost' };

/** 32 symbols without the look-alikes I, O, 0 and 1 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong codes before the code in use is cancelled */
const MAX_CODE_ATTEMPTS = 5;
/** lastSeenAt is written at most this often, so polling doesn't rewrite the file every few seconds */
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
const MAX_DEVICE_NAME = 60;

interface StoredDevice extends Omit<CompanionDevice, 'notifications'> {
  tokenHash: string;
  push?: CompanionPushSubscription;
}

/** The key pair that signs Web Push messages (base64url, as the web-push package makes them) */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface StoredData {
  config: CompanionConfig;
  devices: StoredDevice[];
  vapid?: VapidKeys;
}

/** A device as the API and Settings show it: no token hash, no subscription */
const toPublic = ({ tokenHash: _tokenHash, push, ...device }: StoredDevice): CompanionDevice => ({ ...device, notifications: push !== undefined });

/** Whether a phone sent a subscription the push services can use */
export function isPushSubscription(value: unknown): value is CompanionPushSubscription {
  if (!value || typeof value !== 'object') return false;
  const { endpoint, keys } = value as Partial<CompanionPushSubscription>;
  return (
    typeof endpoint === 'string' &&
    endpoint.startsWith('https://') &&
    !!keys &&
    typeof keys.p256dh === 'string' &&
    typeof keys.auth === 'string'
  );
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Codes are typed on a phone: ignore case, spaces and dashes */
export const normalizePairingCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

export class CompanionStore {
  private data: StoredData;
  private pairing: { code: string; expiresAt: number; attempts: number } | null = null;

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {
    this.data = this.load();
  }

  private load(): StoredData {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<StoredData>;
        return {
          config: { ...DEFAULT_COMPANION_CONFIG, ...raw.config },
          devices: Array.isArray(raw.devices) ? raw.devices.filter((device) => device?.id && device.tokenHash) : [],
          ...(raw.vapid?.publicKey && raw.vapid.privateKey ? { vapid: raw.vapid } : {}),
        };
      }
    } catch {
      // An unreadable file starts over: the phones pair again
    }
    return { config: { ...DEFAULT_COMPANION_CONFIG }, devices: [] };
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }

  getConfig(): CompanionConfig {
    return { ...this.data.config };
  }

  setConfig(changes: Partial<CompanionConfig>): CompanionConfig {
    const next = { ...this.data.config, ...changes };
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) throw new Error('The port must be a number from 1024 to 65535');
    if (next.listen !== 'localhost' && next.listen !== 'network') throw new Error(`Unknown listen mode "${String(next.listen)}"`);
    this.data.config = { enabled: next.enabled === true, port: next.port, listen: next.listen };
    this.save();
    return this.getConfig();
  }

  listDevices(): CompanionDevice[] {
    return this.data.devices.map(toPublic);
  }

  /** A new one-time pairing code; it replaces the previous one */
  createPairingCode(): CompanionPairingCode {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = this.now() + CODE_TTL_MS;
    this.pairing = { code, expiresAt, attempts: 0 };
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Exchange the pairing code for a device token. The code works once; it is cancelled after
   * too many wrong attempts. Returns null when the code is wrong or expired.
   */
  redeemPairingCode(code: string, deviceName: string): { token: string; device: CompanionDevice } | null {
    const pairing = this.pairing;
    if (!pairing || pairing.expiresAt <= this.now()) {
      this.pairing = null;
      return null;
    }
    const given = Buffer.from(normalizePairingCode(code));
    const expected = Buffer.from(pairing.code);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      pairing.attempts += 1;
      if (pairing.attempts >= MAX_CODE_ATTEMPTS) this.pairing = null;
      return null;
    }
    this.pairing = null;
    const token = randomBytes(32).toString('base64url');
    const device: StoredDevice = {
      id: randomUUID(),
      name: deviceName.trim().slice(0, MAX_DEVICE_NAME) || 'Phone',
      pairedAt: new Date(this.now()).toISOString(),
      tokenHash: hash(token),
    };
    this.data.devices.push(device);
    this.save();
    return { token, device: toPublic(device) };
  }

  /** The paired device a token belongs to, or null */
  authenticate(token: string | undefined): CompanionDevice | null {
    if (!token) return null;
    const tokenHash = Buffer.from(hash(token));
    const device = this.data.devices.find((candidate) => timingSafeEqual(Buffer.from(candidate.tokenHash), tokenHash));
    if (!device) return null;
    const now = this.now();
    if (!device.lastSeenAt || now - Date.parse(device.lastSeenAt) >= LAST_SEEN_WRITE_INTERVAL_MS) {
      device.lastSeenAt = new Date(now).toISOString();
      this.save();
    }
    return toPublic(device);
  }

  revokeDevice(id: string): boolean {
    const before = this.data.devices.length;
    this.data.devices = this.data.devices.filter((device) => device.id !== id);
    if (this.data.devices.length === before) return false;
    this.save();
    return true;
  }

  /** The VAPID key pair, made with `generate` the first time it is needed */
  getVapidKeys(generate: () => VapidKeys): VapidKeys {
    if (!this.data.vapid) {
      this.data.vapid = generate();
      this.save();
    }
    return { ...this.data.vapid };
  }

  /** Store a phone's push subscription, or remove it (null) */
  setPushSubscription(deviceId: string, subscription: CompanionPushSubscription | null): boolean {
    const device = this.data.devices.find((candidate) => candidate.id === deviceId);
    if (!device) return false;
    if (subscription) device.push = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    else delete device.push;
    this.save();
    return true;
  }

  /** The phones that receive notifications */
  listPushSubscriptions(): { deviceId: string; subscription: CompanionPushSubscription }[] {
    return this.data.devices.flatMap((device) => (device.push ? [{ deviceId: device.id, subscription: device.push }] : []));
  }

  /** The push service no longer knows a subscription (404 or 410): forget it */
  removePushEndpoint(endpoint: string): void {
    const device = this.data.devices.find((candidate) => candidate.push?.endpoint === endpoint);
    if (!device) return;
    delete device.push;
    this.save();
  }
}
