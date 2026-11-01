it('keeps acknowledgement baselines separate for two tabs on the same account', async () => {
  const previous = (globalThis as any).sessionStorage;
  const storage = () => { const data=new Map();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)}; };
  const tabA=storage(),tabB=storage();let a:any,b:any;
  jest.isolateModules(()=>{a=require('../../src/lib/webDraftBase');});
  jest.isolateModules(()=>{b=require('../../src/lib/webDraftBase');});
  const receipt={owner:'owner',row:{id:'draft',revision:1,site_data:{phone:'111'},updated_at:'2026-11-01T00:00:00Z'}};
  try {
    (globalThis as any).sessionStorage=tabA;await a.rememberWebDraftBase(receipt);
    (globalThis as any).sessionStorage=tabB;expect(await b.readWebDraftBase('owner')).toBeNull();
    await b.rememberWebDraftBase({...receipt,row:{...receipt.row,revision:2,site_data:{phone:'222'}}});
    (globalThis as any).sessionStorage=tabA;expect((await a.readWebDraftBase('owner')).row.revision).toBe(1);
  } finally { (globalThis as any).sessionStorage=previous; }
});
