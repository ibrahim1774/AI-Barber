import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/lib/webPlan', () => ({useWebPlanActive:()=>true}));
const { act, create } = require('react-test-renderer');
jest.mock('@/lib/webAccount.web', () => ({
  ensureWebDraftSaved: jest.fn(), currentWebSaveState: () => ({ kind: 'retry' }), resetWebSaveState: jest.fn(),
  webPublishStatus: jest.fn(), adoptWebPublishedBinding: jest.fn(async () => {}),
}));
jest.mock('@/lib/webAutosaveLegacy.web', () => ({ flushWebAutosave: jest.fn(async () => {}) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: jest.fn(async () => ({ data: { session: { user: { id: 'owner' } } } })), onAuthStateChange: jest.fn(),
} } }));
import { flushWebAutosave } from '@/lib/webAutosave.web';
import { ensureWebDraftSaved, webPublishStatus, adoptWebPublishedBinding } from '@/lib/webAccount.web';
import { withPendingWebAsset } from '@/lib/webAssets';
import { WebPublishRecovery } from '@/components/WebPublishRecovery.web';
import { setResume, readResume } from '@/lib/webResume';

const saved = { id: 'draft', revision: 2, site_data: {}, updated_at: '2026-11-01T00:00:00Z' };
beforeEach(() => {
  process.env.EXPO_PUBLIC_WEB_DRAFTS = '1'; jest.useFakeTimers(); jest.clearAllMocks();
  const mem = new Map();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k), setItem: (k: string,v: string) => mem.set(k,v), removeItem: (k: string) => mem.delete(k) };
  (globalThis as any).window = { location: { search: '?paid=1', href: 'http://test/app/edit?paid=1' }, history: { replaceState: jest.fn() } };
});
afterEach(() => { delete process.env.EXPO_PUBLIC_WEB_DRAFTS; delete (globalThis as any).localStorage; jest.useRealTimers(); });
describe('strict save gate', () => {
  it('returns only the acknowledged revision', async () => {
    jest.mocked(ensureWebDraftSaved).mockResolvedValueOnce(saved);
    await expect(flushWebAutosave()).resolves.toEqual(saved);
  });
  it('rejects an offline/failed save rather than continuing toward payment', async () => {
    jest.mocked(ensureWebDraftSaved).mockRejectedValueOnce(new Error('offline'));
    await expect(flushWebAutosave()).rejects.toThrow('offline');
  });
  it('a timeout is a failure, never a successful save acknowledgement', async () => {
    jest.mocked(ensureWebDraftSaved).mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(flushWebAutosave(100)).rejects.toThrow('still saving');
    await jest.advanceTimersByTimeAsync(101); await result;
  });
  it('blocks leaving for checkout while a selected image is uploading', async () => {
    let finish!: () => void;
    const upload = withPendingWebAsset(() => new Promise<void>(r => { finish = r; }));
    await expect(flushWebAutosave()).rejects.toThrow('photo is still uploading');
    expect(ensureWebDraftSaved).not.toHaveBeenCalled(); finish(); await upload;
  });
});
describe('paid publish recovery', () => {
  const text = (tree: any) => JSON.stringify(tree.toJSON());
  it('does not consume the resume or claim live while the server job is running', async () => {
    setResume('website','owner'); jest.mocked(webPublishStatus).mockResolvedValue({intent:{status:'running'}});
    const resume=jest.fn(); let tree: any;
    await act(async()=>{tree=create(<WebPublishRecovery onResume={resume}/>);});
    expect(text(tree)).toContain('Publishing your saved website'); expect(readResume('owner')).not.toBeNull();
    expect(resume).not.toHaveBeenCalled(); expect(adoptWebPublishedBinding).not.toHaveBeenCalled();
    act(()=>tree.unmount());
  });
  it('only adopts live metadata after the server confirms completion', async () => {
    setResume('website','owner'); jest.mocked(webPublishStatus).mockResolvedValue({intent:{status:'live'}});
    let tree: any; await act(async()=>{tree=create(<WebPublishRecovery onResume={jest.fn()}/>);});
    expect(adoptWebPublishedBinding).toHaveBeenCalledWith('owner'); expect(readResume('owner')).toBeNull();
    expect(text(tree)).toContain('Your website is live'); act(()=>tree.unmount());
  });
  it('keeps editing available after failure and retries without invoking a paywall', async()=>{
    jest.mocked(webPublishStatus).mockResolvedValue({intent:{status:'failed'}});
    const resume=jest.fn(); let tree: any;
    await act(async()=>{tree=create(<WebPublishRecovery onResume={resume}/>);});
    expect(text(tree)).toContain('You can keep editing');
    const button=tree.root.findAll((n:any)=>n.props?.accessibilityRole==='button' && typeof n.props.onPress==='function')[0];
    await act(async()=>{button.props.onPress();});
    expect(webPublishStatus).toHaveBeenCalledWith(true); expect(resume).not.toHaveBeenCalled(); act(()=>tree.unmount());
  });
  it('submits a newer explicit paid Publish request instead of treating the old live version as its completion',async()=>{
    setResume('website','owner',Date.now(),2);
    jest.mocked(webPublishStatus).mockResolvedValue({intent:{status:'live',revision:1}});
    const resume=jest.fn();let tree:any;
    await act(async()=>{tree=create(<WebPublishRecovery onResume={resume}/>);});
    expect(resume).toHaveBeenCalledWith('website');expect(readResume('owner')).not.toBeNull();act(()=>tree.unmount());
  });
  it('does not automatically publish edits made after the original checkout snapshot',async()=>{
    setResume('website','owner',Date.now(),1);
    jest.mocked(webPublishStatus).mockResolvedValue({intent:{status:'live',revision:1}});
    const resume=jest.fn();let tree:any;
    await act(async()=>{tree=create(<WebPublishRecovery onResume={resume}/>);});
    expect(resume).not.toHaveBeenCalled();expect(readResume('owner')).toBeNull();act(()=>tree.unmount());
  });
});
