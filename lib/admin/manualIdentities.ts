// Hand-verified identities and contacts, moved out of api/admin-overview.ts (behaviour unchanged).

export const MANUAL_IDENTITIES: Record<string, { phone: string; site: string; label: string }> = {
  'medrano8@gmail.com':        { phone: '8572057123', site: 'https://www.euphoriabarbers.com', label: 'Euphoria Barbershop' },
  'cathy.nguyen718@gmail.com': { phone: '5713957215', site: 'https://www.uniquefreshcut.com', label: 'Unique Fresh Cut' },
  'brodricksvenby2@gmail.com': { phone: '3343549926', site: 'https://hoffs-exterior-cleaning.vercel.app', label: 'Hoffs Exterior Cleaning' },
  // Owner re-confirmed 2026-08-17: 8028 is the right contact even though
  // the live site's tel: button now shows the shop line 618-207-0067.
  'hmpalmer1@gmail.com':       { phone: '6189218028', site: 'https://palmer-clean.vercel.app', label: 'Palmer & Co Barber Lounge' },
  'osmundb40@gmail.com':       { phone: '9732776417', site: 'https://alyozbarbershop.com', label: 'Alyoz Barbershop' },
  // $29/mo custom design; ig handle shown in the phone cell per owner.
  'arthuperez@yahoo.com':      { phone: '9513128652, ig handle: mratomic101', site: 'https://mratomic-barber.vercel.app', label: 'Mr Atomic Barber' },
  // 2026-08-07 custom-design cohort. Numbers are the ones the sites were
  // arranged over by text; each site title was read off the live build.
  'jamesdbarber01@gmail.com':  { phone: '9106706695', site: 'https://jamesd-barber.vercel.app', label: 'James D Barber @ One Stop Barbershop (Raeford NC)' },
  'raydawson.rd@gmail.com':    { phone: '5013888810', site: 'https://beardhouse-cuts.vercel.app', label: 'BeardHouse Cuts (Searcy AR)' },
  'adio74mazi@gmail.com':      { phone: '2405332126', site: 'https://nstyle-hair-grooming.vercel.app', label: 'N Style Hair Grooming (Bowie MD)' },
  // 2026-08-08. No number for him — reached on Instagram, so the handle
  // goes in the phone cell (same convention as Mr Atomic above).
  'jabfadezbarbe@gmail.com':   { phone: 'ig handle: jab.fadez', site: 'https://jab-fadez.vercel.app', label: 'Jab Fadez (Oxford MS)' },
  // 2026-08-09, $29/mo custom design bought off /15. Instagram is the
  // contact — no phone given.
  'jeanosbeauty.barber@yahoo.com': { phone: 'ig handle: jeanosbeauty.barber', site: 'https://jeanos-beauty-barber.vercel.app', label: 'Jeanosbeauty & Barber (Kinston NC)' },
  // 2026-08-14, $29/mo custom design bought off /15. Number is the one
  // the site was delivered over by text; matches the live tel: button.
  'allensdraughn@gmail.com':   { phone: '6786374696', site: 'https://truth-cuts.vercel.app', label: 'Truth Cuts (Riverdale GA)' },
  // 2026-08-12, $29/mo custom design bought off /15. Number is the one
  // the site was delivered over by text (the site itself has no tel:).
  'cheistopherpolk@gmail.com': { phone: '6785490686', site: 'https://cuts-by-christopher-polk.vercel.app', label: 'Cuts by Christopher Polk (Atlanta GA)' },
  // 2026-09-11 (owner): hand-built Client Sites team builds + their contacts.
  // Shavon has two Stripe customers (icloud + gmail) — both map to Clipps Edge.
  'shavon.taylor1@icloud.com': { phone: '3476766993', site: 'https://www.clippsedgebarber.com', label: 'Clipps Edge Barber — Shavon Taylor' },
  'clippsedge1@gmail.com':     { phone: '3476766993', site: 'https://www.clippsedgebarber.com', label: 'Clipps Edge Barber — Shavon Taylor' },
  'deejay0404@gmail.com':      { phone: '8032880925', site: 'https://www.fadecitybarber.com', label: 'Fade City Barber — David Jeter' },
  'bippdabarber@yahoo.com':    { phone: '2565299486', site: 'https://www.iconiccutzbarber.com', label: 'Iconic Cutz — Bivens Mayo' },
  // 2026-09-12: $19/mo PrimeHub barber custom design off a Facebook ad
  // (/barber). Site hand-built in the Client Sites team; no portal login
  // issued yet, so there is no client_sites row for it.
  'cutzbyantdabarber@yahoo.com': { phone: '2294496675', site: 'https://cutz-by-ant.vercel.app', label: 'Cutz By Ant — Anthony Ross' },
  // 2026-09-15: first $20/mo custom-home order off the new aibarber.org
  // homepage (plan custom-home, page "/"). Site hand-built in the Client
  // Sites team; no portal login issued yet, so no client_sites row.
  'mizzler2014@gmail.com':     { phone: '3012328506', site: 'https://mizzler37.vercel.app', label: 'Mizzler37 — Michael Johnson' },
};

// Contact person + mobile per portal site (owner-supplied; the client_sites table has no contact columns).
export const CLIENT_SITE_CONTACTS: Record<string, { contact: string; phone: string }> = {
  'clipps-edge': { contact: 'Shavon Taylor', phone: '3476766993' },
  'iconic-cutz': { contact: 'Bivens Mayo', phone: '2565299486' },
  'mizzler37': { contact: 'Michael Johnson', phone: '3012328506' },
  // Pre-staged: only renders once the site is onboarded to /edit.
  'cutz-by-ant': { contact: 'Anthony Ross', phone: '2294496675' },
};
