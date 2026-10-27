/**
 * State matrix, part 2: the SCREENS. One row per user-reachable screen; adding a screen is one entry.
 *
 * `unreachable` documents, per state id, why a screen cannot be opened in that state (the cell is then skipped, not
 * silently dropped). Reasons are about the app's real navigation, not about what is convenient to test:
 *  - claim lock (ClaimGuard): while a paid publish waits for its account (states with claimLocked: S3, S7b, S9d) every
 *    path but /claim, /publishing, /forgot-password and /reset-password is redirected to /claim. Screens without
 *    `allowedWhenLocked` are therefore unreachable in those states (derived, not listed per cell).
 *  - no site (hasSite false: S1, S9c): the app opens on /start; screens with `needsSite` are reached only from a site.
 *  - `unreachable` lists the remaining exceptions by hand, each with its reason.
 */
export type ScreenDef = {
  id: string;
  title: string;
  /** Lazily required so each cell gets a fresh module registry (jest.resetModules). */
  load(): React.ComponentType<any>;
  /** Only reachable once a site record exists on the phone. */
  needsSite?: boolean;
  /** Still open while the app is locked to the account step (ClaimGuard's CLAIM_ALLOWED_PATHS). */
  allowedWhenLocked?: boolean;
  /**
   * What the user does on the screen's behalf once it is up (before the answers are flushed twice): returns the action.
   * Publishing: the paywall opens over it and the user closes it. Receives the e2e World.
   */
  prime?(world: any): () => Promise<void> | void;
  /** state id -> why it is unreachable (beyond the derived needsSite / claim-lock rules). */
  unreachable?: Record<string, string>;
  /**
   * What the settled screen must say, per state id (or '*' for every state without its own entry): a regex the screen
   * text must match. `forbids` the opposite: text that would be wrong there (e.g. "set up bookings" for a paying
   * user whose lookup merely failed). Beyond "no spinner, a way forward", this is what pins the RIGHT exit.
   */
  expects?: Record<string, RegExp>;
  forbids?: Record<string, RegExp>;
};

