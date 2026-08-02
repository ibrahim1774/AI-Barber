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
  // Noun used in generated sentences ("a neighborhood nail salon").
  noun: string;
  heroTagline: string;
  aboutHeading: string;
  aboutFallback: [string, string];
  fallbackName: string;
}

const BARBER: BooksyNiche = {
  key: 'barber',
  industry: 'Barbershop',
  noun: 'barbershop',
  heroTagline: 'Premium grooming services tailored to your style.',
  aboutHeading: 'About the Shop',
  aboutFallback: [
    'is a neighborhood barbershop built around honest work and consistent craft.',
    'Every visit starts with a real conversation and ends with a cut you can wear with confidence.',
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
    heroTagline: 'Lash and brow work done with a careful, steady hand.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a lash and brow studio built around detail and a comfortable appointment.',
      'Every set is shaped to suit your eyes, your routine, and how much upkeep you want.',
    ],
    fallbackName: 'Your Lash Studio',
    keywords: ['lash', 'brow', 'eyelash', 'eyebrow', 'microblad', 'extensions-lash', 'lamination'],
  },
  {
    key: 'braids', industry: 'Braiding & Locs Salon', noun: 'braiding salon',
    heroTagline: 'Braids and locs styled with patience and care.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a braiding and locs salon built around protective styles that last.',
      'Every appointment is unhurried, so your style is installed the way it should be.',
    ],
    fallbackName: 'Your Braiding Salon',
    keywords: ['braid', 'locs', 'loc ', 'dreadlock', 'twist', 'cornrow', 'crochet', 'weave', 'sew-in'],
  },
  {
    key: 'nails', industry: 'Nail Salon', noun: 'nail salon',
    heroTagline: 'Nail care that lasts, in a space you can relax in.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a neighborhood nail salon built around clean work and careful detail.',
      'Every appointment is unhurried, so your set is finished the way you want it.',
    ],
    fallbackName: 'Your Nail Salon',
    keywords: ['nail', 'manicure', 'pedicure', 'mani', 'pedi', 'gel-x', 'acrylic', 'polish'],
  },
  {
    key: 'medspa', industry: 'Medical Aesthetics', noun: 'medical aesthetics clinic',
    heroTagline: 'Aesthetic treatments planned around what you actually want changed.',
    aboutHeading: 'About the Clinic',
    aboutFallback: [
      'is a medical aesthetics clinic built around careful assessment before any treatment.',
      'Every visit starts with a consultation so the plan fits your face and your budget.',
    ],
    fallbackName: 'Your Clinic',
    keywords: ['med-spa', 'medspa', 'med spa', 'botox', 'filler', 'injectable', 'aesthetics-medical', 'medical-aesthetic', 'prp', 'lipo', 'coolsculpt', 'iv-therapy'],
  },
  {
    key: 'skin', industry: 'Skin Care Studio', noun: 'skin care studio',
    heroTagline: 'Facials and skin treatments matched to your skin.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a skin care studio built around treatments that suit your skin, not a script.',
      'Every appointment starts with a proper look at your skin before anything else.',
    ],
    fallbackName: 'Your Skin Studio',
    keywords: ['skin', 'facial', 'esthetic', 'aesthetic', 'derma', 'peel', 'microneedl', 'hydrafacial', 'acne'],
  },
  {
    key: 'massage', industry: 'Massage & Spa', noun: 'massage studio',
    heroTagline: 'Massage and bodywork in a calm, unhurried space.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a massage studio built around real bodywork and a calm room.',
      'Every session is adjusted to how you feel that day, not a fixed routine.',
    ],
    fallbackName: 'Your Massage Studio',
    keywords: ['massage', 'spa', 'bodywork', 'deep-tissue', 'deep tissue', 'reflexolog', 'sauna', 'wellness'],
  },
  {
    key: 'waxing', industry: 'Waxing & Hair Removal', noun: 'waxing studio',
    heroTagline: 'Hair removal done quickly, cleanly, and comfortably.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a waxing studio built around fast, comfortable appointments.',
      'Every service is done with clean technique so you are in and out without fuss.',
    ],
    fallbackName: 'Your Waxing Studio',
    keywords: ['wax', 'sugaring', 'hair-removal', 'hair removal', 'laser-hair', 'threading'],
  },
  {
    key: 'makeup', industry: 'Makeup Artist', noun: 'makeup studio',
    heroTagline: 'Makeup for the day you actually have planned.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a makeup studio built around looks that hold up all day and photograph well.',
      'Every appointment starts with what you are getting ready for.',
    ],
    fallbackName: 'Your Makeup Studio',
    keywords: ['makeup', 'make-up', 'mua', 'bridal-makeup', 'glam'],
  },
  {
    key: 'tattoo', industry: 'Tattoo & Piercing Studio', noun: 'tattoo studio',
    heroTagline: 'Custom tattoo work, start to finish.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a tattoo studio built around custom work and a clean, careful process.',
      'Every piece starts with a consult so the design is right before the needle.',
    ],
    fallbackName: 'Your Tattoo Studio',
    keywords: ['tattoo', 'piercing', 'ink', 'body-art', 'pierc'],
  },
  {
    key: 'pet', industry: 'Pet Grooming', noun: 'pet grooming salon',
    heroTagline: 'Grooming your pet is comfortable with.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a pet grooming salon built around low-stress handling and a clean finish.',
      'Every groom goes at your pet’s pace, however long that takes.',
    ],
    fallbackName: 'Your Grooming Salon',
    keywords: ['pet', 'dog-groom', 'grooming-pet', 'puppy', 'canine', 'doggy', 'pet-service'],
  },
  {
    key: 'fitness', industry: 'Fitness & Training', noun: 'training studio',
    heroTagline: 'Training built around where you are starting from.',
    aboutHeading: 'About the Studio',
    aboutFallback: [
      'is a training studio built around steady progress, not quick fixes.',
      'Every session is planned around your goals and how your week actually looks.',
    ],
    fallbackName: 'Your Training Studio',
    keywords: ['fitness', 'personal-train', 'personal train', 'gym', 'yoga', 'pilates', 'coach'],
  },
  {
    key: 'dental', industry: 'Dental & Orthodontics', noun: 'dental practice',
    heroTagline: 'Dental care explained plainly, at a pace you are comfortable with.',
    aboutHeading: 'About the Practice',
    aboutFallback: [
      'is a dental practice built around clear explanations and unhurried appointments.',
      'Every visit starts by listening, so you know what is happening and why.',
    ],
    fallbackName: 'Your Practice',
    keywords: ['dental', 'dentist', 'orthodont', 'teeth', 'braces', 'invisalign', 'whitening-teeth', 'hygienist'],
  },
  {
    key: 'health', industry: 'Health & Wellness', noun: 'wellness clinic',
    heroTagline: 'Care that treats the cause, not just the symptom.',
    aboutHeading: 'About the Clinic',
    aboutFallback: [
      'is a wellness clinic built around getting to the root of the problem.',
      'Every plan is built around your history and how your body actually responds.',
    ],
    fallbackName: 'Your Clinic',
    keywords: ['chiro', 'physio', 'physical-therapy', 'acupunctur', 'nutrition', 'dietit', 'therapy-clinic', 'rehabilitation', 'osteopath', 'podiatr'],
  },
  {
    key: 'home', industry: 'Home Services', noun: 'home services company',
    heroTagline: 'Reliable work at your place, when we say we will be there.',
    aboutHeading: 'About Us',
    aboutFallback: [
      'is a local home services company built around showing up on time and doing the job properly.',
      'Every job is quoted clearly up front, so there are no surprises at the end.',
    ],
    fallbackName: 'Your Company',
    keywords: ['cleaning', 'housekeep', 'handyman', 'plumb', 'electric', 'hvac', 'landscap', 'lawn', 'pest', 'moving', 'junk-removal', 'pressure-wash', 'carpet-clean', 'window-clean', 'home-service', 'repair'],
  },
  {
    key: 'professional', industry: 'Professional Services', noun: 'local business',
    heroTagline: 'Straightforward service from someone who answers the phone.',
    aboutHeading: 'About Us',
    aboutFallback: [
      'is a local business built around doing right by the people it works with.',
      'Every job starts with a proper conversation about what you actually need.',
    ],
    fallbackName: 'Your Business',
    keywords: ['photograph', 'videograph', 'tutor', 'consult', 'coaching', 'legal', 'attorney', 'account', 'bookkeep', 'notary', 'insurance', 'real-estate', 'event-plan', 'catering', 'professional-service'],
  },
  {
    key: 'hair', industry: 'Hair Salon', noun: 'hair salon',
    heroTagline: 'Cut, color, and styling tailored to your hair.',
    aboutHeading: 'About the Salon',
    aboutFallback: [
      'is a neighborhood hair salon built around honest work and consistent results.',
      'Every appointment starts with a real conversation about your hair before anything is cut.',
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
  for (const n of BOOKSY_NICHES) {
    if (n.keywords.some((k) => haystack.includes(k))) {
      const { keywords, ...profile } = n;
      return profile;
    }
  }
  return BARBER;
}

export const DEFAULT_BOOKSY_NICHE = BARBER;
