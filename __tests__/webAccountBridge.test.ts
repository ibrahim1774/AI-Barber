let mockRecord: any;
const mockStorage = new Map<string,string>();
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: {
  getItem: async (k: string) => mockStorage.get(k) ?? null,
  setItem: async (k: string,v: string) => { mockStorage.set(k,v); },
} }));
jest.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({data:{session:{user:{id:'owner'},access_token:'local-test'}}}) } } }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => mockRecord, saveSite: async (r: any) => { mockRecord=r; } }));
jest.mock('@/lib/publish', () => ({ publishPayload: (data: any) => data }));
jest.mock('@/lib/account', () => ({ appPrefsField: () => ({}) }));
import { rememberWebDraftBase } from '@/lib/webDraftBase';
import { ensureWebDraftSaved } from '@/lib/webAccount.web';
import { onSiteAdopted } from '@/lib/siteEvents';

it('updates the open editor after merging another device, so its next edit cannot replay stale fields', async () => {
  const oldData = { shopName:'Original',phone:'111',area:'Town' };
  mockRecord={draftId:'draft',data:oldData,inputs:oldData,ownerUserId:'owner',updatedAt:10,accountSyncedAt:10};
  await rememberWebDraftBase({owner:'owner',row:{id:'draft',revision:1,site_data:{...oldData,source:'web-app'},updated_at:'2026-11-01T00:00:00Z'}});
  let cloud={id:'draft',revision:2,site_data:{...oldData,phone:'222',source:'web-app'},updated_at:'2026-11-01T00:00:01Z'};
  const previousFetch=global.fetch;
  global.fetch=jest.fn(async(_url,init:any)=>{
    if(init.method==='PUT') {
      const body=JSON.parse(init.body);expect(body.expectedRevision).toBe(cloud.revision);
      cloud={...cloud,revision:cloud.revision+1,site_data:body.site_data};
    }
    return {ok:true,json:async()=>({draft:cloud})} as any;
  });
  let editor=mockRecord;
  const stop=onSiteAdopted(record=>{editor=record;});
  try {
    mockRecord={...editor,data:{...editor.data,shopName:'First edit'},updatedAt:11}; editor=mockRecord;
    await ensureWebDraftSaved();
    expect(editor.data.phone).toBe('222');
    mockRecord={...editor,data:{...editor.data,shopName:'Next edit'},updatedAt:12};
    await ensureWebDraftSaved();
    expect(cloud.site_data.phone).toBe('222');expect(cloud.site_data.shopName).toBe('Next edit');
  } finally { stop();global.fetch=previousFetch; }
});