/* eslint-disable @typescript-eslint/no-require-imports */
export const SCREENS: ScreenDef[] = [
  { id: 'edit', title: 'Edit tab', load: () => require('@/app/(tabs)/edit').default, needsSite: true },
  { id: 'bookings', title: 'Bookings tab', load: () => require('@/app/(tabs)/bookings').default, needsSite: true , expects: {
    S2a: /Publish your website to unlock Bookings/, S2b: /Publish your website to unlock Bookings/, S2c: /Publish your website to unlock Bookings/,
    S4: /You need a plan to use Bookings/, S5: /^Bookings \|/, S6: /^Bookings \|/, S7: /another Prime Barber account/,
    S8a: /Your booking page is paused/, S8b: /You need a plan to use Bookings/, S8c: /You need a plan to use Bookings/,
    S9a: /Publish your website to unlock Bookings/, S9b: /Couldn't load your plan[\s\S]*Try again/, S10: /Publish your website to unlock Bookings/,
    S11: /Couldn't load your plan[\s\S]*Try again/, S12: /^Bookings \|/,
  }, forbids: { S11: /paused|Upgrade|You need a plan/, S2a: /You need a plan/, S2b: /You need a plan/, S2c: /You need a plan/, S9a: /You need a plan/, S10: /You need a plan/ } },
  { id: 'store', title: 'Store tab', load: () => require('@/app/(tabs)/store').default, needsSite: true , expects: {
    S2a: /Publish your website to unlock the Store/, S2b: /Publish your website to unlock the Store/, S2c: /Publish your website to unlock the Store/,
    S4: /You need a plan to use the Store/, S5: /You need a plan to use the Store/, S6: /^Store \|/, S7: /another Prime Barber account/,
    S8a: /You need a plan to use the Store/, S8b: /You need a plan to use the Store/, S8c: /You need a plan to use the Store/,
    S9a: /Publish your website to unlock the Store/, S9b: /Couldn't load your plan[\s\S]*Try again/, S10: /Publish your website to unlock the Store/,
    S11: /Couldn't load your plan[\s\S]*Try again/, S12: /You need a plan to use the Store/,
  }, forbids: { S2a: /You need a plan/, S2b: /You need a plan/, S2c: /You need a plan/, S9a: /You need a plan/, S10: /You need a plan/ } },
  { id: 'settings', title: 'Settings tab', load: () => require('@/app/(tabs)/settings/index').default , expects: { S1: /Sign in/, S2a: /Sign in/, S4: /Live/, S5: /Live/, S6: /Live/, S8a: /Offline/, S8b: /Offline/, S8c: /Offline/, S9c: /Sign in/ }  },
  { id: 'learn', title: 'Learn', load: () => require('@/app/(tabs)/settings/learn/index').default },
  { id: 'claim', title: 'Claim (account step)', load: () => require('@/app/claim').default, allowedWhenLocked: true , expects: { S3: /Create your account/, S7b: /Use a different account/, S9d: /Publishing your site[\s\S]*Waiting for connection[\s\S]*Try again/ }, forbids: { S9d: /Create your account|Create Account & Publish/ }  },
  { id: 'start', title: 'Start screen', load: () => require('@/app/start').default , expects: { '*': /Barbers: get a website, take bookings/ }  },
  { id: 'sign-in', title: 'Sign in', load: () => require('@/app/sign-in').default , expects: { '*': /Sign In/ }  },
  { id: 'publishing', title: 'Publishing overlay', load: () => require('@/app/publishing').default, needsSite: true, allowedWhenLocked: true,
    // Not entitled: the native paywall opens over the clear overlay and is closed without buying; entitled: it publishes.
    prime: (world) => world.willDecline() },
  { id: 'live', title: 'Live screen', load: () => require('@/app/live').default, needsSite: true },
  { id: 'bookings-setup', title: 'Bookings setup', load: () => require('@/app/bookings-setup').default, needsSite: true , expects: { S2a: /You need a plan/, S5: /Set up bookings/, S7: /another Prime Barber account/, S9b: /Try again/ }  },
  { id: 'store-setup', title: 'Store setup', load: () => require('@/app/store-setup').default, needsSite: true , expects: { S2a: /You need a plan/, S6: /Store setup/, S7: /another Prime Barber account/, S9b: /Try again/ }  },
  { id: 'customers', title: 'Customers', load: () => require('@/app/customers/index').default, needsSite: true , expects: { S5: /No customers yet/, S6: /No customers yet/, S4: /Set up Bookings/, S9b: /Couldn't load customers/ }  },
  { id: 'team', title: 'Team', load: () => require('@/app/team').default, needsSite: true, expects: { S9b: /Couldn't load your team[\s\S]*Try again/ }, forbids: { S9b: /Set up bookings/i } },
  { id: 'domain', title: 'Domain', load: () => require('@/app/domain').default, needsSite: true },
  { id: 'get-paid', title: 'Get paid', load: () => require('@/app/get-paid').default, needsSite: true , expects: { S5: /In the shop/, S6: /In the shop/, S2a: /Set up bookings first/, S9b: /Couldn't load your shop[\s\S]*Try again/ },
    // A paying user whose shop lookup only failed must not be told to set bookings up from scratch.
    forbids: { S9b: /Set up bookings first/, S5: /Set up bookings first/, S6: /Set up bookings first/ }  },
];

/** Why (if at all) `screen` cannot be opened in `state`. */
export function unreachableReason(screen: ScreenDef, state: { id: string; hasSite: boolean; claimLocked?: boolean }): string | null {
  if (screen.unreachable?.[state.id]) return screen.unreachable[state.id];
  if (state.claimLocked && !screen.allowedWhenLocked) return 'claim lock: ClaimGuard redirects every other path to /claim';
  if (!state.hasSite && screen.needsSite) return 'no site on the phone: the app opens on /start, nothing links here';
  return null;
}
