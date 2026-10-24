/**
 * Custom domains, app side (spec 2026-10-22-custom-domains; server shapes from the domains server
 * report, faked in harness.ts): the pure status / claim helpers, the API client, and the screen flow
 * against the fake server — search seeded from the shop name, buy through the `custom_domain` paywall
 * or straight to claim with an unused paid slot, progress to Live, retry, pick another, support, and
 * the double-tap guard.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn(), resetTo: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { Alert } from 'react-native';
import { allText } from '../store/render';
import { DOMAIN_PRODUCT, FakeServer, P, boot, draft, installFetch, kill, type World } from './harness';
import { wipeDisk } from './mocks';
import {
  DOMAIN_DISCLOSURE, DOMAIN_EXAMPLES_LINE, DOMAIN_PRICE_LINE, claimOutcome, normalizeLabel, pickDomainTransactionId, rememberedClaim, retryLaterMessage,
  settingsDetail, statusView,
} from '@/lib/domains/model';
import { CLAIM_TIMEOUT_MS } from '@/lib/domains/api';

describe('statusView / settingsDetail', () => {
  it.each([
    [{ domain: 'a.com', state: 'registering' }, 'registering', 'Registering…', true],
    [{ domain: 'a.com', state: 'linking' }, 'linking', 'Linking…', true],
    [{ domain: 'a.com', state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'pending' } }, 'almost', 'Live in a few minutes', true],
    [{ domain: 'a.com', state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'ready' } }, 'live', 'Live', false],
    [{ domain: 'a.com', state: 'live' }, 'live', 'Live', false],
    [{ domain: 'a.com', state: 'expired' }, 'expired', 'Expired', false],
    [{ domain: 'a.com', state: 'transferred' }, 'transferred', 'Transferred to you', false],
    [{ domain: null, state: 'none' }, 'none', DOMAIN_PRICE_LINE, false],
  ] as const)('%j → %s', (s, phase, title, polling) => {
    const v = statusView(s as any);
    expect([v.phase, v.title, v.polling]).toEqual([phase, title, polling]);
  });

  it('cancelled shows the date it works until', () => {
    expect(statusView({ domain: 'a.com', state: 'cancelled-until:2027-03-05T12:00:00Z' }).title).toBe('Cancelled — works until March 5, 2027');
  });

  it('failures: pick another when the slot is reusable; retry the same name when the server says so; support when flagged', () => {
    expect(statusView({ domain: 'a.com', state: 'failed:taken', canRetry: true })).toMatchObject({ pickAnother: true, retrySame: false, title: "Couldn't get that name — pick another" });
    expect(statusView({ domain: 'a.com', state: 'failed:registrar', canRetry: true })).toMatchObject({ pickAnother: true, retrySame: true });
    expect(statusView({ domain: 'a.com', state: 'failed:registration-expired' })).toMatchObject({ pickAnother: true, retrySame: false });
    expect(statusView({ domain: 'a.com', state: 'failed:subscription-inactive', canRetry: true })).toMatchObject({ pickAnother: false, retrySame: false });
    expect(statusView({ domain: 'a.com', state: 'failed:registrar', needsSupport: true }).needsSupport).toBe(true);
  });

  it('the Settings row', () => {
    expect(settingsDetail(null)).toBe('Get your own .com — $39/year');
    expect(settingsDetail({ domain: 'freshcuts.com', state: 'live' })).toBe('freshcuts.com · Live');
    expect(settingsDetail({ domain: 'freshcuts.com', state: 'linking' })).toBe('freshcuts.com · Linking…');
  });
});

describe('claimOutcome', () => {
  it.each([
    [200, { domain: 'a.com', state: 'live' }, 'live'],
    [202, { domain: 'a.com', state: 'registering' }, 'progress'],
    [409, { error: 'claim-failed', domain: 'a.com', state: 'failed:taken', canRetry: true }, 'failed'],
    [409, { error: 'domain-taken' }, 'taken'],
    [409, { error: 'domain-not-eligible' }, 'not-eligible'],
    [409, { error: 'slot-in-use', domain: 'b.com', state: 'live' }, 'slot-in-use'],
    [409, { error: 'site-has-domain' }, 'support'],
    [409, { error: 'slot-bound-to-other-site' }, 'support'],
    [409, { error: 'transferred' }, 'support'],
    [402, { error: 'subscription-inactive' }, 'inactive'],
    [403, { error: 'not-owner' }, 'support'],
    [403, { error: 'environment-mismatch' }, 'support'],
    [400, { error: 'bad-product' }, 'support'],
    [503, { error: 'apple-unavailable' }, 'retry-later'],
    [429, { error: 'rate-limited' }, 'retry-later'],
    [200, null, 'retry-later'],
  ] as const)('%i %j → %s', (code, body, kind) => {
    expect(claimOutcome(code, body).kind).toBe(kind);
  });
});

describe('other helpers', () => {
  it('normalizeLabel like the server', () => {
    expect(normalizeLabel('Fresh Cuts')).toBe('freshcuts');
    expect(normalizeLabel('https://www.Café & Co.com')).toBe('cafeandco');
  });

  it('the domain slot is only the domain product, never a plan', () => {
    const sub = (transactionId: string, productId: string, isActive = true) => ({ transactionId, productId, purchaseDate: '2026-10-01T00:00:00Z', isActive });
    expect(pickDomainTransactionId([sub('1', P.storeMonthly), sub('2', DOMAIN_PRODUCT)])).toBe('2');
    expect(pickDomainTransactionId([sub('1', P.storeMonthly), sub('2', DOMAIN_PRODUCT, false)])).toBeNull();
  });

  it('the disclosure, word for word; and no monthly figure for the $39 yearly price anywhere in the domain code', () => {
    expect(DOMAIN_DISCLOSURE).toBe("Registered by Prime Barber for your site. If you ever leave, contact support@davoxa.com and we'll transfer it to you.");
    const root = path.join(__dirname, '../..');
    for (const f of ['src/lib/domains/model.ts', 'src/app/domain.tsx', 'src/app/(tabs)/settings.tsx']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/\/mo\b|per month|a month|3\.25|3\.24/i);
    }
  });
});

// ---- screen flows against the fake server ---------------------------------------------------------

let server: FakeServer;
let w: World;

beforeEach(() => {
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  fake = false;
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

let fake = false;
const tick = (): Promise<unknown> => (fake ? jest.advanceTimersByTimeAsync(30) : new Promise((r) => setTimeout(r, 30)));

/** A live Website-plan site (tx-1), signed in. */
async function liveSite() {
  w = await boot(server, { user: 'u1' });
  await w.m.siteStore.saveSite(draft());
  w.willBuy(P.websiteMonthly);
  const site = await w.site();
  expect(await w.m.publish.publishFlow(site!, w.deps)).toMatchObject({ kind: 'live' });
  await w.superwallSync();
}

