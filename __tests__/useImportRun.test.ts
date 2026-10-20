import { createRunGuard, runImport, type RunHooks } from '@/lib/useImportRun';

const site = { inputs: { shopName: 'Fade' }, site: { shopName: 'Fade' } } as any;

function hooks(over: Partial<RunHooks> = {}) {
  return {
    onReady: jest.fn(),
    onFail: jest.fn(),
    save: jest.fn(async () => {}),
    navigate: jest.fn(),
    wait: jest.fn(async () => {}),
    ...over,
  };
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

test('a finished run saves the draft, then navigates', async () => {
  const h = hooks();
  await runImport(createRunGuard(), async () => site, h);
  expect(h.onReady).toHaveBeenCalled();
  expect(h.wait).toHaveBeenCalledWith(150);
  expect(h.save).toHaveBeenCalledWith(site);
  expect(h.navigate).toHaveBeenCalledTimes(1);
  expect(h.onFail).not.toHaveBeenCalled();
});

test('a result that lands after the screen is gone does not save or navigate', async () => {
  const guard = createRunGuard();
  const d = deferred<any>();
  const h = hooks();
  const p = runImport(guard, () => d.promise, h);
  guard.cancel(); // unmount
  d.resolve(site);
  await p;
  expect(h.save).not.toHaveBeenCalled();
  expect(h.navigate).not.toHaveBeenCalled();
});

test('a newer run supersedes an older one', async () => {
  const guard = createRunGuard();
  const first = deferred<any>();
  const h1 = hooks();
  const h2 = hooks();
  const p1 = runImport(guard, () => first.promise, h1);
  const p2 = runImport(guard, async () => site, h2);
  first.resolve(site);
  await Promise.all([p1, p2]);
  expect(h1.navigate).not.toHaveBeenCalled();
  expect(h2.navigate).toHaveBeenCalledTimes(1);
});

test('leaving during the save does not navigate', async () => {
  const guard = createRunGuard();
  const h = hooks({ save: jest.fn(async () => { guard.cancel(); }) });
  await runImport(guard, async () => site, h);
  expect(h.save).toHaveBeenCalled();
  expect(h.navigate).not.toHaveBeenCalled();
});

test('a failure reports the message; a stale failure is dropped', async () => {
  const h = hooks();
  await runImport(createRunGuard(), async () => { throw new Error('No shop found at that link'); }, h);
  expect(h.onFail).toHaveBeenCalledWith('No shop found at that link');

  const guard = createRunGuard();
  const h2 = hooks();
  const p = runImport(guard, async () => { guard.cancel(); throw new Error('late'); }, h2);
  await p;
  expect(h2.onFail).not.toHaveBeenCalled();
});

test('a failure with no message gets the web fallback copy', async () => {
  const h = hooks();
  await runImport(createRunGuard(), async () => { throw {}; }, h);
  expect(h.onFail).toHaveBeenCalledWith('Something went wrong — try again.');
});
