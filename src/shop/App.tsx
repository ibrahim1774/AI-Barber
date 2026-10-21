import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, type ShopApi } from './api';
import { addItem, cartTotals, loadCart, MAX_QTY, reconcile, removeItem, saveCart, setQty } from './cart';
import {
  CHANGED_MESSAGE, checkoutBody, directionsUrl, EMPTY_ADDRESS, EXPIRED_MESSAGE, formatAddress, formatMoney, manualLink, METHOD_LABEL,
  newClientKey, onAccent, parseShopRoute, paymentLine, payRows, placeOrder, safeAccent, sentErrorMessage, STATUS_LABEL, telUrl,
  tokenFromStatusUrl, validateCheckout, type AddressForm, type CheckoutState,
} from './logic';
import { CHECKOUT_POLL_MS, parseCheckout, shouldKeepPolling, type CheckoutReturn } from '../book/logic';
import type { Cart, Fulfilment, ManualMethod, OrderResponse, PayChoice, Product, ShopInfo, ShopResponse, StorageLike } from './types';

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

function getStorage(): StorageLike | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function applyAccent(accent: string | null | undefined) {
  const a = safeAccent(accent);
  const r = document.documentElement.style;
  r.setProperty('--accent', a);
  r.setProperty('--on-accent', onAccent(a));
}

function Shell({ children }: { children: React.ReactNode }) { return <main className="wrap">{children}</main>; }
function Message({ title, body }: { title: string; body?: string }) {
  return <div className="center" role="alert"><h1>{title}</h1>{body && <p className="sub">{body}</p>}</div>;
}
function Spinner() { return <p className="spin" role="status">Loading…</p>; }

export function App({ api, pathname, search = '' }: { api: ShopApi; pathname: string; search?: string }) {
  const route = useMemo(() => parseShopRoute(pathname), [pathname]);
  if (route.kind === 'shop') return <ShopPage api={api} slug={route.slug} />;
  if (route.kind === 'order') return <StatusPage api={api} token={route.token} checkout={parseCheckout(search)} />;
  return <Shell><Message title="We couldn't find this shop." body="Check the link and try again." /></Shell>;
}

/* ===================== shop ===================== */

type Loaded = Extract<ShopResponse, { paused: false }>;
type View = { kind: 'shop' } | { kind: 'checkout' } | { kind: 'status'; token: string };

