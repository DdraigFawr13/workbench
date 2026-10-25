/**
 * Phone companion: a web page served by Workbench (src/main/companion/) that lists and steers
 * the projects' tasks from a phone paired with a one-time code
 */

/** Where the companion server listens */
export type CompanionListenMode =
  /** 127.0.0.1 only: reached through `tailscale serve` (HTTPS on the user's tailnet) */
  | 'localhost'
  /** Every network interface: reached over the home network (plain HTTP) */
  | 'network';

export interface CompanionConfig {
  enabled: boolean;
  port: number;
  listen: CompanionListenMode;
}

/** A paired phone (its token is stored only as a hash) */
export interface CompanionDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt?: string;
}

export interface CompanionPairingCode {
  code: string;
  expiresAt: string;
}

export interface CompanionStatus {
  config: CompanionConfig;
  /** Whether the server is listening now */
  running: boolean;
  /** Why the server could not start (port in use, ...) */
  error?: string;
  /** Addresses the phone can open (local network addresses in network mode) */
  urls: string[];
  devices: CompanionDevice[];
}
