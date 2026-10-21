/** What can be shared. A union so the Bookings and Store plans can add 'booking' | 'shop'. */
export type ShareKind = 'website';

export type ShareLink = { kind: ShareKind; url: string };

/** The pre-written message that goes out with a link. The URL appears exactly once. */
export function shareMessage(kind: ShareKind, shopName: string, url: string): string {
  const name = shopName.trim();
  switch (kind) {
    case 'website':
      return name ? `Check out ${name}'s new website: ${url}` : `Check out our new website: ${url}`;
  }
}

/** The link's label in the Share sheet. */
export function shareLabel(kind: ShareKind): string {
  switch (kind) {
    case 'website':
      return 'Website link';
  }
}

/** The URL without its scheme, for display. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
