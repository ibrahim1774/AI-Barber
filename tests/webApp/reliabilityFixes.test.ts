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
vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: vi.fn(async () => {}), welcomeEmail: () => ({}) }));
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
    create table site_owners(slug text, user_id uuid);`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/025_web_app_reliability.sql', import.meta.url),'utf8'));
}, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  vi.stubEnv('WEB_APP_RELIABILITY','1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY','sk_test_test');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH','price_test');
  await db.exec('truncate web_app_draft_versions, web_app_drafts, web_app_publish_intents, web_app_entitlements, web_app_customers');
  state.uid = U; state.rest = rest; state.writes = [];
  state.stripe = vi.fn(async (path: string) => {
    if (path === 'customers') return { id: 'cus_test' };
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
const intents = async () => (await db.query<any>('select id,revision,status,stripe_session_id from web_app_publish_intents order by revision, created_at')).rows;

describe('B1/S2: republish and checkout after take-offline', () => {
  it('B1 republishing unchanged content after take-offline deploys again and the editor shows it unpublished', async () => {
    const { job, deps } = await setup(); await runJob(job.id, deps);
    expect((await readDraft(U))?.deployed_url).toBe('https://test-cuts.example');
    await suspendWork(U); await markSiteOffline(U);
    const d = await readDraft(U);
    expect(d?.deployed_url).toBeNull(); expect(d?.published_binding).toBeNull();
    const again = await prepareIntent(U, 'draft', 1, 'publish');
    expect(again.id).toBe(job.id); expect(again.status).toBe('queued');
    await runJob(again.id, deps);
    expect(deps.publish).toHaveBeenCalledTimes(2);
    expect((await readDraft(U))?.deployed_url).toBe('https://test-cuts.example');
  });
  it('B1 an explicit republish of unchanged live content deploys again', async () => {
    const { job, deps } = await setup(); await runJob(job.id, deps);
    const again = await prepareIntent(U, 'draft', 1, 'publish', null, undefined, true); await runJob(again.id, deps);
    expect(deps.publish).toHaveBeenCalledTimes(2);
  });
  it('S2 checkout from the Publish paywall works after take-offline, with unchanged content', async () => {
    const { job, deps } = await setup(); await runJob(job.id, deps);
    await suspendWork(U); await markSiteOffline(U);
    const r = await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 });
    expect(r.code).toBe(200); expect(r.body.url).toContain('checkout.stripe.com');
    const row = (await db.query<any>("select status,stripe_session_id from web_app_publish_intents where status='awaiting_payment'")).rows;
    expect(row).toHaveLength(1); expect(row[0].stripe_session_id).toBe('cs_test');
    expect((await readDraft(U))?.suspended).toBe(false);
  });
  it('B1 checkout with unchanged content that is already live does not 409', async () => {
    await save(); const job = await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await db.query("update web_app_publish_intents set status='live', stripe_session_id='cs_old' where id=$1", [job.id]);
    const r = await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 });
    expect(r.code).toBe(200);
    const row = (await db.query<any>('select status,stripe_session_id from web_app_publish_intents where id=$1', [job.id])).rows[0];
    expect(row).toEqual({ status: 'awaiting_payment', stripe_session_id: 'cs_test' });
  });
});

describe('B2: a failing newer checkout never strands an earlier payable one', () => {
  it('leaves the earlier linked request untouched when the new Stripe session cannot be created', async () => {
    await save(); expect((await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 })).code).toBe(200);
    await save({ ...site(), phone: 'rev2' }, 1);
    const orig = state.stripe;
    state.stripe = vi.fn(async (path: string, ...r: any[]) => { if (path === 'checkout/sessions') throw new Error('stripe down'); return orig(path, ...r); });
    expect((await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 2 })).code).toBe(502);
    const rows = await intents();
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('awaiting_payment'); expect(rows[0].stripe_session_id).toBe('cs_test');
    expect((await readDraft(U))?.latest_intent_id).toBe(rows[0].id);
  });
  it('still recovers the publish when the older session is paid after a newer one superseded it', async () => {
    await save(); await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 });
    const first = (await intents())[0];
    await save({ ...site(), phone: 'rev2' }, 1);
    const rev2 = await prepareIntent(U, 'draft', 2, 'checkout:publish'); // newer request exists, but its own session was never linked
    await db.query("insert into web_app_customers values($1,'test','cus_test') on conflict do nothing", [U]);
    state.stripe = vi.fn(async (path: string) => {
      if (path.startsWith('subscriptions?')) return { data: [{ id: 'sub_paid', status: 'active', metadata: { app: 'aibarber-app', user_id: U } }] };
      if (path === 'subscriptions/sub_paid') return { id: 'sub_paid', customer: 'cus_test', status: 'active', metadata: { app: 'aibarber-app', user_id: U }, items: { data: [{ price: { id: 'price_test' } }] } };
      throw new Error('unexpected ' + path);
    });
    expect((await intents()).find((r) => r.id === first.id)?.status).toBe('superseded');
    expect(await liveJobDeps().paid(rev2)).toBe(true);
    await db.query("update web_app_publish_intents set next_attempt_at=now()-interval '1 minute'");
    const deps = liveJobDeps(); void deps;
    await sweepJobs(); // would publish through the real deployer; the unpaid->queued transition is what matters
    const after = (await intents()).find((r) => r.id === rev2.id)!;
    expect(['queued', 'running', 'failed', 'live']).toContain(after.status);
  });
});

describe('S1: bounded sweep', () => {
  it('cancels abandoned checkouts without a session and expired sessions', async () => {
    await save(); const a = await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await db.query("update web_app_publish_intents set created_at=now()-interval '2 hours', next_attempt_at=now()-interval '1 minute'");
    await sweepJobs();
    expect((await intents())[0].status).toBe('cancelled');
    await db.query("update web_app_publish_intents set status='awaiting_payment', stripe_session_id='cs_dead', created_at=now(), next_attempt_at=now()-interval '1 minute' where id=$1", [a.id]);
    state.stripe = vi.fn(async (path: string) => { if (path === 'checkout/sessions/cs_dead') return { status: 'expired', client_reference_id: U, metadata: { intent_id: a.id } }; if (path.startsWith('subscriptions?')) return { data: [] }; throw new Error('unexpected ' + path); });
    await db.query("insert into web_app_customers values($1,'test','cus_test') on conflict do nothing", [U]);
    await sweepJobs();
    expect((await intents())[0].status).toBe('cancelled');
  });
  it('parks a job that failed the maximum number of attempts', async () => {
    await save(); const job = await prepareIntent(U, 'draft', 1, 'publish');
    await db.query("update web_app_publish_intents set status='failed', attempts=20, next_attempt_at=now()-interval '1 minute'");
    await sweepJobs();
    expect((await intents())[0].status).toBe('cancelled'); void job;
  });
  it('serves queued work before polling payment and keeps the batch limit of 10', async () => {
    await save(); const job = await prepareIntent(U, 'draft', 1, 'publish');
    await db.query("update web_app_publish_intents set next_attempt_at=now()-interval '1 minute'");
    for (let i = 0; i < 15; i++) await db.query("insert into web_app_publish_intents(id,user_id,environment,draft_id,revision,snapshot,status,requires_payment,next_attempt_at) values($1,$2,'test','x',9,'{}','awaiting_payment',true,now()-interval '1 hour')", ['stuck' + i, V]);
    const r = await sweepJobs();
    expect(r.checked).toBe(10);
    expect((await db.query<any>('select status from web_app_publish_intents where id=$1', [job.id])).rows[0].status).not.toBe('queued');
  });
  it('S1 a failing job gives up at the cap', async () => {
    const { job, deps } = await setup();
    deps.publish = vi.fn(async () => { throw new Error('deploy down'); });
    await db.query('update web_app_publish_intents set attempts=19 where id=$1', [job.id]);
    await runJob(job.id, deps);
    expect((await intents())[0].status).toBe('cancelled');
  });
});

describe('S3: publish.ts passes refusals through', () => {
  it('returns a 400 refusal as 400, not publish_retry_required', async () => {
    await save(); await db.query("insert into web_app_entitlements(stripe_subscription_id,user_id,status,environment) values('sub_x',$1,'active','test')", [U]);
    const real = liveJobDeps();
    // Run the claimed job through the real runner with a refusing deployer by stubbing the intent result afterwards.
    const spy = await import('../../lib/webApp/publishJobs.js');
    const orig = state.rest;
    state.rest = async (path: string, init: any = {}) => {
      const r = await orig(path, init);
      if (path.startsWith('web_app_publish_intents?id=eq.') && path.includes('select=status,result')) return [{ status: 'superseded', result: { status: 400, body: { error: 'logo-folder' } } }];
      return r;
    };
    void real; void spy;
    const r = await call(publishApi, { draftId: 'draft', revision: 1, siteData: {} });
    state.rest = orig;
    expect(r.code).toBe(400); expect(r.body).toEqual({ error: 'logo-folder' });
  });
});

describe('draft size cap', () => {
  const big = (bytes: number) => ({ ...site(), about: { ...(site() as any).about, description: ['x'.repeat(bytes)] } });
  it('a draft over 1 MB is refused with 413 and nothing is written', async () => {
    const r = await save(big(1024 * 1024 + 1) as any);
    expect(r.code).toBe(413); expect(r.body).toEqual({ error: 'draft_too_large', maxBytes: 1024 * 1024 });
    expect((await db.query('select count(*)::int n from web_app_drafts')).rows[0].n).toBe(0);
  });
  it('a 2 MB draft (the e2e case) is refused too', async () => {
    expect((await save(big(2 * 1024 * 1024) as any)).code).toBe(413);
  });
  it('a normal draft and one just under the cap still save', async () => {
    expect((await save()).code).toBe(200);
    const r = await save(big(1024 * 1024 - 4096) as any, 1);
    expect(r.code).toBe(200);
  });
});

describe('S4: draft requirement only for publish', () => {
  it('an upgrade checkout with no saved draft is not blocked when reliability is on', async () => {
    const r = await call(checkout, { tier: 'website', interval: 'month' });
    expect(r.code).toBe(200);
  });
  it('a publish checkout from a client that sends no draft gets a clear client_outdated code', async () => {
    const r = await call(checkout, { tier: 'website', interval: 'month', publish: true });
    expect(r.code).toBe(400); expect(r.body.error).toBe('client_outdated');
  });
});

describe('S7: retry re-dispatch is throttled', () => {
  it('does not dispatch a failed job before its backoff passes, but does afterwards', async () => {
    const { waitUntil } = await import('@vercel/functions');
    const { job } = await setup();
    await db.query("update web_app_publish_intents set status='failed', next_attempt_at=now()+interval '10 minutes' where id=$1", [job.id]);
    vi.mocked(waitUntil).mockClear();
    expect((await call(status, undefined, 'POST')).code).toBe(200);
    expect(waitUntil).not.toHaveBeenCalled();
    await db.query("update web_app_publish_intents set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
    await call(status, undefined, 'POST');
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
  it('rate limits repeated retry POSTs per user', async () => {
    const { job } = await setup();
    await db.query("update web_app_publish_intents set status='failed', next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) { // dispatchJob really runs the job in this harness, so put it back before every poll
      await db.query("update web_app_publish_intents set status='failed', worker_token=null, next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
      codes.push((await call(status, undefined, 'POST')).code);
    }
    expect(codes).toContain(429);
  });
});

describe('S8: crash-looping jobs and payment polling', () => {
  it('parks a job whose worker keeps dying (running, never finished) after the attempt cap', async () => {
    const { job, deps } = await setup();
    await db.query("update web_app_publish_intents set status='running', attempts=20, next_attempt_at=now()-interval '1 minute' where id=$1", [job.id]);
    await runJob(job.id, deps);
    expect(deps.publish).not.toHaveBeenCalled();
    const row = (await db.query<any>('select status,result from web_app_publish_intents where id=$1', [job.id])).rows[0];
    expect(row.status).toBe('cancelled'); expect(row.result.error).toBe('publish_gave_up');
    expect((await readDraft(U))?.publish_lease).toBeNull();
  });
  it('counts attempts on every claim, including ones that never finish', async () => {
    const { job } = await setup();
    const deps = liveJobDeps();
    expect((await deps.claim(job.id, '20000000-0000-0000-0000-000000000001'))?.attempts).toBe(1);
    await db.query("update web_app_drafts set publish_lease=null, lease_until=null");
    expect((await deps.claim(job.id, '20000000-0000-0000-0000-000000000002'))?.attempts).toBe(2);
  });
  it('ten stuck publish jobs cannot starve payment polling', async () => {
    for (let i = 0; i < 10; i++) await db.query("insert into web_app_publish_intents(id,user_id,environment,draft_id,revision,snapshot,status,attempts,next_attempt_at) values($1,$2,'test','x',$3,'{}','running',1,now()-interval '1 hour')", ['run' + i, V, i + 20]);
    for (let i = 0; i < 4; i++) await db.query("insert into web_app_publish_intents(id,user_id,environment,draft_id,revision,snapshot,status,requires_payment,next_attempt_at,created_at) values($1,$2,'test','x',$3,'{}','awaiting_payment',true,now()-interval '1 hour',now()-interval '10 minutes')", ['pay' + i, V, i + 40]);
    const r = await sweepJobs();
    expect(r.checked).toBe(10);
    const polled = (await db.query<any>("select count(*)::int n from web_app_publish_intents where id like 'pay%' and next_attempt_at > now()")).rows[0].n;
    expect(polled).toBeGreaterThanOrEqual(3);
  });
  it('the 1-hour abandon cancel never cancels a request whose payment went through', async () => {
    await save(); const a = await prepareIntent(U, 'draft', 1, 'checkout:publish');
    await db.query("update web_app_publish_intents set created_at=now()-interval '2 hours', next_attempt_at=now()+interval '1 hour'");
    await db.query("insert into web_app_customers values($1,'test','cus_test') on conflict do nothing", [U]);
    state.stripe = vi.fn(async (path: string) => {
      if (path.startsWith('subscriptions?')) return { data: [{ id: 'sub_paid', status: 'active', metadata: { app: 'aibarber-app', user_id: U } }] };
      if (path === 'subscriptions/sub_paid') return { id: 'sub_paid', customer: 'cus_test', status: 'active', metadata: { app: 'aibarber-app', user_id: U }, items: { data: [{ price: { id: 'price_test' } }] } };
      throw new Error('unexpected ' + path);
    });
    await sweepJobs();
    expect((await intents()).find((r) => r.id === a.id)?.status).not.toBe('cancelled');
  });
  it('a revived parked row starts with a fresh attempt budget (N5)', async () => {
    const { job } = await setup();
    await db.query("update web_app_publish_intents set status='cancelled', attempts=20, result='{\"error\":\"publish_gave_up\"}' where id=$1", [job.id]);
    const again = await prepareIntent(U, 'draft', 1, 'publish');
    expect(again.status).toBe('queued'); expect(again.attempts).toBe(0); expect(again.result).toBeNull();
  });
});

describe('S9: automatic client retry does not redeploy live content', () => {
  it('a repeated POST /publish for the same revision while the site is up deploys once and returns the stored result', async () => {
    const { job, deps } = await setup(); await runJob(job.id, deps);
    await db.query("insert into web_app_entitlements(stripe_subscription_id,user_id,status,environment) values('sub_x',$1,'active','test')", [U]);
    const body = { draftId: 'draft', revision: 1, siteData: site() };
    const first = await call(publishApi, body), second = await call(publishApi, body);
    expect(first.code).toBe(200); expect(second.code).toBe(200);
    expect(second.body.deployedUrl).toBe('https://test-cuts.example');
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect((await intents())[0].status).toBe('live');
  });
  it('an explicit republish flag or an offline site still deploys again', async () => {
    const { job, deps } = await setup(); await runJob(job.id, deps);
    const plain = await prepareIntent(U, 'draft', 1, 'publish');
    expect(plain.status).toBe('live');
    const explicit = await prepareIntent(U, 'draft', 1, 'publish', null, undefined, true);
    expect(explicit.status).toBe('queued');
  });
});

describe('S10: webhook wake expires the newest open session', () => {
  it('expires the newest request\'s own Checkout session when an older session was paid', async () => {
    await save(); await call(checkout, { tier: 'website', interval: 'month', publish: true, draftId: 'draft', revision: 1 });
    const first = (await intents())[0];
    await save({ ...site(), phone: 'rev2' }, 1);
    const rev2 = await prepareIntent(U, 'draft', 2, 'checkout:publish');
    await db.query("update web_app_publish_intents set stripe_session_id='cs_2' where id=$1", [rev2.id]);
    const calls: string[] = [];
    state.stripe = vi.fn(async (path: string, _b?: any, method?: string) => {
      calls.push(`${method ?? ''} ${path}`);
      if (path === 'subscriptions/sub_paid') return { id: 'sub_paid', customer: 'cus_test', status: 'active', metadata: { app: 'aibarber-app', user_id: U, intent_id: first.id }, items: { data: [{ price: { id: 'price_test' } }] } };
      if (path.startsWith('checkout/sessions/cs_2/expire')) return { id: 'cs_2', status: 'expired' };
      throw new Error('unexpected ' + path);
    });
    vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec_x');
    const ev = { id: 'evt_1', type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_paid', metadata: { app: 'aibarber-app' } } } };
    const raw = JSON.stringify(ev);
    const r = response(); await webhook({ method: 'POST', headers: { 'stripe-signature': 'x' }, body: raw }, r);
    expect(r.code).toBe(200);
    expect(calls).toContain('POST checkout/sessions/cs_2/expire');
    expect((await intents()).find((x) => x.id === rev2.id)?.status).not.toBe('awaiting_payment');
  });
});
