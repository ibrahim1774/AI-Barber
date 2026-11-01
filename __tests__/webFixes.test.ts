import { Platform } from 'react-native';
import { cardState, stripeReturnBanner, stripeReturnParam, pollingOpen, STRIPE_POLL_MS, STRIPE_POLL_WINDOW_MS, STRIPE_VERIFYING } from '@/lib/stripeWeb';
import { setWebPlanActive, isWebPlanActive, webPlanReady } from '@/lib/webPlan';
import { toShop } from '@/lib/shop';
import { draftErrors, emptyDraft, hasLongWord } from '@/lib/setup/serviceDraft';
import { validateDraft, emptyDraft as emptyProduct } from '@/lib/store/productDraft';
import { PHOTO_FORMAT_MESSAGE, PhotoFormatError, photoFailMessage } from '@/lib/photos';

const setOS = (os: string) => { (Platform as any).OS = os; };
afterEach(() => setOS('ios'));

describe('Stripe status on web', () => {
  it('maps the status to a state', () => {
    expect(cardState({ connected: true, chargesEnabled: true, detailsSubmitted: true })).toBe('on');
    expect(cardState({ connected: true, chargesEnabled: false, detailsSubmitted: true })).toBe('verifying');
    expect(cardState({ connected: true, chargesEnabled: false, detailsSubmitted: false })).toBe('needs');
    expect(cardState({ connected: false, chargesEnabled: false, detailsSubmitted: false })).toBe('none');
  });
  it('polls every 5 s for 3 minutes', () => {
    expect(STRIPE_POLL_MS).toBe(5000);
    expect(STRIPE_POLL_WINDOW_MS).toBe(180000);
    expect(pollingOpen(1000, 999)).toBe(true);
    expect(pollingOpen(1000, 1000)).toBe(false);
  });
  it('reads the return param and words the banner', () => {
    expect(stripeReturnParam('return')).toBe('return');
    expect(stripeReturnParam(['refresh'])).toBe('refresh');
    expect(stripeReturnParam('x')).toBeNull();
    expect(stripeReturnBanner('return', 'verifying').text).toBe(STRIPE_VERIFYING);
    expect(stripeReturnBanner('refresh', 'needs').text).toMatch(/expired/);
    expect(stripeReturnBanner('return', 'needs').text).toMatch(/not finished/);
    expect(stripeReturnBanner('return', 'on').tone).toBe('ok');
  });
});

describe('web plan counts as the linked purchase', () => {
  const row = { id: 's', slug: 'x', name: 'X' };
  it('iOS ignores the web plan', () => {
    setWebPlanActive(true);
    expect(toShop(row).purchaseLinked).toBe(false);
    expect(toShop({ ...row, ios_otid: '1' }).purchaseLinked).toBe(true);
  });
  it('web is linked with an active web plan or an ios_otid', async () => {
    setOS('web');
    setWebPlanActive(false);
    expect(toShop(row).purchaseLinked).toBe(false);
    setWebPlanActive(true);
    expect(isWebPlanActive()).toBe(true);
    expect(toShop(row).purchaseLinked).toBe(true);
    await expect(webPlanReady(10)).resolves.toBeUndefined();
  });
});

describe('single-word limit (web only)', () => {
  const long = 'x'.repeat(31);
  it('finds a word over 30', () => {
    expect(hasLongWord(long)).toBe(true);
    expect(hasLongWord('x'.repeat(30) + ' ok')).toBe(false);
    expect(hasLongWord('Fade and beard trim')).toBe(false);
  });
  it('is enforced on web for services and products, not on iOS', () => {
    expect(draftErrors({ ...emptyDraft(long) }).name).toBeUndefined();
    expect(validateDraft({ ...emptyProduct(), name: long, price: '10' }).name).toBeUndefined();
    setOS('web');
    expect(draftErrors({ ...emptyDraft(long) }).name).toMatch(/30 characters/);
    expect(validateDraft({ ...emptyProduct(), name: long, price: '10' }).name).toMatch(/30 characters/);
    expect(draftErrors({ ...emptyDraft('Haircut') }).name).toBeUndefined();
  });
});

describe('photo format message', () => {
  it('only a format error gets the advice', () => {
    expect(photoFailMessage(new PhotoFormatError(), 'x')).toBe(PHOTO_FORMAT_MESSAGE);
    expect(photoFailMessage(new Error('net'), 'fallback')).toBe('fallback');
    expect(PHOTO_FORMAT_MESSAGE).toMatch(/JPG or PNG/);
  });
});