function ShopPage({ api, slug }: { api: ShopApi; slug: string }) {
  const [data, setData] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);
  const [cart, setCartState] = useState<Cart>({ lines: [] });
  const [view, setView] = useState<View>({ kind: 'shop' });
  const [product, setProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const storage = useMemo(getStorage, []);

  const setCart = (c: Cart) => { setCartState(c); saveCart(slug, c, storage); };

  useEffect(() => {
    api.shop(slug).then((d) => {
      setData(d);
      if (d.paused) return;
      const ok = d as Loaded;
      applyAccent(ok.shop.accent);
      document.title = ok.shop.name;
      const r = reconcile(loadCart(slug, storage), ok.products);
      setCartState(r.cart);
      saveCart(slug, r.cart, storage);
      if (r.dropped.length) setNotice('Some items in your cart are no longer available.');
    }).catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'not-found' : 'failed'));
  }, [slug]);

  if (error === 'not-found') return <Shell><Message title="We couldn't find this shop." /></Shell>;
  if (error) return <Shell><Message title="Something went wrong" body="Please refresh and try again." /></Shell>;
  if (!data) return <Shell><Spinner /></Shell>;
  if (data.paused) return <Shell><Message title={`${data.shop.name}'s online shop is closed right now.`} /></Shell>;
  const d = data as Loaded;
  const { shop, products } = d;

  const refreshProducts = (fresh: Product[]) => {
    setData({ ...d, products: fresh });
    const r = reconcile(cart, fresh);
    setCart(r.cart);
  };
  const closed = () => setData({ paused: true, shop: { name: shop.name } });

  if (view.kind === 'status') return <Shell><StatusView api={api} token={view.token} checkout={null} fresh /></Shell>;

  if (view.kind === 'checkout') {
    return (
      <Shell>
        <Checkout
          api={api} shop={shop} products={products} cart={cart}
          onBack={() => setView({ kind: 'shop' })}
          onRefresh={refreshProducts}
          onSoldOut={(ids) => setCart({ lines: cart.lines.map((l) => (ids.includes(l.productId) ? { ...l, soldOut: true } : l)) })}
          onRemove={(id) => setCart(removeItem(cart, id))}
          onPaused={closed}
          onCreated={(token) => {
            setCart({ lines: [] });
            try { history.pushState({}, '', `/shop/manage/${encodeURIComponent(token)}`); } catch { /* ignore */ }
            setView({ kind: 'status', token });
          }}
        />
      </Shell>
    );
  }

  const totals = cartTotals(cart, products, 'pickup', 0);
  return (
    <Shell>
      <div className="head">
        <span className="logo" aria-hidden>{(shop.name[0] || '?').toUpperCase()}</span>
        <div className="meta">
          <h1>{shop.name}</h1>
          {shop.address && <a href={directionsUrl(shop.address)} target="_blank" rel="noopener noreferrer">{shop.address}</a>}
        </div>
      </div>
      {shop.phone && <div className="actions"><a href={telUrl(shop.phone)}>Call</a></div>}
      {notice && <div className="note" role="status">{notice}</div>}
      {products.length === 0 && <p className="sub center">No products yet. Check back soon.</p>}
      <div className="products">
        {products.map((p) => (
          <button key={p.id} className={`tile${p.soldOut ? ' sold' : ''}`} onClick={() => setProduct(p)} aria-label={`${p.name}, ${formatMoney(p.priceCents)}${p.soldOut ? ', sold out' : ''}`}>
            {p.photos[0] ? <img className="ph" src={p.photos[0]} alt="" loading="lazy" /> : <span className="noph" aria-hidden>▢</span>}
            {p.soldOut && <span className="badge">Sold out</span>}
            <div className="info"><div className="nm">{p.name}</div><div className="pr">{formatMoney(p.priceCents)}</div></div>
          </button>
        ))}
      </div>

      {totals.count > 0 && !product && !cartOpen && (
        <div className="cartbar">
          <button className="btn" onClick={() => setCartOpen(true)}>
            <span>View cart · {totals.count} {totals.count === 1 ? 'item' : 'items'}</span><span>{formatMoney(totals.subtotalCents)}</span>
          </button>
        </div>
      )}

      {product && <ProductSheet product={product} onClose={() => setProduct(null)} onAdd={(q) => { setCart(addItem(cart, product, q)); setProduct(null); }} />}
      {cartOpen && (
        <CartSheet
          cart={cart} products={products} onClose={() => setCartOpen(false)}
          onQty={(id, q) => setCart(setQty(cart, id, q))} onRemove={(id) => setCart(removeItem(cart, id))}
          onCheckout={() => { setCartOpen(false); setView({ kind: 'checkout' }); }}
        />
      )}
    </Shell>
  );
}

