/**
 * Web Push on the phone: registers the service worker (public/companion-sw.js) and subscribes the
 * phone with the companion server's key, so Workbench can notify it (src/main/companion/companion-notifier.ts).
 */
import { api } from './api';

const SERVICE_WORKER = '/companion-sw.js';

/**
 * Whether this page can receive notifications:
 * - insecure: plain HTTP (home network mode); browsers offer push only to https pages
 * - ios-home-screen: iPhone Safari, which offers push only to pages added to the home screen
 */
export type PushSupport = 'supported' | 'insecure' | 'ios-home-screen' | 'unsupported';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'ios-home-screen' : 'unsupported';
  }
  return 'supported';
}

/** The service worker, registered once */
async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER);
  return navigator.serviceWorker.ready;
}

/** The VAPID key as the push manager takes it */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Whether this phone receives notifications: subscribed here and known to the computer */
export async function isPushOn(): Promise<boolean> {
  const [{ subscribed }, reg] = await Promise.all([api.push(), registration()]);
  return subscribed && (await reg.pushManager.getSubscription()) !== null;
}

/**
 * Ask for permission and subscribe (call it from a tap: iPhone asks only then). Returns false when
 * the user blocked notifications.
 */
export async function turnPushOn(): Promise<boolean> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const [{ publicKey }, reg] = await Promise.all([api.push(), registration()]);
  const current = await reg.pushManager.getSubscription();
  // A subscription made with another key (the computer's settings were reset) can't be used
  const subscription =
    current && keyMatches(current, publicKey)
      ? current
      : await (current ? current.unsubscribe() : Promise.resolve(true)).then(() =>
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
        );
  await api.subscribePush(subscription.toJSON());
  return true;
}

function keyMatches(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  const given = new Uint8Array(key);
  const expected = keyBytes(publicKey);
  return given.length === expected.length && given.every((byte, i) => byte === expected[i]);
}

export async function turnPushOff(): Promise<void> {
  const reg = await registration();
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  await api.unsubscribePush();
}

/** The service worker asks the open page to show a notification's task (see companion-sw.js) */
export function onNotificationOpened(open: (url: string) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type === 'open' && typeof data.url === 'string') open(data.url);
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
