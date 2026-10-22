// Booksy is a beauty/wellness marketplace, not a barber-only one — the
// categories it publishes on its own browse page, in its order, are:
//   Hair · Barber · Nails · Skin care · Brows and lashes · Massage ·
//   Makeup · Wellness and spa · Braids and locs · Tattoos ·
//   Medical aesthetics · Hair removal · Home services · Piercing ·
//   Pet services · Dental and orthodontics · Health and fitness
//
// Every generated site used to call itself a "barbershop" with grooming
// copy no matter who pasted the link, so a nail tech or lash artist got
// a site that talked about haircuts. This module works out what the
// business actually is from the Booksy link (the canonical Booksy path
// carries the category: /en-us/{id}_{name}_{category}_{cityId}_{city}),
// with the shop name and scraped service titles as backup signals.

export interface BooksyNiche {
  key: string;
  // What the CRM row / lead webhook should say the business is.
  industry: string;
  // Noun used in generated sentences ("a nail salon").
  noun: string;
  // Generic welcome copy for when the source gave us nothing. True of any
  // business of this kind: no process promises, no claims.
  heroTagline: string;
  aboutHeading: string;
  aboutFallback: [string, string];
  fallbackName: string;
}

const BARBER: BooksyNiche = {
  key: 'barber',
  industry: 'Barbershop',
  noun: 'barbershop',
  heroTagline: 'Book your next visit.',
  aboutHeading: 'About the Shop',
  aboutFallback: [
    'is a barbershop.',
    'Get in touch to book your next appointment.',
  ],
  fallbackName: 'Your Barbershop',
};

