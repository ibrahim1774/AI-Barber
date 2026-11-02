import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ uid: '10000000-0000-0000-0000-000000000001' as string | null, rest: null as any, stripe: null as any, writes: [] as string[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true,
  APP_ORIGIN: () => 'https://app.test', callerFrom: async () => state.uid ? { id: state.uid, email: 'test@example.com' } : null,
  sbRest: async (...args: any[]) => { state.writes.push(args[0]); return state.rest(...args); },
  stripeCall: async (...args: any[]) => state.stripe(...args),
  readRawBody: async (req: any) => req.body,
}));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(async () => {}), welcomeEmail: () => ({}), alertOwner: vi.fn(async () => {}) }));
vi.mock('../../lib/webApp/publishFlow.js', async (orig) => {
  const o = await orig<any>();
  return {
    ...o,
    runWebPublish: vi.fn(async () => ({ status: 200, body: { siteId: 'test-cuts', deployedUrl: 'https://test-cuts.example', version: 1 } })),
    liveWebPublishDeps: vi.fn(() => ({})),
    validateWebSnapshot: vi.fn(o.validateWebSnapshot),
  };
});
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: vi.fn(async () => {}), liveDupDeps: () => ({}) }));
vi.mock('../../lib/webApp/dunning.js', () => ({ contactFor: async () => ({ email: null, firstName: null }), resetDunning: async () => {}, sendFailedPaymentIfDue: async () => {} }));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
import draft from '../../api/web-app/draft.js';
import checkout from '../../api/web-app/checkout.js';
import status from '../../api/web-app/publish-status.js';
import { prepareIntent, readDraft, suspendWork, markSiteOffline } from '../../lib/webApp/reliability.js';
import publishApi from '../../api/web-app/publish.js';
import webhook from '../../api/web-app/webhook.js';
import { liveJobDeps, runJob, sweepJobs } from '../../lib/webApp/publishJobs.js';
import { alertOwner } from '../../lib/webApp/emails.js';
import { runWebPublish, validateWebSnapshot } from '../../lib/webApp/publishFlow.js';

const U = '10000000-0000-0000-0000-000000000001';
const V = '10000000-0000-0000-0000-000000000002';
const site = () => ({ shopName: 'Test Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'Fresh cuts', tagline: 'Welcome', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'About', description: ['Welcome'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/service.jpg' }],
  gallery: [], craftImages: [], staff: [], contact: { address: '1 Main Street', email: 'test@example.com' }, source: 'web-app' });
