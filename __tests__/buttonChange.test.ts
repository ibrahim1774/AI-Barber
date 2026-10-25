import { applyButtonChange } from '@/lib/buttonChange';
import { syncOwnLink } from '@/lib/bookingChoice';

const OWN = 'https://booksy.com/old';
const NEW = 'https://square.site/new';
const rec = (data: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): any => ({
  draftId: 'd', inputs: { shopName: 'Fade', area: '', phone: '', ...inputs },
  data: { shopName: 'Fade', phone: '(512) 555-0142', template: 'luxe', contact: { address: '1 Main St' }, bookingUrl: OWN, ...data },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
});

test('book: new link and the scheduler choice in one change; the link is remembered', () => {
  const cur = rec({}, { bookingChoice: 'own', ownBookingUrl: OWN });
  const out = syncOwnLink(cur, applyButtonChange(cur, 'bookButton', { text: 'Reserve', book: { choice: 'aibarber', url: NEW } }));
  expect(out.data.labels).toEqual({ bookButton: 'Reserve' });
  expect(out.inputs).toMatchObject({ bookingChoice: 'aibarber', ownBookingUrl: NEW });
  expect(out.data.bookingUrl).toBe('/book');
});

test('book: back to the link applies to the whole site', () => {
  const cur = rec({ bookingUrl: '/book' }, { bookingChoice: 'aibarber', ownBookingUrl: OWN });
  const out = syncOwnLink(cur, applyButtonChange(cur, 'bookButton', { text: '', book: { choice: 'own' } }));
  expect(out.inputs).toMatchObject({ bookingChoice: 'own', ownBookingUrl: OWN });
  expect(out.data.bookingUrl).toBe(OWN);
  expect(out.data.labels ?? {}).toEqual({});
});

test('call sets the phone, directions the address, neither touches the Book link', () => {
  const cur = rec({}, { bookingChoice: 'own', ownBookingUrl: OWN });
  const call = applyButtonChange(cur, 'callNow', { text: 'Ring us', phone: '+1 512 555 0199' });
  expect(call.data.phone).toBe('+1 512 555 0199');
  expect(call.data.bookingUrl).toBe(OWN);
  const dir = applyButtonChange(cur, 'pgDirectionsCta', { text: 'Find us', address: '2 Oak Ave' });
  expect(dir.data.contact?.address).toBe('2 Oak Ave');
  expect(dir.data.bookingUrl).toBe(OWN);
});

test('text for an unknown label key changes nothing', () => {
  const cur = rec();
  expect(applyButtonChange(cur, 'notALabel', { text: 'x' }).data).toEqual(cur.data);
});