// Ordered most-specific first: "lash" must beat "hair" for a brow & lash
// studio, "braids" must beat "hair" for a braiding shop.
export const BOOKSY_NICHES: Array<BooksyNiche & { keywords: string[] }> = [
  {
    ...BARBER,
    keywords: ['barber', 'barbershop', 'barber-shop', 'fade', 'beard', 'lineup', 'line-up', 'taper'],
  },
  {
    key: 'lashes', industry: 'Lash & Brow Studio', noun: 'lash and brow studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a lash and brow studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Lash Studio',
    keywords: ['lash', 'brow', 'eyelash', 'eyebrow', 'microblad', 'extensions-lash', 'lamination'],
  },
  {
    key: 'braids', industry: 'Braiding & Locs Salon', noun: 'braiding salon',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a braiding salon.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Braiding Salon',
    keywords: ['braid', 'locs', 'loc ', 'dreadlock', 'twist', 'cornrow', 'crochet', 'weave', 'sew-in'],
  },
  {
    key: 'nails', industry: 'Nail Salon', noun: 'nail salon',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a nail salon.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Nail Salon',
    keywords: ['nail', 'manicure', 'pedicure', 'mani', 'pedi', 'gel-x', 'acrylic', 'polish'],
  },
  {
    key: 'medspa', industry: 'Medical Aesthetics', noun: 'medical aesthetics clinic',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Clinic',
    aboutFallback: [
      'is a medical aesthetics clinic.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Clinic',
    keywords: ['med-spa', 'medspa', 'med spa', 'botox', 'filler', 'injectable', 'aesthetics-medical', 'medical-aesthetic', 'prp', 'lipo', 'coolsculpt', 'iv-therapy'],
  },
  {
    key: 'skin', industry: 'Skin Care Studio', noun: 'skin care studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a skin care studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Skin Studio',
    keywords: ['skin', 'facial', 'esthetic', 'aesthetic', 'derma', 'peel', 'microneedl', 'hydrafacial', 'acne'],
  },
  {
    key: 'massage', industry: 'Massage & Spa', noun: 'massage studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a massage studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Massage Studio',
    keywords: ['massage', '=spa', '=spas', 'bodywork', 'deep-tissue', 'deep tissue', 'reflexolog', 'sauna', 'wellness'],
  },
  {
    key: 'waxing', industry: 'Waxing & Hair Removal', noun: 'waxing studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a waxing studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Waxing Studio',
    keywords: ['wax', 'sugaring', 'hair-removal', 'hair removal', 'laser-hair', 'threading'],
  },
  {
    key: 'makeup', industry: 'Makeup Artist', noun: 'makeup studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a makeup studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Makeup Studio',
    keywords: ['makeup', 'make-up', 'mua', 'bridal-makeup', 'glam'],
  },
  {
    key: 'tattoo', industry: 'Tattoo & Piercing Studio', noun: 'tattoo studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a tattoo studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Tattoo Studio',
    keywords: ['tattoo', 'piercing', '=ink', 'body-art', 'pierc'],
  },
  {
    key: 'pet', industry: 'Pet Grooming', noun: 'pet grooming salon',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a pet grooming salon.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Grooming Salon',
    keywords: ['=pet', '=pets', 'dog-groom', 'grooming-pet', 'puppy', 'canine', 'doggy', 'pet-service'],
  },
  {
    key: 'fitness', industry: 'Fitness & Training', noun: 'training studio',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a training studio.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Training Studio',
    keywords: ['fitness', 'personal-train', 'personal train', 'gym', 'yoga', 'pilates', 'coach'],
  },
  {
    key: 'dental', industry: 'Dental & Orthodontics', noun: 'dental practice',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Practice',
    aboutFallback: [
      'is a dental practice.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Practice',
    keywords: ['dental', 'dentist', 'orthodont', 'teeth', 'braces', 'invisalign', 'whitening-teeth', 'hygienist'],
  },
  {
    key: 'health', industry: 'Health & Wellness', noun: 'wellness clinic',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Clinic',
    aboutFallback: [
      'is a wellness clinic.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Clinic',
    keywords: ['chiro', 'physio', 'physical-therapy', 'acupunctur', 'nutrition', 'dietit', 'therapy-clinic', 'rehabilitation', 'osteopath', 'podiatr'],
  },
  {
    key: 'home', industry: 'Home Services', noun: 'home services company',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About Us',
    aboutFallback: [
      'is a home services company.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Company',
    keywords: ['cleaning', 'housekeep', 'handyman', 'plumb', 'electric', 'hvac', 'landscap', 'lawn', 'pest', 'moving', 'junk-removal', 'pressure-wash', 'carpet-clean', 'window-clean', 'home-service', 'repair'],
  },
  {
    key: 'professional', industry: 'Professional Services', noun: 'local business',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About Us',
    aboutFallback: [
      'is a local business.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Business',
    keywords: ['photograph', 'videograph', 'tutor', 'consult', 'coaching', 'legal', 'attorney', 'account', 'bookkeep', 'notary', 'insurance', 'real-estate', 'event-plan', 'catering', 'professional-service'],
  },
  {
    key: 'hair', industry: 'Hair Salon', noun: 'hair salon',
    heroTagline: 'Book your next appointment.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a hair salon.',
      'Get in touch to book your next appointment.',
    ],
    fallbackName: 'Your Salon',
    keywords: ['hair-salon', 'hair salon', 'hairdress', 'hairstyl', 'stylist', 'blowout', 'balayage', 'color-salon', 'keratin', 'hair'],
  },
];

// Everything the detector reads: the Booksy URL (its path carries the
// category), the shop name, and the scraped service titles.
export function detectBooksyNiche(
  url: string,
  shopName?: string,
  serviceTitles?: string[],
): BooksyNiche {
  const haystack = [
    (url || '').toLowerCase(),
    (shopName || '').toLowerCase(),
    (serviceTitles || []).join(' ').toLowerCase(),
  ].join(' ');
  if (!haystack.trim()) return BARBER;
  // Word-aware matching. Naive substring matching mis-fires badly on
  // real shop names — "Sparkle Home Cleaning" contains "spa" and was
  // being read as a massage studio. Rules:
  //   "=word"        → the token must equal it exactly (short, ambiguous
  //                    words like spa / pet)
  //   "two words"    → substring, for phrases the tokenizer would split
  //   anything else  → a token must START with it, so "nail" catches
  //                    "nails" and "wax" catches "waxing" without
  //                    matching mid-word inside an unrelated name.
  const tokens = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  const hits = (keyword: string): boolean => {
    if (keyword.startsWith('=')) return tokens.includes(keyword.slice(1));
    if (/[\s-]/.test(keyword)) return haystack.includes(keyword);
    return tokens.some((t) => t.startsWith(keyword));
  };
  for (const n of BOOKSY_NICHES) {
    if (n.keywords.some(hits)) {
      const { keywords, ...profile } = n;
      return profile;
    }
  }
  return BARBER;
}

export const DEFAULT_BOOKSY_NICHE = BARBER;

// Profile for a stored WebsiteData.niche key. Unknown / absent → barber,
// so sites saved before the key existed keep calling themselves a
// barbershop exactly as before.
export function nicheByKey(key?: string | null): BooksyNiche {
  if (!key) return BARBER;
  const hit = BOOKSY_NICHES.find((n) => n.key === key);
  if (!hit) return BARBER;
  const { keywords, ...profile } = hit;
  return profile;
}