const response = () => { const r: any = { code: 0, body: null, setHeader: vi.fn() }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
async function call(fn: any, body?: any, method = 'POST') { const r = response(); await fn({ method, headers: { authorization: 'Bearer test' }, body }, r); return r; }
let db: PGlite;

// Exercise the real SQL migration through a small PostgREST adapter, with no external database or Stripe calls.
async function rest(path: string, init: any = {}) {
  if (path === 'rpc/submit_web_app_intent') {
    const b = init.body;
    return (await db.query('select * from submit_web_app_intent($1,$2,$3,$4,$5,$6,$7,$8)',
      [b.p_user,b.p_environment,b.p_draft,b.p_revision,b.p_id,b.p_status,b.p_base_version,b.p_snapshot])).rows;
  }
  const [table, query = ''] = path.split('?');
  if (!/^(web_app_[a-z_]+|site_owners)$/.test(table)) throw new Error('unexpected table ' + table);
  const p = new URLSearchParams(query); const values: any[] = [];
  const arg = (v: any) => { values.push(v); return '$' + values.length; };
  const filter = (key: string, expression: string): string => {
    if (!/^[a-z_]+$/.test(key)) throw new Error('invalid column');
    const [op, ...parts] = expression.split('.'); const value = parts.join('.');
    if (op === 'is' && value === 'null') return `${key} is null`;
    if (op === 'not' && value === 'is.null') return `${key} is not null`;
    if (op === 'in') return `${key} in (${value.slice(1,-1).split(',').map(arg).join(',')})`;
    const sign: any = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' };
    if (!sign[op]) throw new Error('invalid operator');
    return `${key}${sign[op]}${arg(value)}`;
  };
  const where: string[] = [];
  for (const [key, value] of p) {
    if (['select','order','limit','on_conflict'].includes(key)) continue;
    if (key === 'or') where.push('(' + value.slice(1,-1).split(',').map(x => { const at = x.indexOf('.'); return filter(x.slice(0,at),x.slice(at+1)); }).join(' or ') + ')');
    else where.push(filter(key,value));
  }
  const condition = where.length ? ' where ' + where.join(' and ') : '';
  const method = init.method ?? 'GET'; let sql: string;
  if (method === 'GET') {
    const cols = p.get('select') ?? '*'; if (!/^[a-z_,*]+$/.test(cols)) throw new Error('invalid select');
    sql = `select ${cols} from ${table}${condition}`;
    if (p.has('order')) sql += ' order by ' + p.get('order')!.split(',').map(x => x.replace('.desc', ' desc').replace('.asc', ' asc')).join(',');
    if (p.has('limit')) sql += ' limit ' + Number(p.get('limit'));
  } else if (method === 'PATCH') {
    const sets = Object.entries(init.body).map(([k,v]) => `${k}=${arg(v)}`);
    sql = `update ${table} set ${sets.join(',')}${condition} returning *`;
  } else if (method === 'DELETE') sql = `delete from ${table}${condition} returning *`;
  else {
    // POST filters aren't used in these production calls; build values from the body.
    values.length = 0;
    const entries = Object.entries(init.body);
    sql = `insert into ${table}(${entries.map(([k])=>k).join(',')}) values(${entries.map(([,v])=>arg(v)).join(',')})`;
    if (p.has('on_conflict')) {
      sql += ` on conflict(${p.get('on_conflict')}) ` + (init.prefer?.includes('ignore-duplicates') ? 'do nothing' :
        'do update set ' + entries.filter(([k])=>!p.get('on_conflict')!.split(',').includes(k)).map(([k])=>`${k}=excluded.${k}`).join(','));
    }
    sql += ' returning *';
  }
  return (await db.query(sql,values)).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    insert into auth.users values('${U}'),('${V}');
    create table web_app_entitlements(stripe_subscription_id text primary key, stripe_customer_id text, user_id uuid, site_slug text,
      tier text, billing_interval text, status text, environment text, current_period_end timestamptz, cancel_at_period_end boolean, created_at timestamptz default now(), updated_at timestamptz, welcome_sent_at timestamptz);
    create table web_app_customers(user_id uuid, environment text, stripe_customer_id text, primary key(user_id,environment));
    create table site_owners(slug text, user_id uuid);
    create table web_app_sites(slug text primary key, stripe_subscription_id text, user_id uuid, environment text, published_at timestamptz, taken_down_at timestamptz, removed_at timestamptz, created_at timestamptz default now());`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/025_web_app_reliability.sql', import.meta.url),'utf8'));
}, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  vi.stubEnv('WEB_APP_RELIABILITY','1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY','sk_test_test');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH','price_test');
  await db.exec('truncate web_app_draft_versions, web_app_drafts, web_app_publish_intents, web_app_entitlements, web_app_customers, web_app_sites');
  vi.mocked(alertOwner).mockClear(); vi.mocked(alertOwner).mockImplementation(async () => {});
  vi.mocked(runWebPublish).mockReset();
  vi.mocked(runWebPublish).mockImplementation((async () => ({ status: 200, body: { siteId: 'test-cuts', deployedUrl: 'https://test-cuts.example', version: 1 } })) as any);
  state.uid = U; state.rest = rest; state.writes = [];
  state.stripe = vi.fn(async (path: string) => {
    if (path === 'customers') return { id: 'cus_test' };
    if (path === 'subscriptions/sub_x') return { id: 'sub_x', customer: 'cus_test', status: 'active', metadata: { app: 'aibarber-app', user_id: U }, items: { data: [{ price: { id: 'price_test' } }] } };
    if (path.startsWith('subscriptions?')) return { data: [] };
    if (path === 'checkout/sessions') return { id: 'cs_test' };
    if (path === 'checkout/sessions/cs_test') return { id: 'cs_test', status: 'open', url: 'https://checkout.stripe.com/test' };
    if (path.startsWith('checkout/sessions?')) return { data: [] };
    throw new Error('unexpected Stripe call '+path);
  });
});
afterEach(() => vi.unstubAllEnvs());
const save = (data = site(), expectedRevision = 0) => call(draft, { id: 'draft', site_data: data, expectedRevision },'PUT');


const setup = async () => {
  await save(); const job = await prepareIntent(U, 'draft', 1, 'publish');
  const deps = liveJobDeps(); deps.paid = vi.fn(async () => true);
  deps.publish = vi.fn(async (_j, guard) => { await guard(); return { status: 200, body: { siteId: 'test-cuts', deployedUrl: 'https://test-cuts.example', version: 1 } }; });
  return { job, deps };
};

const intents = async () => (await db.query<any>('select id,revision,status,stripe_session_id,result,requires_payment,attempts from web_app_publish_intents order by revision, created_at')).rows;
const entitle = () => db.query("insert into web_app_entitlements(stripe_subscription_id,user_id,status,environment) values('sub_x',$1,'active','test')", [U]);
describe('S1 legacy client compatibility', () => {
  it('legacy publish body without draftId publishes through the browser path', async () => {
    await entitle();
    const r = await call(publishApi, { transactionId: 'web:sub_x', siteData: site() });
    expect(r.code).toBe(200);
    expect(runWebPublish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runWebPublish).mock.calls[0]).toEqual([{ transactionId: 'web:sub_x', siteData: site() }, {}, { authorization: 'Bearer test' }]);
    expect((await intents()).length).toBe(0);
  });
  it("legacy publish waits while this account's server job holds the lease", async () => {
    await save();
    await db.query("update web_app_drafts set publish_lease=gen_random_uuid(), lease_until=now()+interval '5 minutes'");
    const r = await call(publishApi, { transactionId: 'web:sub_x', siteData: site() });
    expect(r.code).toBe(503); expect(r.body.error).toBe('temporarily-unavailable');
    expect(runWebPublish).not.toHaveBeenCalled();
  });
  it('drafted publish body still runs as a server job', async () => {
    await save(); await entitle();
    const r = await call(publishApi, { draftId: 'draft', revision: 1, siteData: site() });
    expect(r.code).toBe(200);
    const rows = await intents();
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('live');
  });
  it('legacy publish with the flag off is untouched', async () => {
    vi.stubEnv('WEB_APP_RELIABILITY', '');
    const r = await call(publishApi, { transactionId: 'web:sub_x', siteData: site() });
    expect(r.code).toBe(200);
    expect(runWebPublish).toHaveBeenCalledTimes(1);
  });
});

const SUBJECT = 'AI Barber web: paid publish stopped';
describe('S2 owner alert when a paid publish stops', () => {
  it('claim park alerts once', async () => {
    const { job, deps } = await setup();
    await db.query("update web_app_publish_intents set status='running', attempts=20, stripe_subscription_id='sub_x', next_attempt_at=now()-interval '1 minute' where id=$1", [job.id]);
    await runJob(job.id, deps); await runJob(job.id, deps);
    const row = (await intents())[0];
    expect(row.status).toBe('cancelled'); expect(row.result.error).toBe('publish_gave_up');
    expect(alertOwner).toHaveBeenCalledTimes(1);
    const [subject, lines] = vi.mocked(alertOwner).mock.calls[0];
    expect(subject).toBe(SUBJECT);
    expect(lines.some(l => l.includes(job.id))).toBe(true);
  });
  it('finish parks at the cap and alerts once', async () => {
    const { job, deps } = await setup();
    await db.query("update web_app_publish_intents set attempts=19, stripe_subscription_id='sub_x' where id=$1", [job.id]);
    deps.publish = vi.fn(async () => ({ status: 502, body: { error: 'publish-failed' } }));
    await runJob(job.id, deps);
    expect((await intents())[0].status).toBe('cancelled');
    expect(alertOwner).toHaveBeenCalledTimes(1);
  });
  it('housekeeping park records publish_gave_up and alerts once', async () => {
    await save(); const job = await prepareIntent(U, 'draft', 1, 'publish');
    await db.query("update web_app_publish_intents set status='failed', attempts=20, requires_payment=true, next_attempt_at=now()+interval '1 hour' where id=$1", [job.id]);
    await sweepJobs(); await sweepJobs();
    const row = (await intents())[0];
    expect(row.status).toBe('cancelled'); expect(row.result.error).toBe('publish_gave_up');
    expect(alertOwner).toHaveBeenCalledTimes(1);
  });
  it('a paid checkout job refused with 4xx alerts publish_refused', async () => {
    await save();
    expect((await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 })).code).toBe(200);
    const job = (await intents())[0];
    expect(job.requires_payment).toBe(true);
    await db.query("update web_app_publish_intents set status='queued', stripe_subscription_id='sub_x' where id=$1", [job.id]);
    const deps = liveJobDeps(); deps.paid = async () => true;
    deps.publish = vi.fn(async () => ({ status: 409, body: { error: 'slug-owned' } }));
    await runJob(job.id, deps);
    expect((await intents())[0].status).toBe('superseded');
    expect(alertOwner).toHaveBeenCalledTimes(1);
    expect(vi.mocked(alertOwner).mock.calls[0][1]).toContain('reason: publish_refused');
  });
  it('an unpaid abandoned checkout never alerts', async () => {
    await save(); await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await db.query("update web_app_publish_intents set created_at=now()-interval '2 hours', next_attempt_at=now()-interval '1 minute'");
    await sweepJobs();
    expect((await intents())[0].status).toBe('cancelled');
    expect(alertOwner).not.toHaveBeenCalled();
  });
  it('an alert failure never changes the parked state', async () => {
    vi.mocked(alertOwner).mockRejectedValueOnce(new Error('resend 429'));
    const { job, deps } = await setup();
    await db.query("update web_app_publish_intents set status='running', attempts=20, stripe_subscription_id='sub_x' where id=$1", [job.id]);
    await expect(runJob(job.id, deps)).resolves.toBeUndefined();
    expect((await intents())[0].status).toBe('cancelled');
  });
});

describe('S3 publish-status exposes whether the job was paid', () => {
  it('publish-status shows a parked paid job with its reason', async () => {
    await save();
    expect((await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 })).code).toBe(200);
    await db.query(`update web_app_publish_intents set status='cancelled', result='{"error":"publish_gave_up"}'`);
    const r = await call(status, undefined, 'GET');
    expect(r.body.intent.status).toBe('cancelled');
    expect(r.body.intent.result.error).toBe('publish_gave_up');
    expect(r.body.intent.requires_payment).toBe(true);
    expect('next_attempt_at' in r.body.intent).toBe(false);
  });
});

describe('S4 revived submission starts a fresh abandon clock', () => {
  it('a revived checkout row cannot be abandon-cancelled before its session is linked', async () => {
    await save(); const a = await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await db.query("update web_app_publish_intents set status='cancelled', created_at=now()-interval '2 hours' where id=$1", [a.id]);
    await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await sweepJobs();
    expect((await intents())[0].status).toBe('awaiting_payment');
  });
});

describe('S5 checkout snapshot links', () => {
  const BOOK = 'https://www.aibarber.org/book/test-cuts';
  const withBook = () => ({ ...site(), bookingUrl: BOOK, shopUrl: 'https://shop.example' });
  const checkoutWith = (extra: any = {}) => call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1, ...extra });
  const snap = async () => (await db.query<any>('select snapshot from web_app_publish_intents')).rows[0].snapshot;
  it("uses the browser's own booking link instead of a built-in /book link", async () => {
    await save(withBook());
    expect((await checkoutWith({ publication: { bookingUrl: 'https://own.example/book' } })).code).toBe(200);
    expect((await snap()).bookingUrl).toBe('https://own.example/book');
  });
  it('drops the link when the browser decided none', async () => {
    await save(withBook());
    expect((await checkoutWith({ publication: {} })).code).toBe(200);
    const s = await snap();
    expect('bookingUrl' in s).toBe(false); expect('shopUrl' in s).toBe(false);
  });
  it('an older drafts client without publication keeps the draft links', async () => {
    await save(withBook());
    expect((await checkoutWith()).code).toBe(200);
    expect((await snap()).bookingUrl).toBe(BOOK);
  });
  it('ignores non-string publication values', async () => {
    const d = { ...withBook(), staff: [{ name: 'Sam' }] };
    await save(d);
    expect((await checkoutWith({ publication: { bookingUrl: 5, staff: [{ name: 'x' }] } })).code).toBe(200);
    const s = await snap();
    expect('bookingUrl' in s).toBe(false); expect(s.staff).toEqual([{ name: 'Sam' }]);
  });
  const keys = () => state.stripe.mock.calls.filter((c: any[]) => c[0] === 'checkout/sessions' && c[2] === 'POST').map((c: any[]) => c[3]?.idempotencyKey);
  it('same revision with different publication links gets a different idempotency key', async () => {
    await save(withBook());
    const base = state.stripe; let n = 0;
    state.stripe = vi.fn(async (path: string, ...rest: any[]) => {
      if (path === 'checkout/sessions') return { id: 'cs_n' + ++n };
      const m = /^checkout\/sessions\/(cs_n\d+)$/.exec(path); if (m) return { id: m[1], status: 'open', url: 'https://checkout.stripe.com/' + m[1] };
      if (/^checkout\/sessions\/cs_n\d+\/expire$/.test(path)) return { status: 'expired' };
      return (base as any)(path, ...rest);
    });
    expect((await checkoutWith({ publication: { bookingUrl: 'https://a.example' } })).code).toBe(200);
    expect((await checkoutWith({ publication: { bookingUrl: 'https://b.example' } })).code).toBe(200);
    const k = keys(); expect(k).toHaveLength(2); expect(k[0]).not.toBe(k[1]);
  });
  it('upgrade checkout key is unchanged', async () => {
    const w0 = Math.floor(Date.now() / 600_000);
    expect((await call(checkout, { tier: 'website', interval: 'month' })).code).toBe(200);
    const w1 = Math.floor(Date.now() / 600_000);
    const ok = [w0, w1].map(w => `aibarber-app:cs:${U}:website:month:${w}`);
    expect(ok).toContain(keys()[0].replace(/:[0-9a-f]{8}$/, '')); // the trailing 8 hex chars hash the plan text
  });
  it('reports logo-folder on a refused checkout', async () => {
    await save(withBook());
    vi.mocked(validateWebSnapshot).mockImplementationOnce(() => { throw new Error('logo-folder'); });
    const r = await checkoutWith();
    expect(r.code).toBe(400); expect(r.body.error).toBe('invalid_draft'); expect(r.body.reason).toBe('logo-folder');
    expect(keys()).toHaveLength(0);
  });
});

describe('S6 first draft inherits a published web binding', () => {
  const site1 = (extra = '') => db.query(`insert into web_app_sites(slug,stripe_subscription_id,user_id,environment,published_at,taken_down_at,removed_at) values('test-cuts','sub_x',$1,'test',now(),${extra ? 'now()' : 'null'},null)`, [U]);
  it('first draft of a legacy-published account carries its live binding', async () => {
    await site1(); await entitle();
    await save();
    const d = await readDraft(U);
    expect(d?.deployed_url).toBe('https://test-cuts.vercel.app');
    expect(d?.published_binding.slug).toBe('test-cuts');
    const body = { draftId: 'draft', revision: 1, siteData: site() };
    // A repeated POST for the same revision deploys once (the S9 pattern): the second gets the stored result.
    expect((await call(publishApi, body)).code).toBe(200);
    expect((await call(publishApi, body)).code).toBe(200);
    expect(vi.mocked(runWebPublish)).toHaveBeenCalledTimes(1);
  });
  it('no binding for a taken-down site', async () => {
    await site1('down'); await save();
    expect((await readDraft(U))?.deployed_url).toBeNull();
  });
  it('later saves never touch the binding', async () => {
    await site1(); await save();
    const before = await readDraft(U);
    await save({ ...site(), phone: 'rev2' }, 1);
    const after = await readDraft(U);
    expect(after?.revision).toBe(2);
    expect(after?.published_binding).toEqual(before?.published_binding);
    expect(after?.deployed_url).toBe(before?.deployed_url);
  });
});
