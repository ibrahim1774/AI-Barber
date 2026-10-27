import fs from 'fs';
import path from 'path';
import { cardPayoutNote, cardFeeNote } from '@/lib/setup/handles';
import { LEARN_TOPICS } from '@/lib/learnContent';

const root = path.join(__dirname, '..');
const src = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const topic = (slug: string) => (LEARN_TOPICS as any[]).find((t) => t.slug === slug).steps.join('\n');

describe('card payout and fee copy', () => {
  it('payout note is truthful about Stripe payouts and holds', () => {
    const t = cardPayoutNote();
    expect(t).toMatch(/your own Stripe account/);
    expect(t).toMatch(/schedule you set/);
    expect(t).toMatch(/Stripe Dashboard/);
    expect(t).toMatch(/disputes|holds/i);
    expect(t).not.toMatch(/automatically/);
  });
  it('fee note uses the shop percentage and states refund rules', () => {
    const t = cardFeeNote('3%');
    expect(t).toContain('3%');
    expect(t).toMatch(/Stripe charges you its own processing fee/);
    expect(t).toMatch(/proportionally/);
    expect(t).toMatch(/not Stripe's fee/);
    expect(t).toMatch(/directly in the Stripe Dashboard/);
  });
  it('GetPaid screen uses the notes, not the old claim', () => {
    const s = src('src/components/setup/GetPaid.tsx');
    expect(s).toContain('cardPayoutNote()');
    expect(s).toContain('cardFeeNote(fee)');
    expect(s).not.toMatch(/bank automatically/);
  });
  it.each(['get-paid', 'store-payments', 'payment-methods'])('learn topic %s has no automatic-payout claim', (slug) => {
    expect(topic(slug)).not.toMatch(/automatically/);
    expect(topic(slug)).not.toMatch(/AI Barber/);
  });
  it('learn get-paid and store-payments explain payouts, fees and refunds', () => {
    for (const slug of ['get-paid', 'store-payments']) {
      const t = topic(slug);
      expect(t).toMatch(/Stripe Dashboard/);
      expect(t).toMatch(/payout/i);
    }
    const g = topic('get-paid');
    expect(g).toMatch(/proportionally/);
    expect(g).toMatch(/directly in the Stripe Dashboard/);
  });
});
