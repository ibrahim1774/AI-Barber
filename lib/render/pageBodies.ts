// The bodies of the pages of a multi-page site (spec 2026-10-23-barber-experience, P3b).
//
// One set of bodies for all three designs: plain markup with `ab-*` classes that each design's shell
// paints (shell.ts PAGE_CSS). A body prints only what the barber gave us for that page: no filler, no
// text we wrote about the shop. Every visible word of ours is a label (labels.ts t()); everything else
// is the barber's data, escaped. Photos are `{{gallery3}}`-style placeholders swapped at deploy.
//
// Pure, no DOM. Imports only other vendored modules.
import type { TemplateId, WebsiteData } from '../../types';
import {
  aggregateToShow, contactEmail, displayPhone, displayPrice, firstName, nicheOf, photoAlt, reviewsSourceLabel, reviewStars,
  serviceMeta, siteDescription, teamBookLink, teamOf, visibleReviews, type TeamCard,
} from './honest.js';
import {
  beardServices, extraBlocks, guideBlocks, howOftenRows, serviceGuideFor, titledServices, type CopyEnv, type LinkInfo, type LinkKey, type ResolvedBlock, type Seg,
} from './guides.js';
import { defaultRatingLine, navLabelKey, plainLabel, PAGE_TITLE_KEY, ratingLineCustom, t, type LabelKey } from './labels.js';
import { aboutParagraphs, isExtraKey, ownGallerySlots, pageHref as pageHrefOf, plainText, type PageContext, type PageFile, type PageSet } from './pages.js';
import { escapeAttr } from './shell.js';
import { safeHref } from './safeHref.js';
import { isSiteBookLink } from './subpages.js';
import { isStockImage } from '../stockImages.js';

const esc = escapeAttr;

/** Everything a body needs: the site (already withoutLegacyCopy'd and forRender'd), its page set and the real photo URLs. */
export interface BodyCtx {
  d: WebsiteData;
  set: PageSet;
  template: TemplateId;
  page: PageContext;
}

export interface PageBody {
  body: string;
  /** Raw page name for the <title> ("About us", the service's name, the barber's name). */
  heading: string;
  /** Raw meta description. */
  description: string;
  /** Raw whole <title>, when it is not "{heading} · {shop}" (the Location page). */
  title?: string;
}

