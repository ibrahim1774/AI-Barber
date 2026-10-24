import Storage from 'expo-sqlite/kv-store';

/**
 * The guided tours. Each tour belongs to one screen; its steps point at targets that screen registers with
 * useTutorialTarget(id). A step whose target is missing is shown centred, so a tour never breaks a screen.
 */
export type TourScreen = 'edit' | 'bookings' | 'store' | 'getpaid';
export type TourId = 'edit' | 'bookings' | 'store' | 'getpaid' | 'publishing';

/** `target` null = a tip with nothing to point at (shown centred). */
export interface TourStep { target: string | null; tip: string }
export interface Tour {
  id: TourId;
  screen: TourScreen;
  /** The Settings row that replays it. */
  label: string;
  /** Opens by itself the first time its screen is used (the Edit tour rides on the first-site guide instead). */
  auto: boolean;
  steps: TourStep[];
}

export const TOURS: Record<TourId, Tour> = {
  edit: {
    id: 'edit', screen: 'edit', label: 'Editing your site', auto: false,
    steps: [
      { target: 'edit.publish', tip: 'Tap Publish to put your site online. You can edit it any time.' },
      { target: 'edit.sections', tip: 'Sections: services, team, hours and the rest of your page.' },
      { target: 'edit.pages', tip: 'Pages: turn pages on or off, add suggested pages like FAQ, change their order, and tap one to see it. On a page, Edit page lets you hide, move and reword its sections.' },
      { target: 'edit.text', tip: 'Text: change any wording on your site. Colour, on the left of the preview, sets the look.' },
      { target: 'edit.changeImage', tip: 'Tap Change image on any picture to swap it. Photos, below, lists them all.' },
    ],
  },
  bookings: {
    id: 'bookings', screen: 'bookings', label: 'Taking bookings', auto: true,
    steps: [
      { target: 'bookings.views', tip: 'Switch between Day, Week and Month. Your choice is remembered.' },
      { target: 'bookings.add', tip: 'Tap + to add a walk-in booking or block time off.' },
      { target: 'bookings.setup', tip: 'Setup: services, barbers and opening hours.' },
    ],
  },
  store: {
    id: 'store', screen: 'store', label: 'Selling products', auto: true,
    steps: [
      { target: 'store.header', tip: 'Store setup is here: open or close your shop and set pickup details.' },
      { target: 'store.tabs', tip: 'Products you sell, and the orders that come in.' },
    ],
  },
  getpaid: {
    id: 'getpaid', screen: 'getpaid', label: 'Getting paid', auto: true,
    steps: [
      { target: 'getpaid.cards', tip: 'Choose how clients pay you: in the shop, with a handle like Cash App, or by card through Stripe.' },
    ],
  },
  publishing: {
    id: 'publishing', screen: 'edit', label: 'Publishing', auto: false,
    steps: [
      { target: 'edit.publish', tip: 'Publish puts your latest changes online. Do it again whenever you edit.' },
      { target: null, tip: 'Once your site is live, your booking and shop links appear in Settings and in Share.' },
    ],
  },
};

/** Where each tour's screen lives (Settings replay and the Tutorial topics both navigate here). */
export const TOUR_ROUTE = { edit: '/edit', bookings: '/bookings', store: '/store', getpaid: '/get-paid' } as const;

/** The order Settings lists them in. */
export const TOUR_ORDER: TourId[] = ['edit', 'bookings', 'store', 'getpaid', 'publishing'];

// ---- flags -------------------------------------------------------------------

/** Per install, not per draft: a new or adopted site does not bring the tours back. */
export const tourFlagKey = (id: TourId) => `tutorial:${id}:v1`;

/** False when unset or unreadable. */
export async function hasTourSeen(id: TourId): Promise<boolean> {
  try {
    return (await Storage.getItem(tourFlagKey(id))) === '1';
  } catch {
    return false;
  }
}

export async function markTourSeen(id: TourId): Promise<void> {
  try {
    await Storage.setItem(tourFlagKey(id), '1');
  } catch {
    // an unwritable flag only means the tour can show again
  }
}

// ---- replay from Settings ----------------------------------------------------

let requested: TourId | null = null;

/** Settings' replay: the tour's screen picks it up the next time it is focused (ignoring the seen flag). */
export function requestTour(id: TourId): void {
  requested = id;
}

/** The pending replay if it belongs to `screen`; clears it. */
export function takeTourRequest(screen: TourScreen): TourId | null {
  if (requested && TOURS[requested].screen === screen) {
    const id = requested;
    requested = null;
    return id;
  }
  return null;
}

export function resetTourRequestForTests(): void {
  requested = null;
}

/** The Edit tour starts only after account setup and a first generated site (spec: "after account setup"). */
export function editTourReady(s: { overlay: string | null; hasSite: boolean; signedIn: boolean }): boolean {
  return s.overlay === 'guide' && s.hasSite && s.signedIn;
}
