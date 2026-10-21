import React, { useEffect, useMemo, useState } from 'react';
import { ApiError, type Api } from './api';
import { DayPicker, TimePicker } from './pickers';
import {
  bookingErrorMessage, buildIcs, directionsUrl, rescheduleErrorMessage, sentErrorMessage, eligibleMembers, formatMoney, formatWhen, manualAmountCents, manualLink, manualMethods,
  METHOD_LABEL, nextStep, onAccent, parseRoute, payOptions, prevStep, progress, safeAccent, serviceLabel, telUrl,
  tokenFromManageUrl, type Step, formatDay, parseCheckout, shouldKeepPolling, resolveIds, CHECKOUT_POLL_MS, type CheckoutReturn,
} from './logic';
import type { BookedAppointment, ManageResponse, ManualMethod, Member, PayChoice, Service, Shop, ShopResponse, Slot } from './types';

export function App({ api, pathname, search = '' }: { api: Api; pathname: string; search?: string }) {
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  if (route.kind === 'book') return <BookPage api={api} slug={route.slug} />;
  if (route.kind === 'manage') return <ManagePage api={api} token={route.token} checkout={parseCheckout(search)} />;
  return <Shell><Message title="Page not found" body="Check the link and try again." /></Shell>;
}

function applyAccent(accent: string | null | undefined) {
  const a = safeAccent(accent);
  const r = document.documentElement.style;
  r.setProperty('--accent', a);
  r.setProperty('--on-accent', onAccent(a));
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="wrap">{children}</main>;
}
function Message({ title, body }: { title: string; body?: string }) {
  return <div className="center" role="alert"><h1>{title}</h1>{body && <p className="sub">{body}</p>}</div>;
}
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function Avatar({ name, url }: { name: string; url: string | null }) {
  return url ? <img className="avatar" src={url} alt="" /> : <span className="avatar" aria-hidden>{initials(name)}</span>;
}
function Spinner() { return <p className="spin" role="status">Loading…</p>; }

/* ===================== booking flow ===================== */

type Loaded = Extract<ShopResponse, { paused: false }>;

function BookPage({ api, slug }: { api: Api; slug: string }) {
  const [data, setData] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);
  useEffect(() => {
    api.shop(slug).then((d) => { setData(d); if (!d.paused) { const ok = d as Loaded; applyAccent(ok.shop.accent); document.title = `Book at ${ok.shop.name}`; } })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'not-found' : 'failed'));
  }, [slug]);
  if (error === 'not-found') return <Shell><Message title="Shop not found" body="This booking link isn't active." /></Shell>;
  if (error) return <Shell><Message title="Something went wrong" body="Please refresh and try again." /></Shell>;
  if (!data) return <Shell><Spinner /></Shell>;
  if (data.paused) return <Shell><Message title={data.shop.name} body="Bookings are paused for now — call the shop." /></Shell>;
  return <Shell><Flow api={api} d={data as Loaded} /></Shell>;
}

