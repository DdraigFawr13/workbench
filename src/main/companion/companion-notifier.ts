/**
 * Companion notifications
 * =======================
 *
 * Web Push notifications for the paired phones that switched them on (on the phone page). A phone
 * is notified when a task needs the user (ready for review, checks failed, failed, paused by a rate
 * limit), when a task's pull request is merged, and when an agent window's Claude Code session asks
 * for input or finishes a turn out of view.
 *
 * The `web-push` package signs each message with the server's VAPID key (kept in companion.json)
 * and encrypts it for the phone (RFC 8291), so the push service that delivers it (Apple, Google,
 * Mozilla) cannot read it. Only transitions seen while the app runs notify: a task restored in a
 * state, a move the user made by hand and a status that did not change send nothing.
 *
 * Push needs a secure page: it works through `tailscale serve` (HTTPS), not in the plain HTTP home
 * network mode. On iPhone (iOS 16.4 or later) the page must be added to the home screen first.
 */

import webpush from 'web-push';
import strings from '../../shared/i18n/locales/en/companion.json';
import type { AgentWindowStatus, AgentWindowStatusEntry } from '../../shared/types';
import type { CompanionPushSubscription } from '../../shared/types/companion';
import type { TaskHookEvents } from '../task-hooks';
import type { CompanionStore, VapidKeys } from './companion-store';

/** What the phone's service worker shows (src/renderer/public/companion-sw.js) */
export interface CompanionNotification {
  title: string;
  body: string;
  /** A newer notification with the same tag replaces the older one */
  tag: string;
  /** The page opened when the notification is selected */
  url: string;
}

/** Sends one encrypted message; rejects with `statusCode` when the push service refuses it */
export type PushSend = (subscription: CompanionPushSubscription, payload: string, keys: VapidKeys) => Promise<unknown>;

/** VAPID needs a contact; Apple's push service refuses `mailto:` addresses at localhost */
const VAPID_SUBJECT = 'https://github.com/DdraigFawr13/workbench';
/** A notification older than this is no longer worth showing */
const TTL_SECONDS = 60 * 60;

const text = strings.notifications;

/** Fill `{{name}}` placeholders, as i18next does */
function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '');
}

const pageUrl = (projectId: string, taskId?: string) =>
  `/?project=${encodeURIComponent(projectId)}${taskId ? `&task=${encodeURIComponent(taskId)}` : ''}`;

/** States a run is in before a rate limit puts it back in the queue */
const RUNNING_STATES = ['planning', 'coding', 'qa_review', 'qa_fixing'];

/** The notification for a task state, or null when the user need not be told */
export function taskNotification(event: TaskHookEvents['state']): CompanionNotification | null {
  const { project, task, state, previousState, reviewReason } = event;
  // Moves the user made by hand carry no machine state; restored tasks no previous state
  if (!state || !previousState || state === previousState) return null;

  let title: string | null = null;
  if (state === 'human_review') {
    if (reviewReason === 'completed') title = text.task.reviewReady;
    else if (reviewReason === 'qa_rejected') title = text.task.checksFailed;
    else if (reviewReason === 'errors') title = text.task.failed;
    // 'stopped': the user stopped it
  } else if (state === 'error') {
    title = text.task.failed;
  } else if (state === 'queued' && RUNNING_STATES.includes(previousState)) {
    title = text.task.rateLimited;
  } else if (state === 'done' && previousState === 'pr_created') {
    title = text.task.prMerged;
  }
  if (!title) return null;

  return {
    title,
    body: format(text.body, { subject: task.title || task.specId, project: project.name }),
    tag: `task:${project.id}:${task.id}`,
    url: pageUrl(project.id, task.id),
  };
}

/** The notification for an agent window's new status, or null */
export function agentNotification(
  entry: AgentWindowStatusEntry,
  previous: AgentWindowStatus | undefined,
  project: { id: string; name: string } | undefined
): CompanionNotification | null {
  let title: string | null = null;
  if (entry.status === 'needs-input') title = text.agent.needsInput;
  // A turn that ended while the user looked at the window becomes idle, not finished
  else if (entry.status === 'finished' && previous === 'working') title = text.agent.finished;
  if (!title || !project) return null;
  return {
    title,
    body: format(text.body, { subject: entry.title, project: project.name }),
    tag: `agent:${entry.terminalId}`,
    url: pageUrl(project.id),
  };
}

/** The notification sent when a phone switches notifications on */
export function testNotification(): CompanionNotification {
  return { title: text.test.title, body: text.test.body, tag: 'test', url: '/' };
}

/** How web-push signs and sends a message */
export const pushOptions = (keys: VapidKeys): webpush.RequestOptions => ({
  vapidDetails: { subject: VAPID_SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
  TTL: TTL_SECONDS,
  urgency: 'high',
});

const sendWithWebPush: PushSend = (subscription, payload, keys) => webpush.sendNotification(subscription, payload, pushOptions(keys));

export interface CompanionNotifierOptions {
  store: CompanionStore;
  /** Whether the companion is on; nothing is sent while it is off */
  isActive: () => boolean;
  send?: PushSend;
  /** A message that could not be delivered (logged; it never affects the caller) */
  onError?: (error: unknown) => void;
}

export class CompanionNotifier {
  private readonly send: PushSend;

  constructor(private readonly options: CompanionNotifierOptions) {
    this.send = options.send ?? sendWithWebPush;
  }

  /** The public key the phone subscribes with (applicationServerKey) */
  publicKey(): string {
    return this.keys().publicKey;
  }

  private keys(): VapidKeys {
    return this.options.store.getVapidKeys(() => webpush.generateVAPIDKeys());
  }

  /** Send to every phone that switched notifications on, or to one phone */
  async notify(notification: CompanionNotification | null, deviceId?: string): Promise<void> {
    if (!notification || !this.options.isActive()) return;
    const targets = this.options.store
      .listPushSubscriptions()
      .filter((target) => deviceId === undefined || target.deviceId === deviceId);
    if (targets.length === 0) return;
    const keys = this.keys();
    const payload = JSON.stringify(notification);
    await Promise.all(
      targets.map(async ({ subscription }) => {
        try {
          await this.send(subscription, payload, keys);
        } catch (error) {
          const status = (error as { statusCode?: number })?.statusCode;
          // The phone unsubscribed, or the browser dropped the subscription
          if (status === 404 || status === 410) this.options.store.removePushEndpoint(subscription.endpoint);
          else this.options.onError?.(error);
        }
      })
    );
  }
}
