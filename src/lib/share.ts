/** What can be shared. */
export type ShareKind = 'booking' | 'website' | 'shop';

export type ShareLink = { kind: ShareKind; url: string };

/** The pre-written message that goes out with a link. The URL appears exactly once. */
export function shareMessage(kind: ShareKind, shopName: string, url: string): string {
  const name = shopName.trim();
  switch (kind) {
    case 'booking':
      return name ? `Book your next cut at ${name} 💈 ${url}` : `Book your next cut 💈 ${url}`;
    case 'website':
      return name ? `Check out ${name}'s new website: ${url}` : `Check out our new website: ${url}`;
    case 'shop':
      return name ? `${name} now sells online: ${url}` : `Shop online: ${url}`;
  }
}

/** The link's label in the Share sheet. */
export function shareLabel(kind: ShareKind): string {
  switch (kind) {
    case 'booking':
      return 'Booking link';
    case 'website':
      return 'Website link';
    case 'shop':
      return 'Shop link';
  }
}

/** The URL without its scheme, for display. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The link Copy / Instagram bio / QR use: the row the barber picked, else the link of the entry point they came from, else the first. */
export function pickLink(links: ShareLink[], selected: ShareKind | null, entry: ShareKind | undefined): ShareLink | undefined {
  return (
    (selected && links.find((l) => l.kind === selected)) ||
    (entry && links.find((l) => l.kind === entry)) ||
    links[0]
  );
}