async function openScreen(opts: { search?: boolean } = {}) {
  const ReactM = require('react');
  const Domain = require('@/app/domain').default;
  const tree = await w.render(ReactM.createElement(Domain));
  await w.act(async () => {
    await tick();
  });
  // The screen never searches by itself: the user presses Search (the box is pre-filled from the shop name).
  const search = tree.root.findAll(
    (n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && allText({ root: n }).join('') === 'Search',
  )[0];
  if (search && opts.search !== false) {
    await w.act(async () => {
      search.props.onPress();
      await tick();
    });
  }
  return tree;
}

const texts = (tree: any) => allText(tree).join(' | ');
const rowFor = (tree: any, domain: string) =>
  tree.root.findAll((n: any) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(`${domain},`) && n.props.onPress)[0];
const button = (tree: any, title: string) =>
  tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && allText({ root: n }).join('') === title)[0];
async function tap(node: any) {
  await w.act(async () => {
    node.props.onPress();
    await tick();
  });
}
const claims = () => server.calls.filter((c) => c.path === '/api/ios/domain/claim');

describe('the custom domain screen', () => {
  it('does not search, or show an error, before the user presses Search', async () => {
    await liveSite();
    server.fail('/api/ios/domain/search', { kind: 'dead' });
    const tree = await openScreen({ search: false });
    expect(server.calls.filter((c) => c.path.includes('domain/search'))).toHaveLength(0);
    expect(texts(tree)).not.toContain("Couldn't");
    expect(rowFor(tree, 'fadelab.com')).toBeUndefined();
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Search for a name')[0].props.value).toBe('Fade Lab');
  });

  it('search from the shop name → buy (paywall) → claim with both transactions → Registering → Linking → Live in a few minutes → Live; share links refresh', async () => {
    await liveSite();
    server.domainTaken.add('fadelabbarber.com');
    const live = jest.fn();
    require('@/lib/siteEvents').onSiteLive(live);
    // Fake timers from here: the screen polls status every 5 s.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    fake = true;
    const tree = await openScreen();
    let t = texts(tree);
    expect(t).toContain(DOMAIN_PRICE_LINE);
    expect(t).toContain(DOMAIN_DISCLOSURE);
    expect(t).toContain('fadelab.com');
    expect(rowFor(tree, 'fadelab.com').props.accessibilityLabel).toBe('fadelab.com, Available');
    expect(rowFor(tree, 'fadelabbarber.com').props.accessibilityLabel).toBe('fadelabbarber.com, Taken');
    expect(rowFor(tree, 'fadelabbarber.com').props.disabled).toBe(true);

    w.willBuy(DOMAIN_PRODUCT);
    await tap(rowFor(tree, 'fadelab.com'));
    // The plan subscription is untouched by the domain purchase.
    expect(server.activeSub()?.productId).toBe(P.websiteMonthly);
    expect(claims()).toHaveLength(1);
    expect(claims()[0].body).toEqual({ transactionId: 'tx-2', siteTransactionId: 'tx-1', domain: 'fadelab.com' });
    t = texts(tree);
    expect(t).toContain('Registering…');

    for (const want of ['Linking…', 'Live in a few minutes', 'Live']) {
      await w.act(async () => {
        await jest.advanceTimersByTimeAsync(5_100);
      });
      expect(texts(tree)).toContain(want);
    }
    await w.act(async () => {
      await tick();
    });
    expect(live).toHaveBeenCalledTimes(1);
  });

  it('a double tap on an available name opens one paywall and sends one claim', async () => {
    await liveSite();
    const tree = await openScreen();
    let registers = 0;
    w.willBuy(DOMAIN_PRODUCT);
    const reg = w.sw.register;
    w.sw.register = async () => {
      registers++;
      await reg();
    };
    const row = rowFor(tree, 'fadelab.com');
    await w.act(async () => {
      row.props.onPress();
      row.props.onPress();
      await tick();
    });
    expect(registers).toBe(1);
    expect(claims()).toHaveLength(1);
  });

  it('an unused paid slot skips the paywall and claims directly', async () => {
    await liveSite();
    server.buy(DOMAIN_PRODUCT); // paid earlier, nothing claimed yet
    const tree = await openScreen();
    let registers = 0;
    w.sw.register = async () => {
      registers++;
    };
    await tap(rowFor(tree, 'thefadelab.com'));
    expect(registers).toBe(0);
    expect(claims()[0].body).toMatchObject({ transactionId: 'tx-2', siteTransactionId: 'tx-1', domain: 'thefadelab.com' });
    expect(texts(tree)).toContain('Registering…');
  });

  it('taken between search and claim: "pick another" on the same paid slot, no second payment', async () => {
    await liveSite();
    server.domainClaimTaken.add('fadelab.com');
    const tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain("Couldn't get that name — pick another");
    expect(button(tree, 'Try again')).toBeUndefined();
    await tap(button(tree, 'Pick another name'));
    await tap(button(tree, 'Search'));
    let registers = 0;
    w.sw.register = async () => {
      registers++;
    };
    await tap(rowFor(tree, 'fadelabcuts.com'));
    expect(registers).toBe(0);
    expect(claims().map((c) => c.body.domain)).toEqual(['fadelab.com', 'fadelabcuts.com']);
    expect(claims()[1].body.transactionId).toBe('tx-2');
    expect(texts(tree)).toContain('Registering…');
  });

  it('a registrar failure the server can retry: Try again claims the same name again', async () => {
    await liveSite();
    const tree = await openScreen();
    server.nextClaim = { status: 409, body: { error: 'claim-failed', domain: 'fadelab.com', state: 'failed:registrar', canRetry: true } };
    w.willBuy(DOMAIN_PRODUCT);
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain("The registrar couldn't complete it.");
    await tap(button(tree, 'Try again'));
    expect(claims()).toHaveLength(2);
    expect(claims()[1].body).toEqual(claims()[0].body);
    expect(texts(tree)).toContain('Registering…');
  });

  it('site-has-domain: the support line, nothing else to do', async () => {
    await liveSite();
    const tree = await openScreen();
    server.nextClaim = { status: 409, body: { error: 'site-has-domain' } };
    w.willBuy(DOMAIN_PRODUCT);
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain('Email support@davoxa.com');
  });

  it('a cancelled domain shows the date it works until', async () => {
    await liveSite();
    const d = server.buy(DOMAIN_PRODUCT);
    server.domains.set(d.transactionId, { domain: 'fadelab.com', states: [{ state: 'cancelled-until:2027-03-05T12:00:00Z' }] });
    const tree = await openScreen();
    expect(texts(tree)).toContain('fadelab.com');
    expect(texts(tree)).toContain('Cancelled — works until March 5, 2027');
  });

  it('a domain slot already holding another name: its status, no second claim', async () => {
    await liveSite();
    const d = server.buy(DOMAIN_PRODUCT);
    server.domains.set(d.transactionId, { domain: 'oldname.com', states: [{ state: 'live' }] });
    const tree = await openScreen();
    expect(texts(tree)).toContain('oldname.com');
    expect(texts(tree)).toContain('Live');
    expect(claims()).toHaveLength(0);
  });

  it('killed after the claim started: the relaunch shows the progress and keeps following it', async () => {
    await liveSite();
    let tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    server.fail('/api/ios/domain/claim', { kind: 'dead' });
    void w.act(async () => {
      rowFor(tree, 'fadelab.com').props.onPress();
      await tick();
    });
    await tick();
    // The server did take the claim (its row exists); the phone died before the answer.
    server.domains.set('tx-2', { domain: 'fadelab.com', states: [{ state: 'registering' }, { state: 'registering' }, { state: 'linking' }] });
    w = await kill(w);
    tree = await openScreen();
    expect(texts(tree)).toContain('fadelab.com');
    expect(texts(tree)).toContain('Registering…');
    expect(claims()).toHaveLength(1); // nothing re-sent: the server has it
  });

  // Review 5: killed before the claim reached the server: the remembered claim is sent again.
  it('killed before the claim reached the server: the relaunch sends it again (no second payment)', async () => {
    await liveSite();
    let tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    server.fail('/api/ios/domain/claim', { kind: 'dead' }); // the request never lands: no row on the server
    void w.act(async () => {
      rowFor(tree, 'fadelab.com').props.onPress();
      await tick();
    });
    await tick();
    expect(server.domains.size).toBe(0);
    w = await kill(w);
    // At launch (ResumePublish runs this after the publish retry).
    const { resumeDomainClaim } = require('@/lib/domains/resume');
    const s1 = await resumeDomainClaim('tx-2');
    expect(s1).toMatchObject({ domain: 'fadelab.com', state: 'registering' });
    expect(claims()).toHaveLength(2);
    expect(claims()[1].body).toEqual(claims()[0].body);
    expect(server.apple.filter((a) => a.productId === DOMAIN_PRODUCT)).toHaveLength(1);
    tree = await openScreen();
    expect(texts(tree)).toContain('fadelab.com');
  });

  // Review 1: the phone gave up (timeout / 5xx) after the claim was sent: status takes over.
  it('a claim answer lost after it was sent (5xx): the screen follows the server\'s progress instead of an error', async () => {
    await liveSite();
    const tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    server.before['/api/ios/domain/claim'] = [() => {
      server.domains.set('tx-2', { domain: 'fadelab.com', states: [{ state: 'registering' }] });
    }];
    server.fail('/api/ios/domain/claim', { kind: 'html', status: 504 });
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain('Registering…');
    expect(texts(tree)).not.toContain("Couldn't reach");
  });

  it('offline before anything reached the server: the offline message, the record kept for the retry', async () => {
    await liveSite();
    const tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    server.fail('/api/ios/domain/claim', { kind: 'offline' });
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain("Couldn't reach Prime Barber. Check your connection");
    expect(await require('@/lib/domains/api').loadDomainClaim()).toMatchObject({ domain: 'fadelab.com', transactionId: 'tx-2', siteTransactionId: 'tx-1' });
  });

  it('rate-limited: its own message, not "offline"', async () => {
    await liveSite();
    const tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    server.nextClaim = { status: 429, body: { error: 'rate-limited' } };
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain('Too many tries. Wait a minute and try again.');
  });

  // Review 4: an expired domain is renewed through the domain paywall, which re-attaches the same name.
  it('expired: Renew opens the domain paywall, then claims the same name', async () => {
    await liveSite();
    const d = server.buy(DOMAIN_PRODUCT);
    d.isActive = false;
    server.domains.set(d.transactionId, { domain: 'fadelab.com', states: [{ state: 'expired' }] });
    await require('@/lib/domains/api').saveDomainClaim({ transactionId: d.transactionId, domain: 'fadelab.com', siteTransactionId: 'tx-1' });
    const tree = await openScreen();
    expect(texts(tree)).toContain('Expired');
    let registers = 0;
    w.willBuy(DOMAIN_PRODUCT);
    const reg = w.sw.register;
    w.sw.register = async () => {
      registers++;
      await reg();
    };
    await tap(button(tree, 'Renew'));
    expect(registers).toBe(1);
    expect(claims().at(-1)?.body).toMatchObject({ domain: 'fadelab.com', transactionId: 'tx-3', siteTransactionId: 'tx-1' });
    expect(texts(tree)).toContain('Registering…');
  });

  // Review 8: one read at a time; 30 s while only the secure connection is pending; stop after 15 min.
  it('SSL pending: polls every 30 s, then stops after 15 minutes with a "check back soon" note', async () => {
    await liveSite();
    server.domainScript = [{ state: 'live', vercel: { verified: true, dnsOk: true, ssl: 'pending' } }];
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    fake = true;
    const tree = await openScreen();
    w.willBuy(DOMAIN_PRODUCT);
    await tap(rowFor(tree, 'fadelab.com'));
    expect(texts(tree)).toContain('Live in a few minutes');
    const reads = () => server.calls.filter((c) => c.path === '/api/ios/domain/status').length;
    const before = reads();
    await w.act(async () => {
      await jest.advanceTimersByTimeAsync(29_000);
    });
    expect(reads()).toBe(before);
    await w.act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(reads()).toBe(before + 1);
    await w.act(async () => {
      await jest.advanceTimersByTimeAsync(16 * 60_000);
    });
    const after = reads();
    expect(texts(tree)).toContain('check back soon');
    await w.act(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(reads()).toBe(after);
  });
});

describe('review fixes: helpers', () => {
  it('the claim waits past the server\'s 140 s step cutoff', () => {
    expect(CLAIM_TIMEOUT_MS).toBeGreaterThanOrEqual(150_000);
  });

  it('expired and subscription-inactive offer Renew (never "pick another")', () => {
    expect(statusView({ domain: 'a.com', state: 'expired' })).toMatchObject({ renew: true, pickAnother: false });
    expect(statusView({ domain: 'a.com', state: 'failed:subscription-inactive', canRetry: true })).toMatchObject({
      renew: true, pickAnother: false, title: "Your domain subscription isn't active",
    });
  });

  it('retry-later messages are distinct from offline', () => {
    const offline = retryLaterMessage('network');
    for (const c of ['rate-limited', 'invalid', 'apple-unavailable', 'domains-unavailable']) expect(retryLaterMessage(c)).not.toBe(offline);
    expect(claimOutcome(400, { error: 'invalid', field: 'domain' })).toEqual({ kind: 'retry-later', code: 'invalid' });
  });

  it('a remembered claim for another domain subscription or another site is dropped', () => {
    const rec = { transactionId: '1', domain: 'a.com', siteTransactionId: 's1' };
    expect(rememberedClaim(rec, '1', 's1')).toBe(rec);
    expect(rememberedClaim(rec, null, 's1')).toBe(rec); // ended subscription: keep, to show its state
    expect(rememberedClaim(rec, '2', 's1')).toBeNull();
    expect(rememberedClaim(rec, '1', 's2')).toBeNull();
  });

  it('the plan lapse check sees ACTIVE only with a plan entitlement (a domain-only ACTIVE is not a plan)', () => {
    const { planSuperwallStatus } = require('@/lib/paywall');
    expect(planSuperwallStatus({ status: 'ACTIVE', entitlements: [{ id: 'domain' }] })).toBe('INACTIVE');
    expect(planSuperwallStatus({ status: 'ACTIVE', entitlements: [{ id: 'domain' }, { id: 'hosting' }] })).toBe('ACTIVE');
    expect(planSuperwallStatus({ status: 'INACTIVE' })).toBe('INACTIVE');
    expect(planSuperwallStatus({ status: 'UNKNOWN' })).toBe('UNKNOWN');
    expect(planSuperwallStatus(null)).toBe('UNKNOWN');
  });

  it('the Settings custom-domain card shows the examples, not the registrant disclosure (that is fine print on the domain screen)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/app/(tabs)/settings.tsx'), 'utf8');
    expect(src).toMatch(/function DomainCard[\s\S]*DOMAIN_EXAMPLES_LINE/);
    expect(src).not.toMatch(/DOMAIN_DISCLOSURE/);
    const dom = fs.readFileSync(path.join(__dirname, '../../src/app/domain.tsx'), 'utf8');
    expect(dom).toMatch(/pillAccent[\s\S]*barbershop\.com/);
    expect(dom).toMatch(/fontSize: 11[^\n]*\n?/);
    expect(DOMAIN_EXAMPLES_LINE).toBe('jagsbarbershop.com · eileensbarbercuts.com · donaldsbarbers.com');
  });
});
