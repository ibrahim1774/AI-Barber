import type { Href } from 'expo-router';

let returnTo: Href | null = null;

/** Where sign-in / sign-up should go back to (the bookings setup, which needed an account first). */
export function setPostAuthReturn(href: Href | null): void {
  returnTo = href;
}

/** One-shot: returns the pending return route and clears it. */
export function takePostAuthReturn(): Href | null {
  const h = returnTo;
  returnTo = null;
  return h;
}
