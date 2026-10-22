import React from 'react';

process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
const mockQuiet = jest.fn(async (_id?: unknown) => {});
jest.mock('@/lib/plan', () => ({
  refreshPlan: jest.fn(), setSharedPlan: jest.fn(), refreshPlanQuietly: (id: unknown) => mockQuiet(id),
}));
const mockRelink = jest.fn(async (_o?: unknown) => false);
jest.mock('@/lib/setup/relink', () => ({ relinkShopPurchase: (o: unknown) => mockRelink(o) }));
jest.mock('@/lib/account', () => ({ ...jest.requireActual('@/lib/account'), syncIfSignedIn: jest.fn(async () => {}) }));

/* eslint-disable @typescript-eslint/no-require-imports */
const { usePublishDeps } = require('@/lib/paywall');
const { act, create } = require('react-test-renderer') as { act(fn: () => void): void; create(el: React.ReactElement): { unmount(): void } };
/* eslint-enable @typescript-eslint/no-require-imports */

it('a live publish asks the server to re-read the plan (relinks a shop stuck on a lapsed purchase)', async () => {
  let deps: any;
  function Probe() {
    deps = usePublishDeps();
    return null;
  }
  act(() => {
    create(React.createElement(Probe));
  });
  await deps.onLive({ transactionId: 'tx-live', draftId: 'd' });
  expect(mockQuiet).toHaveBeenCalledWith('tx-live');
});
