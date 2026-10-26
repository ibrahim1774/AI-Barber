// "Forgot password?" from the locked step ends in a sign-in: it must land back on /claim, not on the editor.
import React from 'react';
import { render } from './store/render';

const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a), goBackOrHome: jest.fn() }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/setup/gate', () => ({ takePostAuthReturn: () => false }));

import { useAfterSignIn } from '@/lib/afterSignIn';
import * as store from '@/lib/siteStore';

let after: ReturnType<typeof useAfterSignIn>;
function Probe() {
  after = useAfterSignIn();
  return null;
}

beforeEach(async () => {
  mockResetTo.mockClear();
  await store.clearSite();
  await store.savePendingPublish(null);
});

test.each(['unclaimed', 'claiming', 'conflict'] as const)('a %s paid record sends the sign-in back to /claim', async (state) => {
  await store.savePendingPublish({ transactionId: 'tx', data: {} as never, createdAt: Date.now(), state });
  await render(<Probe />);
  await after({ title: 'Password updated', message: 'm' });
  expect(mockResetTo).toHaveBeenCalledWith('/claim');
});

test('an ordinary pending publish does not', async () => {
  await store.saveSite({ draftId: 'd', inputs: {}, data: {}, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as never);
  await store.savePendingPublish({ transactionId: 'tx', data: {} as never, createdAt: Date.now() });
  await render(<Probe />);
  await after();
  expect(mockResetTo).toHaveBeenCalledWith('/edit');
});