// 24h -> 12h like the home pages ("09:00" -> "9:00 AM"); anything else is printed as typed.
const to12h = (raw: string | null | undefined): string => {
  if (!raw) return raw ?? '';
  const s = String(raw).trim();
  if (!s) return s;
  if (/\b(AM|PM|am|pm|noon|midnight)\b/i.test(s)) return s.replace(/\s+/g, ' ').toUpperCase().replace('NOON', 'Noon').replace('MIDNIGHT', 'Midnight');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return s;
  const h24 = parseInt(m[1], 10);
  if (isNaN(h24) || h24 < 0 || h24 > 24) return s;
  const period = h24 >= 12 && h24 < 24 ? 'PM' : 'AM';
  const h12 = h24 === 0 || h24 === 24 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m[2] || '00'} ${period}`;
};

const clip = (s: string, n: number): string => {
  const t0 = plainText(s).replace(/\s+/g, ' ');
  return t0.length <= n ? t0 : `${t0.slice(0, n - 1).trimEnd()}…`;
};

type Hours = { day?: string; open?: string; close?: string; closed?: boolean }[];

export function renderPageBody(ctx: BodyCtx, file: PageFile): PageBody {
  const { d, set } = ctx;
  const niche = nicheOf(d);
  const L = (key: LabelKey): string => t(d.labels, key, niche, d);
  const P = (key: LabelKey): string => plainLabel(d.labels, key, niche, d);
  const title = (): string => L(PAGE_TITLE_KEY[file.key] as LabelKey);
  const heading = (): string => P(PAGE_TITLE_KEY[file.key] as LabelKey);
  const generic = siteDescription(d);
  // The one place the shop works from (pgPlace: the shop's own city and state unless the barber named a neighbourhood).
  const place = P('pgPlace');

  // Buttons: the booking link (the site's own /book in this tab, another site in a new one) and the shop link.
  const bookingUrl = safeHref(d.bookingUrl);
  const shopUrl = safeHref(d.shopUrl);
  const bookBtn = bookingUrl
    ? `<a class="ab-btn ab-btn-solid" href="${esc(bookingUrl)}"${isSiteBookLink(bookingUrl) ? '' : ' target="_blank" rel="noopener noreferrer"'}>${L('pgBookCta')}</a>`
    : '';
  const shopBtn = shopUrl
    ? `<a class="ab-btn" href="${esc(shopUrl)}"${shopUrl.startsWith('/') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${L('pgShopCta')}</a>`
    : '';
  const bookingLive = isSiteBookLink(d.bookingUrl);
  // Links to the practical pages the site has (Location, Hours, Contact), named by their menu labels.
  const alsoSee = (): string => {
    const keys = (['location', 'hours', 'contact'] as const).filter((k) => k !== file.key && set.nav.includes(k) && set.files.some((f) => f.key === k && !f.child));
    if (!keys.length) return '';
    return `<h2 class="ab-h2" style="margin-top:32px">${L('pgAlsoSee')}</h2><div class="ab-chips">${keys.map((k) => `<a class="ab-chip" href="${pageHrefOf(k)}">${t(d.labels, navLabelKey(ctx.template, k), niche, d)}</a>`).join('')}</div>`;
  };

  // ── Library copy (guides.ts): the environment a sentence is resolved in, and how a block becomes markup ──────────
  // Links are built from the page set only (never from site data): a link to a page that is not a file drops its sentence.
  const links: Partial<Record<LinkKey, LinkInfo>> = {};
  for (const k of ['location', 'hours', 'contact', 'services'] as const) {
    if (set.files.some((f) => f.key === k && !f.child)) links[k] = { href: pageHrefOf(k), label: plainLabel(d.labels, navLabelKey(ctx.template, k), niche, d) };
  }
  if (bookingUrl) links.book = { href: bookingUrl, label: P('pgBookCta'), newTab: !isSiteBookLink(bookingUrl) };
  // Only services whose page is a deployed file are linked (hiding Services drops them all).
  const serviceSlug = (index: number): string | null => set.files.find((f) => f.key === 'services' && f.child?.index === index)?.child?.slug ?? null;
  const copyEnv: CopyEnv = { d, place, industry: niche.industry, links, serviceHref: (i) => { const sl = serviceSlug(i); return sl ? `/services/${sl}/` : null; } };
  const segsHtml = (segs: readonly Seg[]): string => segs.map((g) => (g.t === 'text' ? esc(g.s) : `<a href="${esc(g.href)}"${g.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(g.label)}</a>`)).join('');
  const blockHtml = (b: ResolvedBlock): string => {
    const head = b.kind === 'qa' ? `<h3 class="ab-copy-h">${esc(b.q ?? '')}</h3>` : b.h ? `<h3 class="ab-copy-h">${L(b.h as LabelKey)}</h3>` : '';
    const paras = b.items.map((it) => `<p>${segsHtml(it)}</p>`).join('');
    if (b.kind === 'list') return `${head}<ul class="ab-copy">${b.items.map((it) => `<li>${segsHtml(it)}</li>`).join('')}</ul>`;
    if (b.kind === 'step') return `${head}<ol class="ab-copy">${b.items.map((it) => `<li>${segsHtml(it)}</li>`).join('')}</ol>`;
    return `<div class="ab-copy ab-prose">${head}${paras}</div>`;
  };
  const blocksHtml = (bs: readonly ResolvedBlock[]): string => bs.map(blockHtml).join('');
  const firstWords = (bs: readonly ResolvedBlock[]): string => {
    const first = bs[0]?.items[0];
    return first ? clip(first.map((g) => (g.t === 'text' ? g.s : g.label)).join(''), 155) : '';
  };
  // A service row: its name (linked when it has a page) and its listed price.
  const svcRow = (sv: { index: number; title: string; price: string }): string => {
    const slug = serviceSlug(sv.index);
    const price = displayPrice(sv.price);
    return `<div class="ab-row"><span>${slug ? `<a href="${esc(`/services/${slug}/`)}">${esc(sv.title)}</a>` : esc(sv.title)}</span>${price ? `<span>${esc(price)}</span>` : ''}</div>`;
  };

  const card = (m: TeamCard): { link: ReturnType<typeof teamBookLink>; button: string } => {
    const link = teamBookLink(d, m, bookingLive);
    const text = link ? (link.kind === 'member' ? `${L('teamBookWith')} ${esc(firstName(m.name))}` : L('pgBookCta')) : '';
    return {
      link,
      button: link ? `<a class="ab-btn${link.kind === 'member' ? ' ab-btn-solid' : ''}" href="${esc(link.href)}"${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>` : '',
    };
  };

  // ── About ──────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'about') {
    const paras = aboutParagraphs(d);
    const aboutUrl = (ctx.page.imageUrls && ctx.page.imageUrls.about) || '';
    const image = d.about?.imageUrl && !isStockImage(aboutUrl) ? `<img class="ab-photo" src="{{about}}" alt="${esc(photoAlt(d))}">` : '';
    return {
      heading: heading(),
      description: clip(paras[0] ?? '', 155) || generic,
      body: `<section class="ab-sec"><div class="ab-wrap ab-split${image ? ' has-aside' : ''}"><div><h1 class="ab-h1">${title()}</h1><div class="ab-prose">${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>${image}</div></section>`,
    };
  }

  // ── Services ───────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'services' && !file.child) {
    const withPage = new Map(set.services.map((c) => [c.index, c]));
    const list = (Array.isArray(d.services) ? d.services : []).map((s, index) => ({ s, index })).filter((x) => plainText(x.s?.title));
    const cards = list.map(({ s, index }) => {
      const kid = withPage.get(index);
      const price = displayPrice(s.price);
      const meta = serviceMeta(s);
      const name = kid ? `<a href="${esc(`/services/${kid.slug}/`)}">${esc(s.title)}</a>` : esc(s.title);
      return `<div class="ab-card"><div class="ab-card-top"><h3>${name}</h3>${price ? `<span class="ab-price">${esc(price)}</span>` : ''}</div>${meta ? `<div class="ab-meta">${esc(meta)}</div>` : ''}${s.description ? `<p>${esc(s.description)}</p>` : ''}</div>`;
    });
    return {
      heading: heading(), description: generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><div class="ab-grid">${cards.join('')}</div>${bookBtn ? `<div class="ab-actions">${bookBtn}</div>` : ''}</div></section>`,
    };
  }
  if (file.key === 'services' && file.child) {
    const s = d.services[file.child.index];
    const price = displayPrice(s.price);
    const meta = serviceMeta(s);
    const desc = s.description ? String(s.description).split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('') : '';
    // Who does it: only barbers with an explicit service subset that names this service (no subset = "does
    // everything" is inherited, not stated). Linked when the barber has a page of their own.
    const want = plainText(s.title).toLowerCase();
    // Link only to team pages that are really deployed (set.files); with Team turned off the block is dropped.
    const kids = new Map(set.files.filter((f) => f.key === 'team' && f.child).map((f) => [f.child!.index, f.child!]));
    const who = !set.nav.includes('team') ? [] : teamOf(d, { legacyUncapped: true }).filter((m) => {
      const raw = ((Array.isArray(d.staff) ? d.staff[m.index] : null) ?? {}) as { serviceIds?: unknown[]; serviceNames?: unknown[] };
      return Array.isArray(raw.serviceIds) && raw.serviceIds.some((x) => plainText(x))
        && Array.isArray(raw.serviceNames) && raw.serviceNames.some((n) => plainText(n).toLowerCase() === want);
    });
    const whoBlock = who.length
      ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgOfferedBy')}</h2><div class="ab-chips">${who.map((m) => {
        const kid = kids.get(m.index);
        return kid ? `<a class="ab-chip" href="${esc(`/team/${kid.slug}/`)}">${esc(m.name)}</a>` : `<span class="ab-chip">${esc(m.name)}</span>`;
      }).join('')}</div>`
      : '';
    // Related pages: the other services, then Location / Hours / Contact when the site has them.
    const others = set.services.filter((c) => c.index !== file.child!.index);
    const othersBlock = others.length
      ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgOtherServices')}</h2><div class="ab-chips">${others.map((c) => `<a class="ab-chip" href="${esc(`/services/${c.slug}/`)}">${esc(c.title)}</a>`).join('')}</div>`
      : '';
    // One URL per service, titled with the shop's place: "Skin Fade in Brooklyn, NY · Fresh Cuts". No place, no change.
    const eyebrow = place ? `<p class="ab-eyebrow">${esc(niche.industry)} in ${L('pgPlace')}</p>` : '';
    // "About this service": the library guide for this service, only when the barber turned guides on and this is the
    // first service of its kind. Every sentence is library text or a token resolved from this site's own data.
    const guideId = serviceGuideFor(d, set.services.map((c) => c.index)).get(file.child.index);
    const subject = titledServices(d).find((x) => x.index === file.child!.index);
    const guideBs = guideId && subject ? guideBlocks(copyEnv, guideId, subject) : [];
    const guideBlock = guideBs.length ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgGuideHeading')}</h2>${blocksHtml(guideBs)}` : '';
    return {
      heading: plainText(s.title),
      title: place ? clip(`${plainText(s.title)} in ${place} · ${plainText(d.shopName)}`, 120) : undefined,
      description: clip(s.description || '', 155) || generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><a class="ab-back" href="/services/">${L('pgBackServices')}</a>${eyebrow}<h1 class="ab-h1">${esc(s.title)}</h1>${price ? `<p class="ab-price">${esc(price)}</p>` : ''}${meta ? `<div class="ab-meta">${esc(meta)}</div>` : ''}<div class="ab-prose">${desc}</div>${guideBlock}${bookBtn ? `<div class="ab-actions">${bookBtn}</div>` : ''}${whoBlock}${othersBlock}${alsoSee()}</div></section>`,
    };
  }

  // ── Team ───────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'team' && !file.child) {
    const team = teamOf(d, { legacyUncapped: true });
    const kids = new Map(set.team.map((c) => [c.index, c]));
    const cards = team.map((m) => {
      const kid = kids.get(m.index);
      const { button } = card(m);
      return `<div class="ab-card">${m.photo ? `<img class="ab-photo" src="{{staff${m.index}}}" alt="${esc(m.name)}">` : '<div class="ab-photo-empty"></div>'}<h3>${kid ? `<a href="${esc(`/team/${kid.slug}/`)}">${esc(m.name)}</a>` : esc(m.name)}</h3>${m.role ? `<div class="ab-role">${esc(m.role)}</div>` : ''}${m.bio ? `<p>${esc(m.bio)}</p>` : ''}${kid ? `<a class="ab-back" style="margin:8px 0 0" href="${esc(`/team/${kid.slug}/`)}">${L('pgViewProfile')}</a>` : ''}${button ? `<div class="ab-actions" style="margin-top:12px">${button}</div>` : ''}</div>`;
    });
    return { heading: heading(), description: generic, body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><div class="ab-grid">${cards.join('')}</div></div></section>` };
  }
  if (file.key === 'team' && file.child) {
    const kid = file.child;
    const m = teamOf(d, { legacyUncapped: true }).find((c) => c.index === kid.index) as TeamCard;
    const raw = ((Array.isArray(d.staff) ? d.staff[kid.index] : null) ?? {}) as { serviceIds?: unknown[]; serviceNames?: unknown[]; hours?: Hours };
    const pick = Array.isArray(raw.serviceIds) && raw.serviceIds.some((x) => plainText(x));
    const names = pick && Array.isArray(raw.serviceNames) ? raw.serviceNames.map((n) => plainText(n)).filter(Boolean).slice(0, 30) : [];
    const priceOf = (n: string): string => {
      const hit = (Array.isArray(d.services) ? d.services : []).find((s) => plainText(s?.title).toLowerCase() === n.toLowerCase());
      return hit ? displayPrice(hit.price) : '';
    };
    const own = Array.isArray(raw.hours) && raw.hours.length > 0 ? raw.hours : null;
    const { button } = card(m);
    const services = names.length
      ? `<h2 class="ab-h2">${L('pgMemberServices')}</h2><div class="ab-rows">${names.map((n) => `<div class="ab-row"><span>${esc(n)}</span>${priceOf(n) ? `<span>${esc(priceOf(n))}</span>` : ''}</div>`).join('')}</div>`
      : '';
    const hoursBlock = own && hoursDiffer(own, d.hours)
      ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgMemberHours')}</h2><div class="ab-rows">${own.map((h) => hoursRow(h, L('pgClosed'))).join('')}</div>`
      : '';
    return {
      heading: m.name,
      description: clip(m.bio || '', 155) || (m.role ? clip(`${m.name}, ${m.role}`, 155) : generic),
      body: `<section class="ab-sec"><div class="ab-wrap"><a class="ab-back" href="/team/">${L('pgBackTeam')}</a><div class="ab-split has-aside"><div><h1 class="ab-h1">${esc(m.name)}</h1>${m.role ? `<div class="ab-role" style="margin:-12px 0 16px">${esc(m.role)}</div>` : ''}${m.bio ? `<div class="ab-prose"><p>${esc(m.bio)}</p></div>` : ''}${services}${hoursBlock}${button ? `<div class="ab-actions">${button}</div>` : ''}</div>${m.photo ? `<img class="ab-photo" src="{{staff${m.index}}}" alt="${esc(m.name)}">` : ''}</div></div></section>`,
    };
  }

  // ── Gallery ────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'gallery') {
    const alt = esc(photoAlt(d));
    const slots = ownGallerySlots(d, ctx.page);
    return {
      heading: heading(), description: generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><div class="ab-gallery">${slots.map((i) => `<img src="{{gallery${i}}}" alt="${alt}" loading="lazy">`).join('')}</div></div></section>`,
    };
  }

  // ── Reviews ────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'reviews') {
    const agg = aggregateToShow(d);
    const custom = ratingLineCustom(d);
    const rating = agg
      ? `<div class="ab-rating"><span class="ab-stars">★</span>${custom !== null ? `<span>${esc(custom)}</span>` : `<span><b>${esc(defaultRatingLine(agg))}</b></span>`}</div>`
      : '';
    const source = reviewsSourceLabel(d);
    const cards = visibleReviews(d).slice(0, 50).map((r) => {
      const stars = reviewStars(r);
      return `<div class="ab-card">${stars !== null ? `<div class="ab-stars">${'★'.repeat(stars)}</div>` : ''}<p class="ab-quote">“${esc(r.comment)}”</p><div class="ab-by"><span>${esc(r.author || 'Customer')}</span>${r.date ? `<span>${esc(r.date)}</span>` : ''}</div></div>`;
    });
    return {
      heading: heading(), description: generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1>${rating}${source ? `<p class="ab-muted" data-reviews-source>${esc(source)}</p>` : ''}<div class="ab-grid">${cards.join('')}</div></div></section>`,
    };
  }

  // ── Hours ──────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'hours') {
    const hours = Array.isArray(d.hours) ? d.hours : [];
    return {
      heading: heading(), description: generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><div class="ab-rows">${hours.map((h) => hoursRow(h, L('pgClosed'))).join('')}</div>${alsoSee()}</div></section>`,
    };
  }

  // ── Location ───────────────────────────────────────────────────────────────────────────────────
  // Everything here is the address, phone and hours the barber gave us, the map for that address and a
  // directions link built from it. No parking or access notes: the site has no such field.
  if (file.key === 'location') {
    const address = plainText(d.contact?.address);
    const phone = plainText(d.phone);
    const hours = Array.isArray(d.hours) ? d.hours : [];
    const shop = plainText(d.shopName);
    const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const facts = [
      `<div class="ab-fact"><dt>${L('pgAddressLabel')}</dt><dd>${esc(address)}</dd></div>`,
      phone ? `<div class="ab-fact"><dt>${L('pgPhoneLabel')}</dt><dd>${/\d/.test(phone) ? `<a href="tel:${esc(phone.replace(/\s+/g, ''))}">${esc(displayPhone(phone))}</a>` : esc(displayPhone(phone))}</dd></div>` : '',
    ].join('');
    const hoursBlock = hours.length
      ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgHoursHeading')}</h2><div class="ab-rows">${hours.map((h) => hoursRow(h, L('pgClosed'))).join('')}</div>`
      : '';
    const map = `<div class="ab-map"><iframe title="${esc(shop)} on Google Maps" src="https://maps.google.com/maps?q=${encodeURIComponent(`${shop} ${address}`)}&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`;
    // Services here, the team and the rating: real data only, and only for sites that opted into pages v2 (extraPages),
    // so a site saved before it keeps its Location page as it was.
    const v2 = !!d.extraPages && typeof d.extraPages === 'object';
    const svcHere = v2 ? titledServices(d).filter((x) => serviceSlug(x.index)).slice(0, 12) : [];
    const teamKids = v2 && set.nav.includes('team') ? set.files.filter((f) => f.key === 'team' && f.child) : [];
    const agg = v2 ? aggregateToShow(d) : null;
    const customRating = ratingLineCustom(d);
    const extraSecs = [
      svcHere.length ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgLocServices')}</h2><div class="ab-rows">${svcHere.map(svcRow).join('')}</div>` : '',
      teamKids.length ? `<h2 class="ab-h2" style="margin-top:32px">${L('pgLocTeam')}</h2><div class="ab-chips">${teamKids.map((f) => `<a class="ab-chip" href="${esc(f.href)}">${esc(f.child!.title)}</a>`).join('')}</div>` : '',
      agg ? `<div class="ab-rating" style="margin-top:32px"><span class="ab-stars">★</span>${customRating !== null ? `<span>${esc(customRating)}</span>` : `<span><b>${esc(defaultRatingLine(agg))}</b></span>`}</div>` : '',
    ].join('');
    return {
      heading: heading(),
      title: place ? clip(`${niche.industry} in ${place} · ${shop}`, 120) : clip(`${shop} — ${niche.noun} at ${address}`, 110),
      description: clip(`${shop}, ${address}.`, 155),
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><dl class="ab-facts">${facts}</dl><div class="ab-actions"><a class="ab-btn ab-btn-solid" href="${esc(directions)}" target="_blank" rel="noopener noreferrer">${L('pgDirectionsCta')}</a>${bookBtn}</div>${map}${hoursBlock}${extraSecs}${alsoSee()}</div></section>`,
    };
  }

  // ── Contact ────────────────────────────────────────────────────────────────────────────────────
  if (file.key === 'contact') {
    const address = plainText(d.contact?.address);
    const email = contactEmail(d);
    const phone = plainText(d.phone);
    const canCall = /\d/.test(phone);
    const facts = [
      address ? `<div class="ab-fact"><dt>${L('pgAddressLabel')}</dt><dd>${esc(address)}</dd></div>` : '',
      phone ? `<div class="ab-fact"><dt>${L('pgPhoneLabel')}</dt><dd>${canCall ? `<a href="tel:${esc(phone.replace(/\s+/g, ''))}">${esc(displayPhone(phone))}</a>` : esc(displayPhone(phone))}</dd></div>` : '',
      email ? `<div class="ab-fact"><dt>${L('pgEmailLabel')}</dt><dd><a href="mailto:${esc(email)}">${esc(email)}</a></dd></div>` : '',
    ].join('');
    return {
      heading: heading(), description: generic,
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1><dl class="ab-facts">${facts}</dl>${bookBtn || shopBtn ? `<div class="ab-actions">${bookBtn}${shopBtn}</div>` : ''}</div></section>`,
    };
  }

  // ── Extra (guide) pages: FAQ, First visit, Hair care, Beard care ───────────────────────────────
  // Library copy (copyLibrary.ts) plus real data from the site: every sentence about the shop is a token resolved from
  // the barber's own data, and a sentence whose data is missing is dropped (guides.ts). The hero photo slot is Phase C.
  if (isExtraKey(file.key)) {
    const shopName = plainText(d.shopName);
    const blocks = extraBlocks(copyEnv, file.key);
    const byId = (id: string): ResolvedBlock[] => blocks.filter((b) => b.id === id);
    const actions = bookBtn ? `<div class="ab-actions">${bookBtn}</div>` : '';
    const h2 = (key: LabelKey): string => `<h2 class="ab-h2" style="margin-top:32px">${L(key)}</h2>`;
    const rows = (list: { index: number; title: string; price: string }[]): string => `<div class="ab-rows">${list.map(svcRow).join('')}</div>`;
    let inner = '';
    if (file.key === 'faq') inner = blocksHtml(blocks);
    else if (file.key === 'first-visit') {
      const priced = titledServices(d).filter((x) => x.price).slice(0, 12);
      inner = blocksHtml(byId('booking')) + blocksHtml(byId('findUs')) + blocksHtml(byId('before')) + blocksHtml(byId('inChair'))
        + (priced.length ? h2('pgFvPrices') + rows(priced) : '');
    } else if (file.key === 'hair-care') {
      const often = howOftenRows(copyEnv);
      inner = blocksHtml(blocks)
        + (often.length ? h2('pgHcOften') + `<ul class="ab-copy">${often.map((r) => { const sl = serviceSlug(r.index); return `<li>${sl ? `<a href="${esc(`/services/${sl}/`)}">${esc(r.title)}</a>` : esc(r.title)}: ${segsHtml(r.segs)}</li>`; }).join('')}</ul>` : '');
    } else {
      const bs = beardServices(d);
      inner = blocksHtml(blocks) + (bs.length ? h2('pgBcServices') + rows(bs) : '');
    }
    return {
      heading: heading(),
      title: file.key === 'faq' ? clip(`${heading()} · ${shopName}${place ? `, ${place}` : ''}`, 120) : undefined,
      description: firstWords(blocks) || generic,
      // (Phase C: the hero photo slot sits above the heading.)
      body: `<section class="ab-sec"><div class="ab-wrap"><h1 class="ab-h1">${title()}</h1>${inner}${actions}${alsoSee()}</div></section>`,
    };
  }

  throw new Error(`no page body for ${file.key}`);
}

const hoursRow = (h: { day?: string; open?: string; close?: string; closed?: boolean }, closed: string): string =>
  `<div class="ab-row"><span>${esc(h.day)}</span><span>${h.closed ? closed : `${esc(to12h(h.open))} – ${esc(to12h(h.close))}`}</span></div>`;

const sig = (h: unknown): string =>
  JSON.stringify((Array.isArray(h) ? (h as Hours) : []).map((r) => [plainText(r?.day).toLowerCase(), plainText(r?.open), plainText(r?.close), !!r?.closed]));
const hoursDiffer = (own: Hours, shop: unknown): boolean => sig(own) !== sig(shop);