function Sheet({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

function ProductSheet({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (qty: number) => void }) {
  const [qty, setQ] = useState(1);
  const [idx, setIdx] = useState(0);
  return (
    <Sheet onClose={onClose} label={product.name}>
      <div className="gallery" onScroll={(e) => { const el = e.currentTarget; setIdx(Math.round(el.scrollLeft / el.clientWidth)); }}>
        {product.photos.length ? product.photos.map((u) => <img key={u} src={u} alt={product.name} />) : <span className="noph" aria-hidden>▢</span>}
      </div>
      {product.photos.length > 1 && <div className="dots" aria-hidden>{product.photos.map((u, i) => <i key={u} className={i === idx ? 'on' : ''} />)}</div>}
      <h2 style={{ margin: '4px 0' }}>{product.name}</h2>
      <div className="price">{formatMoney(product.priceCents)}</div>
      {product.description && <p className="desc">{product.description}</p>}
      {product.soldOut ? <p className="note">Sold out</p> : (
        <>
          <p><span className="stepper" aria-label="Quantity">
            <button onClick={() => setQ(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="Less">−</button>
            <span aria-live="polite">{qty}</span>
            <button onClick={() => setQ(Math.min(MAX_QTY, qty + 1))} disabled={qty >= MAX_QTY} aria-label="More">+</button>
          </span></p>
          <button className="btn" onClick={() => onAdd(qty)}>Add to cart · {formatMoney(product.priceCents * qty)}</button>
        </>
      )}
    </Sheet>
  );
}

function CartSheet({ cart, products, onClose, onQty, onRemove, onCheckout }: {
  cart: Cart; products: Product[]; onClose: () => void; onQty: (id: string, q: number) => void; onRemove: (id: string) => void; onCheckout: () => void;
}) {
  const totals = cartTotals(cart, products, 'pickup', 0);
  return (
    <Sheet onClose={onClose} label="Your cart">
      <h2 style={{ marginTop: 0 }}>Your cart</h2>
      {cart.lines.length === 0 && <p className="sub">Your cart is empty.</p>}
      {cart.lines.map((l) => (
        <div className="line" key={l.productId}>
          {l.photo ? <img src={l.photo} alt="" /> : <span className="noph" />}
          <div className="grow">
            <div>{l.name}</div>
            <div className="sub">{formatMoney(l.priceCents)}{l.soldOut ? ' · Sold out' : ''}</div>
            <button className="rm" onClick={() => onRemove(l.productId)}>Remove</button>
          </div>
          <span className="stepper">
            <button onClick={() => onQty(l.productId, l.quantity - 1)} aria-label={`Less ${l.name}`}>−</button>
            <span>{l.quantity}</span>
            <button onClick={() => onQty(l.productId, l.quantity + 1)} disabled={l.quantity >= MAX_QTY} aria-label={`More ${l.name}`}>+</button>
          </span>
        </div>
      ))}
      {cart.lines.length > 0 && <>
        <div className="summary"><div className="total"><span>Subtotal</span><span>{formatMoney(totals.subtotalCents)}</span></div></div>
        <button className="btn" onClick={onCheckout}>Checkout</button>
      </>}
    </Sheet>
  );
}

/* ===================== checkout ===================== */

function Checkout({ api, shop, products, cart, onBack, onRefresh, onSoldOut, onRemove, onPaused, onCreated }: {
  api: ShopApi; shop: ShopInfo; products: Product[]; cart: Cart;
  onBack: () => void; onRefresh: (p: Product[]) => void; onSoldOut: (ids: string[]) => void; onRemove: (id: string) => void;
  onPaused: () => void; onCreated: (token: string) => void;
}) {
  const fulfilments: Fulfilment[] = [...(shop.pickup.enabled ? ['pickup' as const] : []), ...(shop.shipping.enabled ? ['shipping' as const] : [])];
  const [fulfilment, setFulfilment] = useState<Fulfilment>(fulfilments[0] ?? 'pickup');
  const [cust, setCust] = useState({ name: '', phone: '', email: '' });
  const [note, setNote] = useState('');
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const rows = payRows(shop, fulfilment);
  const [choice, setChoice] = useState<{ pay: PayChoice; method: ManualMethod | null } | null>(null);
  const keyRef = useRef(newClientKey());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const totals = cartTotals(cart, products, fulfilment, shop.shipping.flatCents);
  // The picked choice must still be offered for this fulfilment; otherwise default to the first row.
  const current = rows.find((r) => choice && r.pay === choice.pay && (r.pay !== 'manual' || r.method === choice.method)) ?? (rows.length === 1 ? rows[0] : null);
  const state: CheckoutState = {
    slug: shop.slug, clientKey: keyRef.current, shop, products, cart, customer: cust, note, fulfilment, address,
    pay: current?.pay ?? 'card', method: current?.method ?? null,
  };
  const soldOutLines = cart.lines.filter((l) => l.soldOut);
  const needsAddress = fulfilment === 'shipping' && current?.pay !== 'card';
  const showCardNote = fulfilment === 'shipping' && current?.pay === 'card';

  async function submit() {
    const invalid = !current ? 'Please choose how you want to pay.' : validateCheckout(state);
    if (invalid) { setProblem(invalid); return; }
    setBusy(true); setProblem(null);
    const r = await placeOrder(api.createOrder, state);
    setBusy(false);
    switch (r.kind) {
      case 'ok': {
        if (r.state.clientKey !== keyRef.current) keyRef.current = r.state.clientKey;
        if (state.pay === 'card' && r.res.checkoutUrl) { window.location.assign(r.res.checkoutUrl); return; }
        onCreated(tokenFromStatusUrl(r.res.order.statusUrl));
        return;
      }
      case 'cart-changed': onRefresh(r.products); setProblem(CHANGED_MESSAGE); return;
      case 'sold-out': onSoldOut(r.productIds); setProblem('Some items just sold out. Remove them to continue.'); return;
      case 'expired': keyRef.current = newClientKey(); setProblem(EXPIRED_MESSAGE); return;
      case 'paused': onPaused(); return;
      case 'rate-limited': case 'payment-unavailable': case 'error': setProblem(r.message); return;
      case 'invalid': setProblem(`Please check your ${r.field === 'items' ? 'cart' : r.field || 'details'}.`); return;
    }
  }

  const set = (k: keyof typeof cust) => (e: React.ChangeEvent<HTMLInputElement>) => setCust({ ...cust, [k]: e.target.value });
  const setA = (k: keyof AddressForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setAddress({ ...address, [k]: e.target.value });

  return (
    <div>
      <div className="top"><button className="back" onClick={onBack} aria-label="Back to shop">‹ Back</button></div>
      <h1>Checkout</h1>

      <h3>Your order</h3>
      {cart.lines.map((l) => (
        <div className="line" key={l.productId}>
          <div className="grow">{l.quantity} × {l.name}{l.soldOut && <span className="chip bad" style={{ marginLeft: 8 }}>Sold out</span>}</div>
          {l.soldOut ? <button className="rm" onClick={() => onRemove(l.productId)}>Remove</button> : <span>{formatMoney(l.priceCents * l.quantity)}</span>}
        </div>
      ))}

      <h3>Your details</h3>
      <label htmlFor="c-name">Name</label>
      <input id="c-name" autoComplete="name" value={cust.name} onChange={set('name')} />
      <label htmlFor="c-phone">Phone</label>
      <input id="c-phone" type="tel" autoComplete="tel" value={cust.phone} onChange={set('phone')} />
      <label htmlFor="c-email">Email</label>
      <input id="c-email" type="email" autoComplete="email" value={cust.email} onChange={set('email')} />
      <label htmlFor="c-note">Note (optional)</label>
      <textarea id="c-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />

      {fulfilments.length > 0 && <>
        <h3>Get your order</h3>
        {fulfilments.map((f) => (
          <button key={f} className={`row${fulfilment === f ? ' sel' : ''}`} aria-pressed={fulfilment === f} onClick={() => setFulfilment(f)}>
            <div className="grow">
              <div><strong>{f === 'pickup' ? 'Pickup' : 'Shipping'}</strong></div>
              {f === 'pickup'
                ? <div className="m">{[shop.address, shop.pickup.note].filter(Boolean).join(' · ') || 'Pick up at the shop'}</div>
                : <div className="m">{formatMoney(shop.shipping.flatCents) || '$0'} flat rate{shop.shipping.shipsWithinDays ? ` · Ships within ${shop.shipping.shipsWithinDays} days` : ''}</div>}
            </div>
          </button>
        ))}
      </>}

      {needsAddress && <>
        <h3>Shipping address</h3>
        <label htmlFor="a-name">Full name</label>
        <input id="a-name" autoComplete="shipping name" value={address.name} onChange={setA('name')} />
        <label htmlFor="a-l1">Address</label>
        <input id="a-l1" autoComplete="shipping address-line1" value={address.line1} onChange={setA('line1')} />
        <label htmlFor="a-l2">Apt, suite (optional)</label>
        <input id="a-l2" autoComplete="shipping address-line2" value={address.line2} onChange={setA('line2')} />
        <label htmlFor="a-city">City</label>
        <input id="a-city" autoComplete="shipping address-level2" value={address.city} onChange={setA('city')} />
        <div className="two">
          <div>
            <label htmlFor="a-state">State</label>
            <select id="a-state" autoComplete="shipping address-level1" value={address.state} onChange={setA('state')}>
              <option value="">Select</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="a-zip">ZIP</label>
            <input id="a-zip" inputMode="numeric" autoComplete="shipping postal-code" value={address.postalCode} onChange={setA('postalCode')} />
          </div>
        </div>
      </>}
      {showCardNote && <p className="sub">You'll enter your shipping address on the secure card page.</p>}

      <h3>Payment</h3>
      {rows.length === 0 && <p className="note warn">This shop can't take orders online right now. Please call the shop.</p>}
      {rows.map((r) => {
        const sel = current === r;
        const label = r.pay === 'shop' ? 'Pay at pickup' : r.pay === 'card' ? 'Card / Apple Pay' : METHOD_LABEL[r.method!];
        return (
          <button key={`${r.pay}${r.method ?? ''}`} className={`row${sel ? ' sel' : ''}`} aria-pressed={sel} onClick={() => setChoice({ pay: r.pay, method: r.method ?? null })}>
            <div className="grow"><strong>{label}</strong>{r.pay === 'manual' && <div className="m">You'll send it after you place the order</div>}</div>
          </button>
        );
      })}

      <div className="summary">
        <div><span>Subtotal</span><span>{formatMoney(totals.subtotalCents) || '$0'}</span></div>
        {fulfilment === 'shipping' && <div><span>Shipping</span><span>{formatMoney(totals.shippingCents) || '$0'}</span></div>}
        <div className="total"><span>Total</span><span>{formatMoney(totals.totalCents) || '$0'}</span></div>
      </div>

      {problem && <div className="note warn" role="alert">{problem}</div>}
      <button className="btn" onClick={submit} disabled={busy || soldOutLines.length > 0 || rows.length === 0}>{busy ? 'Placing order…' : 'Place order'}</button>
    </div>
  );
}

/* ===================== status ===================== */

function StatusPage({ api, token, checkout }: { api: ShopApi; token: string; checkout: CheckoutReturn }) {
  return <Shell><StatusView api={api} token={token} checkout={checkout} /></Shell>;
}

function StatusView({ api, token, checkout, fresh }: { api: ShopApi; token: string; checkout: CheckoutReturn; fresh?: boolean }) {
  const [data, setData] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);
  const [sentOk, setSentOk] = useState(false);
  const [sentErr, setSentErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.order(token).then((d) => { setData(d); applyAccent(d.shop.accent); document.title = `Order #${d.order.number}`; })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'not-found' : 'failed'));
  }, [token]);

  // After Stripe success the webhook may lag: re-fetch every 3 s, up to 30 s.
  const payStatus = data?.order.paymentStatus;
  useEffect(() => {
    if (checkout !== 'success' || !data || !shouldKeepPolling(payStatus!, 0)) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (!shouldKeepPolling('awaiting', Date.now() - t0)) { clearInterval(id); return; }
      api.order(token).then(setData).catch(() => {});
    }, CHECKOUT_POLL_MS);
    return () => clearInterval(id);
  }, [checkout, !!data, payStatus]);

  if (error === 'not-found') return <Message title="We couldn't find this order." body="This link isn't valid." />;
  if (error) return <Message title="Something went wrong" body="Please refresh and try again." />;
  if (!data) return <Spinner />;
  const { order: o, shop } = data;
  const method = (o.paymentMethod ?? '') as ManualMethod;
  const handle = shop.manual[method];
  const link = handle ? manualLink(method, handle, o.totalCents, `Order #${o.number}`) : null;
  const confirming = checkout === 'success' && o.paymentStatus === 'awaiting';
  const statusClass = o.status === 'cancelled' ? 'bad' : o.status === 'done' || o.status === 'paid' || o.status === 'ready' || o.status === 'shipped' ? 'good' : '';

  async function mark() {
    setSentErr(null);
    try { await api.sent(token, method); setSentOk(true); }
    catch (e) { setSentErr(sentErrorMessage(e instanceof ApiError ? e : null)); }
  }

  return (
    <div>
      {fresh && <div className="center"><div className="check" aria-hidden>✓</div></div>}
      <h1>{fresh ? 'Order placed' : `Order #${o.number}`}</h1>
      <p className="sub">{shop.name} · Order #{o.number} <span className={`chip ${statusClass}`}>{STATUS_LABEL[o.status] ?? o.status}</span></p>

      {checkout === 'success' && (confirming
        ? <div className="note" role="status"><strong>Confirming your payment…</strong></div>
        : <div className="note" role="status"><strong>Payment received.</strong> Thank you!</div>)}
      {checkout === 'cancelled' && <div className="note warn" role="status">Payment wasn't completed. Nothing was charged.</div>}

      <div className="summary">
        {o.items.map((it, i) => <div key={i}><span>{it.quantity} × {it.name}</span><span>{formatMoney(it.unitPriceCents * it.quantity)}</span></div>)}
        {o.fulfilment === 'shipping' && <div><span>Shipping</span><span>{formatMoney(o.shippingCents) || '$0'}</span></div>}
        <div className="total"><span>Total</span><span>{formatMoney(o.totalCents) || '$0'}</span></div>
        <div><span>Payment</span><span>{paymentLine(o)}</span></div>
      </div>

      {o.fulfilment === 'pickup' ? (
        <div className="note">
          <strong>Pickup</strong>
          {shop.address && <div>{shop.address}</div>}
          {shop.pickupNote && <div className="sub">{shop.pickupNote}</div>}
          {o.status === 'ready' && <div><strong>Your order is ready.</strong></div>}
        </div>
      ) : (
        <div className="note">
          <strong>Shipping</strong>
          {formatAddress(o.shippingAddress).map((l, i) => <div key={i}>{l}</div>)}
          {!o.shippingAddress && <div className="sub">The address you entered at checkout.</div>}
          {o.status !== 'shipped' && o.status !== 'done' && shop.shipsWithinDays ? <div className="sub">Ships within {shop.shipsWithinDays} days.</div> : null}
          {o.trackingNumber && <div>Tracking: {o.trackingUrl ? <a href={/^https?:\/\//i.test(o.trackingUrl) ? o.trackingUrl : undefined} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{o.trackingNumber}</a> : o.trackingNumber}</div>}
        </div>
      )}

      {(data.canSayPaid || sentOk) && handle && (
        sentOk || o.customerSaysPaid
          ? <div className="note" role="status">Thanks. {shop.name} will confirm your payment.</div>
          : (
            <div className="note">
              <strong>Send {formatMoney(o.totalCents)} with {METHOD_LABEL[method]}</strong>
              {link
                ? <a className="btn ghost" href={link} target="_blank" rel="noopener noreferrer">Pay with {METHOD_LABEL[method]}</a>
                : <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(handle).catch(() => {}); setCopied(true); }}>{copied ? `Copied ${handle}` : `${METHOD_LABEL[method]}: ${handle} (tap to copy)`}</button>}
              <button className="btn" onClick={mark}>I've sent it</button>
              {sentErr && <p className="err" role="alert">{sentErr}</p>}
            </div>
          )
      )}
      {!data.canSayPaid && !sentOk && o.customerSaysPaid && o.paymentStatus !== 'paid' && <div className="note" role="status">Thanks. {shop.name} will confirm your payment.</div>}

      {shop.phone && <a className="btn ghost" href={telUrl(shop.phone)}>Call {shop.name}</a>}
      <a className="btn ghost" href={`/shop/${encodeURIComponent(shop.slug)}`}>Back to shop</a>
      <p className="sub">Keep this page. It's your link to this order.</p>
    </div>
  );
}
