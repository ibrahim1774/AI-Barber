import { ShopInputs, WebsiteData, ServiceItem } from "../types.ts";
import { LUXE_STOCK, EUPHORIA_STOCK, CRAFT_STOCK } from "../lib/stockImages.ts";

// Template-driven, instant generation. Same pattern PrimeHub's /barber
// niche uses: no Gemini call, no /api/gemini hop, no streaming, no
// runtime image generation. Every site ships with the same hand-picked
// stock photo set (luxe or euphoria) plus copy stitched together from
// the shop name / area / phone the user typed.
//
// Why we abandoned the live API:
//   - Generation took 30–40s end-to-end and frequently 500'd
//   - iOS Safari killed long backgrounded fetches ("Load failed")
//   - "Gemini 2.5 doesn't exist" — the model slug was wrong and we
//     stopped paying to chase it
//
// Tradeoff: every site looks visually similar at first paint. The
// editor then lets the shop owner swap any image and edit any text,
// so the polished default is a starting point, not a ceiling.

// ── Preset image sets ─────────────────────────────────────────────────
//   Neutral sample photos (lib/stockImages.ts) so the site never paints
//   empty. Templates never call them "our work", and the editors nudge
//   the barber to replace them (isStockImage). Gallery slot 0 is the
//   about-section seed; the rest stay empty for the barber's own photos.
const LUXE_IMAGES = LUXE_STOCK;
const EUPHORIA_IMAGES = EUPHORIA_STOCK;
const CRAFT_DEFAULTS = CRAFT_STOCK;

// ── Copy ──────────────────────────────────────────────────────────────
//   Only facts the barber gave us (name, area, phone, ticked services).
//   Everything else is wording true of any barbershop: no claims, no
//   process promises, no invented services, hours, policies or email.

const buildCopy = (shopName: string, area: string): {
  heroHeading: string;
  heroTagline: string;
  aboutHeading: string;
  aboutDescription: string[];
} => ({
  heroHeading: shopName,
  heroTagline: 'Book your next visit.',
  aboutHeading: 'About the Shop',
  aboutDescription: [
    `${shopName} is a barbershop${area ? ` in ${area}` : ''}. Get in touch to book your next appointment.`,
  ],
});

const SERVICE_ICONS: ServiceItem['icon'][] = ['scissors', 'razor', 'mustache', 'face', 'sparkles'];

// The barber's ticked services, verbatim. No descriptions are written for
// them; an empty price stays empty.
const toServices = (picked: ShopInputs['services']): ServiceItem[] =>
  (picked || [])
    .map((s) => ({ title: String(s?.title || '').trim(), price: String(s?.price || '').trim() }))
    .filter((s) => s.title)
    .map((s, i) => ({
      title: s.title,
      subtitle: '',
      description: '',
      icon: SERVICE_ICONS[i % SERVICE_ICONS.length],
      imageUrl: '',
      ...(s.price ? { price: s.price } : {}),
    }));

export const generateContent = async (inputs: ShopInputs): Promise<WebsiteData> => {
  const shopName = (inputs.shopName || 'Your Barbershop').trim();
  const area = (inputs.area || '').trim();
  const phone = (inputs.phone || '').trim();
  const template = inputs.template === 'euphoria' ? 'euphoria' : 'luxe';

  const images = template === 'euphoria' ? EUPHORIA_IMAGES : LUXE_IMAGES;
  const copy = buildCopy(shopName, area);

  // Tiny artificial delay — the loading screen reads better with a
  // ~250ms ramp than a single-frame flip from form → editor.
  await new Promise((r) => setTimeout(r, 250));

  return {
    shopName,
    area,
    phone,
    template,
    bookingUrl: inputs.bookingUrl || undefined,
    // Carry the picked color theme onto the site so the renderer can
    // restore the matching canvas + accent after publish.
    colorTheme: inputs.colorTheme || 'goldBlack',
    hero: {
      heading: copy.heroHeading,
      tagline: copy.heroTagline,
      imageUrl: images.hero,
    },
    about: {
      heading: copy.aboutHeading,
      description: copy.aboutDescription,
      imageUrl: images.about,
    },
    // Only what the barber ticked; none → [] and every template hides
    // its Services section.
    services: toServices(inputs.services),
    // 6-slot gallery — slot 0 is the about-section seed, slots 1..5
    // are left empty for the barber's own photos. "The Craft" lives on a separate
    // craftImages array so the two sections never share slots.
    gallery: [images.gallerySeed, '', '', '', '', ''],
    // "The Craft" — 4 pre-seeded atmospheric shots, replaceable.
    craftImages: [...CRAFT_DEFAULTS],
    contact: {
      address: area,
      // Never invented: empty until the barber types one.
      email: '',
    },
  };
};
