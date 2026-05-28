import { ShopInputs, WebsiteData, ServiceItem } from "../types.ts";

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
//   Hero + about + gallery seed for each of the two templates. Gallery
//   has 6 slots total; we fill the first one with a curated shot so the
//   site never paints with an empty grid, and leave the rest empty for
//   the shop owner to upload their real work.

const LUXE_IMAGES = {
  hero:
    'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=1600&q=70',
  about:
    'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=70',
  gallerySeed:
    'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=65',
};

const EUPHORIA_IMAGES = {
  hero:
    'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=1600&q=70',
  about:
    'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1200&q=70',
  gallerySeed:
    'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=900&q=65',
};

// ── Copy templates ────────────────────────────────────────────────────
//   Universal/compliant wording — no fake credentials, no decades-of-
//   experience claims, no awards. Reads as a real shop's first website,
//   not a generated landing page. Placeholders are filled by hand below
//   instead of with a {{token}} pass because the substitution surface
//   is tiny.

const buildLuxe = (shopName: string, area: string): {
  heroHeading: string;
  heroTagline: string;
  aboutHeading: string;
  aboutDescription: string[];
  services: Omit<ServiceItem, 'imageUrl'>[];
} => ({
  heroHeading: shopName,
  heroTagline: 'Premium grooming, considered every step.',
  aboutHeading: 'Built around the cut.',
  aboutDescription: [
    `${shopName} is a neighborhood barbershop in ${area} built around honest work and consistent craft. Every visit starts with a real conversation and ends with a cut you can wear with confidence.`,
  ],
  services: [
    {
      title: 'Classic Haircut',
      subtitle: 'Cut, washed, styled',
      description: 'A clean, considered cut tailored to how you actually wear your hair.',
      icon: 'scissors',
    },
    {
      title: 'Beard Trim & Styling',
      subtitle: 'Shaped and finished',
      description: 'Defined lines, blended length, and a finish that holds between visits.',
      icon: 'mustache',
    },
    {
      title: 'Hot Towel Shave',
      subtitle: 'Straight razor, classic finish',
      description: 'A traditional straight-razor shave with warm towels and a clean, close finish.',
      icon: 'razor',
    },
    {
      title: 'Skin Fade',
      subtitle: 'Sharp, blended, exact',
      description: 'Precise tapering from skin upward, blended for a clean, modern shape.',
      icon: 'face',
    },
    {
      title: 'Hair & Scalp Treatment',
      subtitle: 'Cleanse and condition',
      description: 'A thorough cleanse and conditioning treatment to reset the scalp.',
      icon: 'sparkles',
    },
  ],
});

const buildEuphoria = (shopName: string, area: string): ReturnType<typeof buildLuxe> => ({
  heroHeading: shopName,
  heroTagline: 'Hand-cut, head by head.',
  aboutHeading: 'Craft, character, and community.',
  aboutDescription: [
    `${shopName} is a barbershop in ${area} built around the cut you want — sharp, considered, and made for the people we serve. Every appointment is real conversation followed by real craft.`,
  ],
  services: [
    {
      title: 'Classic Haircut',
      subtitle: 'Cut, washed, finished',
      description: 'A clean, considered cut shaped around how you actually wear your hair.',
      icon: 'scissors',
    },
    {
      title: 'Beard Trim & Styling',
      subtitle: 'Shaped and refined',
      description: 'Defined edges and blended length — a finish that reads on and off the chair.',
      icon: 'mustache',
    },
    {
      title: 'Hot Towel Shave',
      subtitle: 'Straight razor, traditional',
      description: 'Warm towels and a straight razor, finished close and clean.',
      icon: 'razor',
    },
    {
      title: 'Skin Fade',
      subtitle: 'Tapered, blended, exact',
      description: 'Precise skin-up tapering blended into a clean, modern shape.',
      icon: 'face',
    },
    {
      title: 'Hair & Scalp Treatment',
      subtitle: 'Reset and condition',
      description: 'A deep cleanse and conditioning treatment to reset the scalp between cuts.',
      icon: 'sparkles',
    },
  ],
});

const buildEmail = (shopName: string): string => {
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'contact';
  return `contact@${slug}.com`;
};

export const generateContent = async (inputs: ShopInputs): Promise<WebsiteData> => {
  const shopName = (inputs.shopName || 'Your Barbershop').trim();
  const area = (inputs.area || '').trim();
  const phone = (inputs.phone || '').trim();
  const template = inputs.template === 'euphoria' ? 'euphoria' : 'luxe';

  const images = template === 'euphoria' ? EUPHORIA_IMAGES : LUXE_IMAGES;
  const copy = template === 'euphoria' ? buildEuphoria(shopName, area) : buildLuxe(shopName, area);

  // Tiny artificial delay — the loading screen reads better with a
  // ~250ms ramp than a single-frame flip from form → editor.
  await new Promise((r) => setTimeout(r, 250));

  return {
    shopName,
    area,
    phone,
    template,
    bookingUrl: inputs.bookingUrl || undefined,
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
    services: copy.services.map((s) => ({ ...s, imageUrl: '' })),
    // 6-slot gallery: first slot pre-filled, rest empty for the shop
    // owner to upload their actual work.
    gallery: [images.gallerySeed, '', '', '', '', ''],
    // Hero feature cards — every value here is editable in the preview.
    // Defaults to a Mon-Fri schedule with normal shop hours so no shop
    // ever ships with a vague "Open Daily" claim.
    featureCards: [
      { title: 'Experience', sub: 'Professional' },
      { title: 'Service', sub: 'Trusted' },
      { title: 'Open Monday to Friday', sub: '9am - 7pm' },
    ],
    contact: {
      address: area,
      email: buildEmail(shopName),
    },
  };
};