function Flow({ api, d }: { api: Api; d: Loaded }) {
  const { shop, services, members } = d;
  const tz = shop.timezone;
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<Service | null>(null);
  const [memberId, setMemberId] = useState('any');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [cust, setCust] = useState({ name: '', phone: '', email: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [alts, setAlts] = useState<Slot[]>([]);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState<{ appt: BookedAppointment; method: ManualMethod | null } | null>(null);

  const elig = eligibleMembers(members, service?.id ?? null);
  const options = payOptions(shop.pay);
  // One payment row per manual method, so a shop with several handles always reaches the payment step.
  const mm = manualMethods(shop.pay.manual);
  const rowCount = options.filter((o) => o !== 'manual').length + mm.length;
  const ctx = { barberCount: elig.length, payOptionCount: rowCount };
  const go = (s: Step) => { setProblem(null); setAlts([]); setStep(s); };
  const back = () => go(prevStep(step, ctx));
  const pr = progress(step, ctx);

  async function submit(pay: PayChoice, method?: ManualMethod) {
    if (!service || !slot) return;
    setBusy(true); setProblem(null); setAlts([]);
    try {
      const r = await api.book({
        slug: shop.slug, serviceId: service.id, memberId: memberId === 'any' ? 'any' : memberId,
        start: slot.start, customer: { name: cust.name.trim(), phone: cust.phone.trim(), email: cust.email.trim() },
        note: cust.note.trim() || undefined, pay, ...(pay === 'manual' && method ? { method } : {}),
      });
      if (pay === 'card' && r.checkoutUrl) { window.location.assign(r.checkoutUrl); return; }
      setDone({ appt: r.appointment, method: pay === 'manual' ? method ?? null : null });
      setStep('confirmed');
    } catch (e) {
      if (!(e instanceof ApiError)) setProblem('Something went wrong. Please try again.');
      else if (e.status === 423) setPaused(true);
      else if (e.status === 409 && e.code === 'slot-taken') {
        setProblem('Sorry, that time was just taken.'); setAlts(e.alternatives);
        if (!e.alternatives.length) setStep('time');
      } else {
        setProblem(bookingErrorMessage(e));
        if (e.status === 400) setStep(e.field === 'method' ? 'payment' : 'details');
      }
    } finally { setBusy(false); }
  }

  if (paused) return <Message title={shop.name} body="Bookings are paused for now — call the shop." />;
  if (step === 'confirmed' && done) return <Confirmation api={api} shop={shop} appt={done.appt} method={done.method} />;

  const header = (
    <>
      <h1>{shop.name}</h1>
      {shop.address && <p className="sub">{shop.address}</p>}
    </>
  );
  const topbar = step !== 'service' && (
    <div className="top">
      <button className="back" onClick={back} aria-label="Back">‹ Back</button>
      <div className="bar" role="progressbar" aria-valuemin={1} aria-valuemax={pr.total} aria-valuenow={pr.index}><i style={{ width: `${(pr.index / pr.total) * 100}%` }} /></div>
    </div>
  );
  const altsBlock = problem && (
    <div className="note warn" role="alert">
      <p style={{ margin: 0 }}>{problem}</p>
      {alts.length > 0 && <>
        <p className="sub">Next free times:</p>
        <div className="times">
          {alts.map((a) => <button key={a.start + a.memberId} className="time" onClick={() => { setSlot(a); setMemberId(memberId === 'any' ? 'any' : a.memberId); go('details'); }}>{formatDay(a.start, tz)}<br />{formatWhen(a.start, tz).split(' at ')[1]}</button>)}
        </div>
        <button className="btn ghost" onClick={() => go('day')}>Pick another day</button>
      </>}
    </div>
  );

  return (
    <div>
      {header}{topbar}
      {step === 'service' && <>
        <h2>Choose a service</h2>
        {services.map((s) => (
          <button key={s.id} className="row" onClick={() => {
            setService(s); setSlot(null); setDate(null);
            const e = eligibleMembers(members, s.id);
            setMemberId('any');
            setStep(e.length > 1 ? 'barber' : 'day');
          }}>
            <span className="grow"><div className="t">{s.name}</div><div className="m">{serviceLabel(s)}</div>{s.description && <div className="m">{s.description}</div>}</span>
            <span aria-hidden>›</span>
          </button>
        ))}
      </>}
      {step === 'barber' && <>
        <h2>Choose a barber</h2>
        <button className="row" onClick={() => { setMemberId('any'); go('day'); }}><span className="avatar" aria-hidden>★</span><span className="grow"><div className="t">Any available</div><div className="m">First free barber</div></span></button>
        {elig.map((m: Member) => (
          <button key={m.id} className="row" onClick={() => { setMemberId(m.id); go('day'); }}>
            <Avatar name={m.name} url={m.photoUrl} /><span className="grow"><div className="t">{m.name}</div>{m.bio && <div className="m">{m.bio}</div>}</span>
          </button>
        ))}
      </>}
      {step === 'day' && service && <>
        <h2>Pick a day</h2>
        <DayPicker api={api} slug={shop.slug} serviceId={service.id} memberId={memberId} tz={tz} selected={date} onPick={(dt) => { setDate(dt); go('time'); }} />
      </>}
      {step === 'time' && service && date && <>
        <h2>Pick a time</h2>
        <TimePicker api={api} slug={shop.slug} serviceId={service.id} memberId={memberId} tz={tz} date={date} onPick={(s) => { setSlot(s); go('details'); }} />
      </>}
      {step === 'details' && service && slot && <>
        <h2>Your details</h2>
        <Summary service={service} slot={slot} tz={tz} members={members} memberId={memberId} />
        <DetailsForm cust={cust} setCust={setCust} busy={busy}
          submitLabel={ctx.payOptionCount > 1 ? 'Continue' : options[0] === 'card' ? 'Continue to payment' : 'Book'}
          onSubmit={() => { ctx.payOptionCount > 1 ? go('payment') : submit(options[0], options[0] === 'manual' ? mm[0] : undefined); }} />
        {altsBlock}
      </>}
      {step === 'payment' && service && slot && <>
        <h2>How would you like to pay?</h2>
        <Summary service={service} slot={slot} tz={tz} members={members} memberId={memberId} />
        {options.includes('shop') && <button className="row" disabled={busy} onClick={() => submit('shop')}><span className="grow"><div className="t">Pay in shop</div><div className="m">Settle up at your appointment</div></span></button>}
        {options.includes('card') && <button className="row" disabled={busy} onClick={() => submit('card')}><span className="grow"><div className="t">Pay online by card</div><div className="m">{service.depositCents > 0 ? `${formatMoney(service.depositCents)} deposit` : 'Card or Apple Pay'}, secure checkout</div></span></button>}
        {options.includes('manual') && manualMethods(shop.pay.manual).map((m) => <button key={m} className="row" disabled={busy} onClick={() => submit('manual', m)}><span className="grow"><div className="t">{METHOD_LABEL[m]}</div><div className="m">Book now, then send payment</div></span></button>)}
        {busy && <Spinner />}
        {altsBlock}
      </>}
      {problem && !['details', 'payment'].includes(step) && <p className="err" role="alert">{problem}</p>}
    </div>
  );
}

function Summary({ service, slot, tz, members, memberId }: { service: Service; slot: Slot; tz: string; members: Member[]; memberId: string }) {
  const m = members.find((x) => x.id === (memberId === 'any' ? slot.memberId : memberId));
  return (
    <div className="summary">
      <div><span>Service</span><span>{service.name} · {formatMoney(service.priceCents) || 'Price at shop'}</span></div>
      <div><span>When</span><span>{formatWhen(slot.start, tz)}</span></div>
      {m && <div><span>Barber</span><span>{m.name}</span></div>}
    </div>
  );
}

function DetailsForm({ cust, setCust, onSubmit, submitLabel, busy }: {
  cust: { name: string; phone: string; email: string; note: string };
  setCust: (c: any) => void; onSubmit: () => void; submitLabel: string; busy: boolean;
}) {
  const [tried, setTried] = useState(false);
  const bad = {
    name: cust.name.trim().length < 2,
    phone: cust.phone.replace(/\D/g, '').length < 7,
    email: !/^\S+@\S+\.\S+$/.test(cust.email.trim()),
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCust({ ...cust, [k]: e.target.value });
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); setTried(true); if (!bad.name && !bad.phone && !bad.email) onSubmit(); }}>
      <label htmlFor="n">Name</label>
      <input id="n" autoComplete="name" value={cust.name} onChange={set('name')} aria-invalid={tried && bad.name} required />
      <label htmlFor="p">Phone</label>
      <input id="p" type="tel" autoComplete="tel" inputMode="tel" value={cust.phone} onChange={set('phone')} aria-invalid={tried && bad.phone} required />
      <label htmlFor="e">Email</label>
      <input id="e" type="email" autoComplete="email" value={cust.email} onChange={set('email')} aria-invalid={tried && bad.email} required />
      <label htmlFor="o">Note (optional)</label>
      <textarea id="o" rows={2} value={cust.note} onChange={set('note')} />
      {tried && (bad.name || bad.phone || bad.email) && <p className="err" role="alert">Please fill in your name, phone and a valid email.</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Booking…' : submitLabel}</button>
    </form>
  );
}

