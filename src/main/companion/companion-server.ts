/**
 * Companion server
 * ================
 *
 * Serves the phone companion: the phone page (`src/renderer/companion.html`, built with the
 * renderer) and its JSON API (`companion-api.ts`). Off by default. It listens on 127.0.0.1, where
 * `tailscale serve` reaches it with HTTPS for the user's own devices, or on every interface for
 * use over the home network.
 *
 * Every /api request but pairing needs a device token in the Authorization header (never a
 * cookie, so another web page can't send it). Requests must name the server by an IP address,
 * localhost or a Tailscale `*.ts.net` name in their Host header: a web page on another domain
 * that rebinds its name to 127.0.0.1 is refused (DNS rebinding).
 */

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompanionConfig } from '../../shared/types/companion';
import type { CompanionStore } from './companion-store';
import { handleCompanionApi, type CompanionApiDeps } from './companion-api';

const MAX_BODY_BYTES = 64 * 1024;
const PAGE = 'companion.html';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export interface CompanionServerOptions extends CompanionApiDeps {
  store: CompanionStore;
  /** Built renderer files (out/renderer), where companion.html and its assets are */
  rendererDir: string;
  /** Vite's dev server: the page is fetched from it in development */
  devServerUrl?: string;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8').trim();
      try {
        const parsed: unknown = text ? JSON.parse(text) : {};
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new Error('The request body is not JSON'));
      }
    });
    request.on('error', reject);
  });
}

/** Whether a Host header names this server, not a foreign domain resolved to it */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  // "name:port", "1.2.3.4:port" or "[::1]:port"
  const name = (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '')).toLowerCase();
  if (isIP(name)) return true;
  return name === 'localhost' || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(name);
}

/** The addresses a phone can open for this config */
export function companionUrls(config: CompanionConfig): string[] {
  if (config.listen === 'localhost') return [`http://127.0.0.1:${config.port}`];
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => `http://${address!.address}:${config.port}`);
  return addresses.length > 0 ? addresses : [`http://127.0.0.1:${config.port}`];
}

export class CompanionServer {
  private server: Server | null = null;
  private listeningOn: CompanionConfig | null = null;

  constructor(private readonly options: CompanionServerOptions) {}

  get running(): boolean {
    return this.server !== null;
  }

  /** Start, restart or stop the server to match the config */
  async apply(config: CompanionConfig): Promise<void> {
    if (!config.enabled) return this.stop();
    if (this.server && this.listeningOn?.port === config.port && this.listeningOn.listen === config.listen) return;
    await this.stop();
    const server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        if (!response.headersSent) send(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.listen === 'network' ? '0.0.0.0' : '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.listeningOn = { ...config };
  }

  stop(): Promise<void> {
    const current = this.server;
    this.server = null;
    this.listeningOn = null;
    if (!current) return Promise.resolve();
    current.closeAllConnections();
    return new Promise((resolve) => current.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isAllowedHost(request.headers.host)) return send(response, 421, { error: 'Unknown host' });
    const url = new URL(request.url ?? '/', 'http://companion');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return this.handleApi(request, response, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Method not allowed' });
    return this.serveStatic(url.pathname, response);
  }

  private async handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const { store } = this.options;
    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try {
        body = await readBody(request);
      } catch (error) {
        return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (url.pathname === '/api/pair') {
      if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed' });
      const paired = store.redeemPairingCode(String(body.code ?? ''), String(body.deviceName ?? ''));
      if (!paired) return send(response, 401, { error: 'The pairing code is wrong or has expired. Create a new one in Workbench Settings.' });
      return send(response, 200, paired);
    }

    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    const device = store.authenticate(token);
    if (!device) return send(response, 401, { error: 'This phone is not paired with Workbench' });

    const result = await handleCompanionApi(
      { method: request.method ?? 'GET', path: url.pathname, query: url.searchParams, body, device },
      { onTasksChanged: this.options.onTasksChanged }
    );
    send(response, result.status, result.body);
  }

  private async serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const file = pathname === '/' || pathname === `/${PAGE}` ? PAGE : pathname.replace(/^\/+/, '');
    // Vite serves the page's source modules from many paths in development
    if (this.options.devServerUrl) return this.proxyToDevServer(file, response);
    // The page and the files it loads (built into assets/), nothing else from the renderer folder
    if (file !== PAGE && !file.startsWith('assets/')) return send(response, 404, { error: 'Not found' });

    const root = path.resolve(this.options.rendererDir);
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep)) return send(response, 404, { error: 'Not found' });
    let content: Buffer;
    try {
      content = await readFile(resolved);
    } catch {
      return send(response, 404, { error: 'Not found' });
    }
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': CONTENT_TYPES[path.extname(resolved)] ?? 'application/octet-stream',
      // Built assets have hashed names; the page itself must not be cached past an update
      'Cache-Control': file === PAGE ? 'no-cache' : 'public, max-age=31536000, immutable',
    }).end(content);
  }

  /** Development: Vite serves the page and its modules (no hot reload on the phone) */
  private proxyToDevServer(file: string, response: ServerResponse): void {
    const target = new URL(file, this.options.devServerUrl!.endsWith('/') ? this.options.devServerUrl : `${this.options.devServerUrl}/`);
    const upstream = httpRequest(target, (reply) => {
      response.writeHead(reply.statusCode ?? 502, { ...SECURITY_HEADERS, 'Content-Type': reply.headers['content-type'] ?? 'application/octet-stream' });
      reply.pipe(response);
    });
    upstream.on('error', () => send(response, 502, { error: 'The development server is not running' }));
    upstream.end();
  }
}
