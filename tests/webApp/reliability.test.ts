import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({ uid: '10000000-0000-0000-0000-000000000001' as string | null, rest: null as any, stripe: null as any, writes: [] as string[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true,
  APP_ORIGIN: () => 'https://app.test', callerFrom: async () => state.uid ? { id: state.uid, email: 'test@example.com' } : null,
  sbRest: async (...args: any[]) => { state.writes.push(args[0]); return state.rest(...args); },
  stripeCall: async (...args: any[]) => state.stripe(...args),
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
import draft from '../../api/web-app/draft.js';
import checkout from '../../api/web-app/checkout.js';
import status from '../../api/web-app/publish-status.js';
import { prepareIntent, readDraft, suspendWork, resumeAfterFailedDelete } from '../../lib/webApp/reliability.js';
import { liveJobDeps, runJob } from '../../lib/webApp/publishJobs.js';

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
      tier text, billing_interval text, status text, environment text, current_period_end timestamptz, cancel_at_period_end boolean, created_at timestamptz default now(), updated_at timestamptz);
    create table web_app_customers(user_id uuid, environment text, stripe_customer_id text, primary key(user_id,environment));
    create table site_owners(slug text, user_id uuid);
    create table web_app_price_groups(user_id uuid primary key, price_group text not null, source text, created_at timestamptz default now());`);
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

describe('web draft and payment boundary (real PostgreSQL)', () => {
  it('acknowledges saves and refuses concurrent stale writes without losing the winner', async () => {
    expect((await save()).code).toBe(200);
    const [a,b] = await Promise.all([save({ ...site(), phone: '111' },1),save({ ...site(), phone: '222' },1)]);
    expect([a.code,b.code].sort()).toEqual([200,409]);
    expect((await readDraft(U))?.revision).toBe(2);
    expect((await db.query('select * from web_app_draft_versions')).rows).toHaveLength(2);
  });
  it('never accepts browser deployment URLs as proof of publication', async () => {
    const r = await call(draft,{ id:'draft',site_data:site(),expectedRevision:0,deployed_url:'https://fake.example' },'PUT');
    expect(r.body.draft.deployed_url).toBeNull();
  });
  it('does not expose another account draft or publish status', async () => {
    await save(); await prepareIntent(U,'draft',1,'checkout:publish'); state.uid=V;
    expect((await call(draft,undefined,'GET')).body.draft).toBeNull();
    expect((await call(status,undefined,'GET')).body.intent).toBeNull();
  });
  it('does not create a payable Stripe session for an unsaved revision', async () => {
    await save(); const r=await call(checkout,{tier:'website',interval:'month',publish:true,draftId:'draft',revision:9});
    expect(r.code).toBe(409); expect(state.stripe).not.toHaveBeenCalled();
  });
  it('keeps the old recoverable job when Stripe already knows the customer paid before its webhook arrived', async () => {
    await save();const old=await prepareIntent(U,'draft',1,'publish');
    const original=state.stripe;
    state.stripe=vi.fn(async(...args:any[])=>args[0].startsWith('checkout/sessions?customer_details')
      ? {data:[{id:'cs_paid',status:'complete',customer:'cus_paid',metadata:{app:'aibarber-app',user_id:U}}]}
      : args[0].startsWith('subscriptions?')
      ? {data:[{id:'sub_already_paid',status:'active',metadata:{app:'aibarber-app',user_id:U}}]}
      : original(...args));
    const r=await call(checkout,{tier:'website',interval:'month',publish:true,draftId:'draft',revision:1});
    expect(r.code).toBe(409);expect(r.body.error).toBe('already_subscribed');
    expect((await readDraft(U))?.latest_intent_id).toBe(old.id);
    expect((await db.query<any>('select status from web_app_publish_intents')).rows[0].status).toBe('queued');
  });
  it('persists the exact checkout snapshot and session before returning the URL', async () => {
    await save(); const r=await call(checkout,{tier:'website',interval:'month',publish:true,draftId:'draft',revision:1});
    expect(r.code).toBe(200);
    const job:any=(await db.query('select * from web_app_publish_intents')).rows[0];
    expect(job.stripe_session_id).toBe('cs_test'); expect(job.snapshot.phone).toBe('555-0100');
    await save({...site(),phone:'new edit'},1);
    expect((await db.query<any>('select snapshot from web_app_publish_intents')).rows[0].snapshot.phone).toBe('555-0100');
  });
  it('blocks direct authenticated/anonymous writes to canonical drafts', async () => {
    await expect(db.exec(`set role authenticated; select * from web_app_drafts;`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('retains 20 acknowledged versions and cascades them on account deletion', async () => {
    await save();
    for(let i=1;i<=23;i++) await save({...site(),phone:String(i)},i);
    expect((await db.query('select * from web_app_draft_versions')).rows).toHaveLength(20);
    await db.exec(`delete from auth.users where id='${U}'`);
    expect((await db.query('select * from web_app_drafts')).rows).toHaveLength(0);
    await db.exec(`insert into auth.users values('${U}')`);
  });
});

describe('durable publication and paid retry', () => {
  async function setup() {
    await save(); const job=await prepareIntent(U,'draft',1,'publish');
    const deps=liveJobDeps(); deps.paid=vi.fn(async()=>true);
    deps.publish=vi.fn(async(_job,guard)=>{await guard();return{status:200,body:{siteId:'test-cuts',deployedUrl:'https://test-cuts.example',version:1}};});
    return {job,deps};
  }
  it('finishes without any browser and makes duplicate delivery a no-op', async()=>{
    const {job,deps}=await setup(); await runJob(job.id,deps); await runJob(job.id,deps);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect((await readDraft(U))?.deployed_url).toBe('https://test-cuts.example');
  });
  it('keeps a failed job retryable and publishes after deployment recovers',async()=>{
    const {job,deps}=await setup(); vi.mocked(deps.publish).mockRejectedValueOnce(new Error('deploy unavailable'));
    await runJob(job.id,deps); expect((await db.query<any>('select status from web_app_publish_intents')).rows[0].status).toBe('failed');
    expect((await readDraft(U))?.publish_lease).toBeNull();
    await runJob(job.id,deps); expect((await db.query<any>('select status from web_app_publish_intents')).rows[0].status).toBe('live');
  });
  it('allows editing while running but serializes the next publish submission',async()=>{
    const {job,deps}=await setup();
    vi.mocked(deps.publish).mockImplementationOnce(async(_job,guard)=>{
      await save({...site(),phone:'latest edit'},1);
      await expect(prepareIntent(U,'draft',2,'publish')).rejects.toThrow('draft_changed_or_publish_running');
      await guard();return{status:200,body:{siteId:'test-cuts',deployedUrl:'https://test-cuts.example',version:1}};
    });
    await runJob(job.id,deps);
    const d=await readDraft(U); expect(d?.site_data.phone).toBe('latest edit');
    expect(d?.published_binding.publishedRevision).toBe(1); expect(d?.revision).toBe(2);
    const next=await prepareIntent(U,'draft',2,'publish'); await runJob(next.id,deps);
    expect((await readDraft(U))?.published_binding.publishedRevision).toBe(2);
  });
  it('does not deploy an unpaid submission',async()=>{
    const {job,deps}=await setup(); deps.paid=async()=>false;
    await runJob(job.id,deps); expect(deps.publish).not.toHaveBeenCalled();
  });
  it('reconstructs entitlement from Stripe when the webhook was missed',async()=>{
    await save(); const job=await prepareIntent(U,'draft',1,'checkout:publish');
    await db.query('update web_app_publish_intents set stripe_session_id=$1,status=$2 where id=$3',['cs_paid','queued',job.id]);
    state.stripe=vi.fn(async(path:string)=>path==='checkout/sessions/cs_paid'
      ? {client_reference_id:U,metadata:{intent_id:job.id},status:'complete',payment_status:'paid',subscription:'sub_paid'}
      : {id:'sub_paid',customer:'cus_paid',status:'active',metadata:{app:'aibarber-app',user_id:U},items:{data:[{price:{id:'price_test'}}]}});
    const deps=liveJobDeps(); deps.publish=async()=>({status:200,body:{siteId:'paid',deployedUrl:'https://paid.example',version:1}});
    await runJob(job.id,deps);
    expect((await db.query<any>('select * from web_app_entitlements')).rows[0].status).toBe('active');
    expect((await readDraft(U))?.published_binding.transactionId).toBe('web:sub_paid');
  });
  it('never publishes for an unrelated Stripe subscription or price',async()=>{
    const {job}=await setup(); job.stripe_subscription_id='sub_wrong';
    state.stripe=async()=>({id:'sub_wrong',customer:'cus',status:'active',metadata:{app:'aibarber-app',user_id:V},items:{data:[{price:{id:'price_test'}}]}});
    expect(await liveJobDeps().paid(job)).toBe(false);
  });
  it('cancels queued jobs on deliberate offline action, while allowing drafts to save and explicit paid republish',async()=>{
    const {job,deps}=await setup(); await suspendWork(U);
    await runJob(job.id,deps); expect(deps.publish).not.toHaveBeenCalled();
    expect((await save({...site(),phone:'edit while offline'},1)).code).toBe(200);
    const next=await prepareIntent(U,'draft',2,'publish'); await runJob(next.id,deps);
    expect((await readDraft(U))?.suspended).toBe(false);
  });
  it('blocks republishing during deletion and only resumes after that delete fails',async()=>{
    await setup(); await suspendWork(U,'deleting');
    await expect(prepareIntent(U,'draft',1,'publish')).rejects.toThrow('draft_changed');
    await resumeAfterFailedDelete(U); expect((await readDraft(U))?.suspended).toBe(false);
  });
  it('does not race offline removal against a deployment already in flight',async()=>{
    const {job,deps}=await setup();
    vi.mocked(deps.publish).mockImplementationOnce(async()=>{
      await expect(suspendWork(U)).rejects.toThrow('publish-in-progress');
      return {status:200,body:{siteId:'test',deployedUrl:'https://test.example',version:1}};
    });
    await runJob(job.id,deps); expect((await readDraft(U))?.suspended).toBe(false);
  });
  it('refuses a superseded job, so an old event cannot overwrite a new submission',async()=>{
    const {job,deps}=await setup(); await save({...site(),phone:'newer'},1);
    const next=await prepareIntent(U,'draft',2,'publish');
    await runJob(job.id,deps); await runJob(next.id,deps); expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.publish).mock.calls[0][0].snapshot.phone).toBe('newer');
  });
});