/* ===================== confirmation ===================== */

function downloadIcs(a: { id: string; start: string; end: string; summary: string; location?: string | null }) {
  const blob = new Blob([buildIcs(a)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = 'appointment.ics';
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Confirmation({ api, shop, appt, method }: { api: Api; shop: Shop; appt: BookedAppointment; method: ManualMethod | null }) {
  const tz = shop.timezone;
  const token = tokenFromManageUrl(appt.manageUrl);
  const amount = manualAmountCents(appt.priceCents, appt.depositCents);
  return (
    <div className="center">
      <div className="check" aria-hidden>✓</div>
      <h1>You're booked</h1>
      <div className="summary" style={{ textAlign: 'left' }}>
        <div><span>Service</span><span>{appt.serviceName}</span></div>
        <div><span>When</span><span>{formatWhen(appt.start, tz)}</span></div>
        <div><span>Barber</span><span>{appt.memberName}</span></div>
        {shop.address && <div><span>Where</span><span>{shop.address}</span></div>}
      </div>
      {method && shop.pay.manual[method] && <ManualPay api={api} shop={shop} method={method} token={token} cents={amount} note={`${appt.serviceName} ${formatDay(appt.start, tz)}`} />}
      <button className="btn" onClick={() => downloadIcs({ id: appt.id, start: appt.start, end: appt.end, summary: `${appt.serviceName} at ${shop.name}`, location: shop.address })}>Add to calendar</button>
      {shop.address && <a className="btn ghost" href={directionsUrl(shop.address)} target="_blank" rel="noopener">Get directions</a>}
      <a className="btn ghost" href={appt.manageUrl}>Manage booking</a>
      <p className="sub">We emailed you a confirmation with this link.</p>
    </div>
  );
}

function ManualPay({ api, shop, method, token, cents, note }: { api: Api; shop: Shop; method: ManualMethod; token: string; cents: number | null; note: string }) {
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function mark() {
    setErr(null);
    try { await api.sent(token, method); setSent(true); }
    catch (e) { setErr(sentErrorMessage(e instanceof ApiError ? e : null)); }
  }
  if (sent) return <div className="note" role="status">Thanks! {shop.name} will confirm your {METHOD_LABEL[method]} payment.</div>;
  const handle = shop.pay.manual[method]!;
  const link = manualLink(method, handle, cents, note);
  return (
    <div className="note" style={{ textAlign: 'left' }}>
      <strong>Send payment{cents ? ` of ${formatMoney(cents)}` : ''}</strong>
      {link
        ? <a className="btn ghost" href={link} target="_blank" rel="noopener">Pay with {METHOD_LABEL[method]}</a>
        : <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(handle).catch(() => {}); setCopied(true); }}>
            {copied ? `Copied ${handle}` : `${METHOD_LABEL[method]}: ${handle} (tap to copy)`}
          </button>}
      <button className="btn" onClick={mark}>I've sent it</button>
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

/* ===================== manage ===================== */

function ManagePage({ api, token, checkout }: { api: Api; token: string; checkout: CheckoutReturn }) {
  const [data, setData] = useState<ManageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule' | 'cancelled'>('view');
  const [refund, setRefund] = useState(0);
  const load = () => api.manage(token).then((d) => { setData(d); applyAccent(null); }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'not-found' : 'failed'));
  useEffect(() => { load(); }, [token]);
  // After Stripe success the webhook may lag: re-fetch every 3 s, up to 30 s.
  const [gaveUp, setGaveUp] = useState(false);
  const status = data?.appointment.paymentStatus;
  useEffect(() => {
    if (checkout !== 'success' || !data) return;
    if (!shouldKeepPolling(status!, 0)) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (Date.now() - t0 >= 30000) { clearInterval(id); setGaveUp(true); return; }
      api.manage(token).then(setData).catch(() => {});
    }, CHECKOUT_POLL_MS);
    return () => clearInterval(id);
  }, [checkout, !!data, status]);

  if (error === 'not-found') return <Shell><Message title="Booking not found" body="This manage link isn't valid." /></Shell>;
  if (error) return <Shell><Message title="Something went wrong" body="Please refresh and try again." /></Shell>;
  if (!data) return <Shell><Spinner /></Shell>;
  const a = data.appointment, tz = a.shop.timezone;
  const live = a.status === 'booked';

  return (
    <Shell>
      <h1>{a.shop.name}</h1>
      {checkout === 'success' && mode === 'view' && (status === 'awaiting' && !gaveUp
        ? <div className="note" role="status"><strong>Confirming your payment…</strong></div>
        : status === 'awaiting'
          ? <div className="note" role="status"><strong>Payment received.</strong> It may take a moment to show up here.</div>
          : <div className="note" role="status"><strong>Payment received.</strong> Thank you!</div>)}
      {checkout === 'cancelled' && mode === 'view' && status === 'awaiting' && live &&
        <div className="note warn" role="status">Payment wasn't completed. This time is held for 30 minutes, then released.</div>}
      {mode === 'cancelled' && <div className="note" role="status"><strong>Booking cancelled.</strong>{refund > 0 && <> {formatMoney(refund)} will be refunded to your card.</>}</div>}
      {mode === 'view' || mode === 'cancelled' ? <>
        <div className="summary">
          <div><span>Status</span><span>{mode === 'cancelled' ? 'cancelled' : a.status}</span></div>
          <div><span>Service</span><span>{a.serviceName}</span></div>
          <div><span>When</span><span>{formatWhen(a.start, tz)}</span></div>
          <div><span>Barber</span><span>{a.memberName}</span></div>
          {a.priceCents != null && <div><span>Price</span><span>{formatMoney(a.priceCents)}</span></div>}
          {a.amountPaidCents > 0 && <div><span>Paid</span><span>{formatMoney(a.amountPaidCents)}</span></div>}
          {a.shop.address && <div><span>Where</span><span>{a.shop.address}</span></div>}
        </div>
        {mode === 'view' && live && <>
          <button className="btn" onClick={() => downloadIcs({ id: a.id, start: a.start, end: a.end, summary: `${a.serviceName} at ${a.shop.name}`, location: a.shop.address })}>Add to calendar</button>
          {a.shop.address && <a className="btn ghost" href={directionsUrl(a.shop.address)} target="_blank" rel="noopener">Get directions</a>}
          {data.canReschedule && <button className="btn ghost" onClick={() => setMode('reschedule')}>Reschedule</button>}
          {data.canCancel && <button className="btn danger" onClick={() => setMode('cancel')}>Cancel booking</button>}
          {!data.canCancel && !data.canReschedule && <p className="note">It's too close to your appointment to change it online.{a.shop.phone && <> Please <a href={telUrl(a.shop.phone)} style={{ color: 'var(--accent)' }}>call the shop</a>.</>}</p>}
        </>}
      </> : null}
      {mode === 'cancel' && <CancelConfirm api={api} token={token} refundCents={data.refundCentsIfCancelled}
        onBack={() => setMode('view')} onDone={() => { setRefund(data.refundCentsIfCancelled); setMode('cancelled'); }}
        onTooLate={() => { setMode('view'); load(); }} />}
      {mode === 'reschedule' && <Reschedule api={api} token={token} data={data} onBack={() => setMode('view')} onDone={() => { setMode('view'); load(); }} />}
    </Shell>
  );
}

function CancelConfirm({ api, token, refundCents, onBack, onDone, onTooLate }: {
  api: Api; token: string; refundCents: number; onBack: () => void; onDone: () => void; onTooLate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <h2>Cancel this booking?</h2>
      <p className="note">{refundCents > 0 ? `You'll be refunded ${formatMoney(refundCents)}.` : 'No payment will be refunded.'}</p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn danger" disabled={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { await api.cancel(token); onDone(); }
        catch (e) { if (e instanceof ApiError && e.status === 403) onTooLate(); else setErr('Could not cancel. Please try again.'); }
        finally { setBusy(false); }
      }}>{busy ? 'Cancelling…' : 'Yes, cancel booking'}</button>
      <button className="btn ghost" onClick={onBack}>Keep booking</button>
    </div>
  );
}

