// Emails for iOS customers: welcome, "your website isn't live yet" (24 h / 72 h), payment problem / subscription ended.
// Plain light letters in the style of failedPaymentEmail (same default From, same Reply-To, same footer).
// Rules the text obeys (tests/ios/emails.test.ts pins them): no prices; no other company name except "Apple" where the
// reader is told to use their Apple ID subscription settings; the ONLY links are the live site address (welcome, when the
// site is already published) and nothing else. Never /api/web-app/continue, never a sign-in link (it would send an iOS
// customer into the web editor and its Stripe checkout). The app has no documented universal link in this repo, so the
// text says "open the Prime Barber app" with no link.
import { esc, firstOf, replyToAddress, type Mail } from '../webApp/emails.js';

export type IosEmailSwitch = 'IOS_EMAIL_WELCOME' | 'IOS_EMAIL_NOT_LIVE' | 'IOS_EMAIL_BILLING';
/** A switch is ON only when the variable is exactly "1". Read per call so tests and env changes apply. */
export const iosEmailOn = (name: IosEmailSwitch, env: Record<string, string | undefined> = process.env): boolean => env[name] === '1';

export const IOS_EMAIL_FOOTER = 'You are getting this because you have a Prime Barber plan. Questions? Reply to this email.';
const OPT_OUT = 'If you would rather not get these reminders, reply "stop" and we will not send them again.';

interface Letter { headline: string; paragraphs: string[]; link?: { label: string; href: string }; footer?: string[]; tag: string }

function letter(subject: string, l: Letter): Mail {
  const footer = [...(l.footer ?? []), IOS_EMAIL_FOOTER];
  const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:22px">${esc(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111">
<p style="margin:0 0 12px;font-size:16px;font-weight:600">${esc(l.headline)}</p>
${l.paragraphs.map(p).join('\n')}
${l.link ? `<p style="margin:0 0 16px;font-size:15px"><a href="${esc(l.link.href)}" style="color:#0b57d0">${esc(l.link.label)}</a></p>` : ''}
${footer.map((t) => `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:#666">${esc(t)}</p>`).join('\n')}
</body></html>`;
  const text = [l.headline, '', ...l.paragraphs.flatMap((t) => [t, '']), ...(l.link ? [`${l.link.label}: ${l.link.href}`, ''] : []), ...footer].join('\n');
  return { subject, html, text, replyTo: replyToAddress(), tags: [{ name: 'kind', value: l.tag }] };
}

const withName = (first: string, rest: string) => (first ? `${first}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1));
const hi = (first: string) => (first ? `Hi ${first},` : 'Hi there,');

export interface IosMailInput { firstName?: string | null; /** https live address; only set once the site is published. */ siteUrl?: string | null }

export function iosWelcomeEmail(i: IosMailInput): Mail {
  const first = firstOf(i.firstName);
  const subject = `${first ? `Welcome ${first}! ` : 'Welcome! '}Barber plan active`;
  if (i.siteUrl) {
    return letter(subject, {
      headline: "You're signed up", tag: 'ios_welcome',
      paragraphs: [hi(first), 'Your Prime Barber plan is active and your website is live. To change it, open the Prime Barber app. Your address:'],
      link: { label: i.siteUrl.replace(/^https?:\/\//, ''), href: i.siteUrl },
      footer: [],
    });
  }
  return letter(subject, {
    headline: "You're signed up", tag: 'ios_welcome',
    paragraphs: [hi(first), 'Your Prime Barber plan is active and your website is being set up. Open the Prime Barber app to see it and make changes.'],
  });
}

export function iosNotLiveEmail(step: 1 | 2, i: IosMailInput): Mail {
  const first = firstOf(i.firstName);
  if (step === 1) {
    return letter(withName(first, "your website isn't live yet"), {
      headline: "Your website isn't live yet", tag: 'ios_not_live_1',
      paragraphs: [hi(first), 'Your Prime Barber account is ready, but your website has not gone live yet. Open the Prime Barber app and tap Publish website to put it online.', 'If something got in the way, reply to this email and tell us. We read every reply.'],
      footer: [OPT_OUT],
    });
  }
  return letter(withName(first, 'your website is still waiting'), {
    headline: 'Your website is still not live', tag: 'ios_not_live_2',
    paragraphs: [hi(first), 'Just checking in. Your Prime Barber website has not gone live yet, and it is quick to finish. Open the Prime Barber app and tap Publish website.', 'If you got stuck, reply to this email and we will help you get it online.'],
    footer: [OPT_OUT],
  });
}

export type BillingKind = 'renewal_failed' | 'expired';
const APPLE_STEPS = 'Open Settings on your iPhone, tap your name, then Subscriptions.';

/** `graceKept`: Apple reported the failed renewal with a billing grace period (the plan still works while Apple retries). */
export function iosBillingEmail(kind: BillingKind, i: IosMailInput & { graceKept?: boolean }): Mail {
  const first = firstOf(i.firstName);
  if (kind === 'renewal_failed') {
    return letter(first ? `${first}, about your Prime Barber plan` : 'About your Prime Barber plan', {
      headline: 'Your renewal needs attention', tag: 'ios_billing_failed',
      paragraphs: [
        hi(first),
        `Apple could not renew your Prime Barber plan.${i.graceKept ? ' Your website stays online while Apple tries again.' : ''} To keep your website online, update your payment method in your Apple ID subscription settings.`,
        APPLE_STEPS,
      ],
    });
  }
  return letter(first ? `${first}, your Prime Barber plan has ended` : 'Your Prime Barber plan has ended', {
    headline: 'Your plan has ended', tag: 'ios_billing_expired',
    paragraphs: [
      hi(first),
      'Your Prime Barber plan has ended, so your website will not stay online. We keep your website, and you can bring it back by subscribing again in your Apple ID subscription settings.',
      APPLE_STEPS,
    ],
  });
}
