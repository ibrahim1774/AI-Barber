/**
 * Jest stand-in for expo-notifications: local scheduling and permissions in
 * memory. `nt` lets a test set the permission answer, read what is scheduled,
 * and deliver a tap.
 */
type Perm = 'granted' | 'denied' | 'undetermined';
type Request = { identifier: string; content: { title?: string; body?: string; data?: Record<string, unknown> }; trigger: any };
type Response = { actionIdentifier: string; notification: { date: number; request: Request } };

let nextId = 1;

export const nt = {
  status: 'undetermined' as Perm,
  /** What the system prompt answers. */
  answer: 'granted' as Perm,
  requests: 0,
  scheduled: [] as Request[],
  listeners: [] as ((r: Response) => void)[],
  lastResponse: null as Response | null,
  reset() {
    this.status = 'undetermined';
    this.answer = 'granted';
    this.requests = 0;
    this.scheduled = [];
    this.listeners = [];
    this.lastResponse = null;
  },
  /** A tap on a scheduled-looking notification with this data. */
  tap(data: Record<string, unknown>, identifier = `tap-${nextId++}`): Response {
    const r: Response = {
      actionIdentifier: DEFAULT_ACTION_IDENTIFIER,
      notification: { date: Date.now(), request: { identifier, content: { title: 'AI Barber', body: 'b', data }, trigger: null } },
    };
    this.lastResponse = r;
    for (const l of [...this.listeners]) l(r);
    return r;
  },
};

export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

export enum SchedulableTriggerInputTypes {
  CALENDAR = 'calendar',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  DATE = 'date',
  TIME_INTERVAL = 'timeInterval',
}

const perm = () => ({
  status: nt.status,
  granted: nt.status === 'granted',
  canAskAgain: nt.status === 'undetermined',
  expires: 'never' as const,
});

export async function getPermissionsAsync() {
  return perm();
}

export async function requestPermissionsAsync(_opts?: unknown) {
  nt.requests++;
  if (nt.status === 'undetermined') nt.status = nt.answer;
  return perm();
}

export async function scheduleNotificationAsync(req: { content: Request['content']; trigger: any; identifier?: string }) {
  const identifier = req.identifier ?? `n-${nextId++}`;
  nt.scheduled.push({ identifier, content: req.content, trigger: req.trigger });
  return identifier;
}

export async function cancelAllScheduledNotificationsAsync() {
  nt.scheduled = [];
}

export async function getAllScheduledNotificationsAsync() {
  return [...nt.scheduled];
}

export function addNotificationResponseReceivedListener(l: (r: Response) => void) {
  nt.listeners.push(l);
  return {
    remove() {
      nt.listeners = nt.listeners.filter((x: (r: Response) => void) => x !== l);
    },
  };
}

export function getLastNotificationResponse() {
  return nt.lastResponse;
}

export function clearLastNotificationResponse() {
  nt.lastResponse = null;
}

export async function getLastNotificationResponseAsync() {
  return nt.lastResponse;
}

export async function clearLastNotificationResponseAsync() {
  nt.lastResponse = null;
}