function Reschedule({ api, token, data, onBack, onDone }: { api: Api; token: string; data: ManageResponse; onBack: () => void; onDone: () => void }) {
  const a = data.appointment, tz = a.shop.timezone;
  const [info, setInfo] = useState<{ serviceId: string; memberId: string } | null | 'unavailable'>(null);
  const [date, setDate] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [alts, setAlts] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [shopData, setShopData] = useState<Loaded | null>(null);

  // Ids come from the manage API; name matching against the shop listing is only a fallback.
  useEffect(() => {
    api.shop(a.shop.slug).then((resp) => {
      if (resp.paused) return setInfo('unavailable');
      const s = resp as Loaded;
      const ids = resolveIds(a, s);
      if (!ids) return setInfo('unavailable');
      setShopData(s);
      setInfo(ids);
    }).catch(() => setInfo('unavailable'));
  }, []);

  async function pick(s: Slot) {
    setBusy(true); setProblem(null); setAlts([]);
    try { await api.reschedule(token, s.start, s.memberId); onDone(); }
    catch (e) {
      if (!(e instanceof ApiError)) setProblem('Something went wrong. Please try again.');
      else {
        setProblem(rescheduleErrorMessage(e));
        if (e.status === 409 && e.code === 'slot-taken') setAlts(e.alternatives);
      }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="top"><button className="back" onClick={date ? () => setDate(null) : onBack}>‹ Back</button></div>
      <h2>Reschedule</h2>
      {info === null && <Spinner />}
      {info === 'unavailable' && <p className="note warn">Rescheduling isn't available online. {a.shop.phone && <>Please <a href={telUrl(a.shop.phone)} style={{ color: 'var(--accent)' }}>call the shop</a>.</>}</p>}
      {info && info !== 'unavailable' && shopData && (!date
        ? <DayPicker api={api} slug={a.shop.slug} serviceId={info.serviceId} memberId={info.memberId} tz={tz} selected={null} onPick={setDate} />
        : <TimePicker api={api} slug={a.shop.slug} serviceId={info.serviceId} memberId={info.memberId} tz={tz} date={date} onPick={pick} />)}
      {busy && <Spinner />}
      {problem && <div className="note warn" role="alert"><p style={{ margin: 0 }}>{problem}</p>
        {alts.length > 0 && <div className="times" style={{ marginTop: 10 }}>{alts.map((s) => <button key={s.start} className="time" onClick={() => pick(s)}>{formatWhen(s.start, tz).replace(' at ', ' ')}</button>)}</div>}
      </div>}
    </div>
  );
}
