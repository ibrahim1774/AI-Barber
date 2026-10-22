import React from 'react';
import { Alert } from 'react-native';
import { press, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/components/setup/Barbers', () => ({ Barbers: () => null }));
jest.mock('@/components/setup/GetPaid', () => ({ GetPaid: () => null }));
jest.mock('@/components/setup/HoursGrid', () => ({ MemberHours: () => null }));
jest.mock('@/components/setup/ServicesEditor', () => ({ ServicesEditorView: () => null }));
jest.mock('@/components/setup/useServicesEditor', () => ({ useServicesEditor: () => ({}) }));
jest.mock('@/lib/photos', () => ({ pickAndUploadPhoto: jest.fn() }));
jest.mock('@/lib/setup/relink', () => ({ registerPushForShop: jest.fn(async () => {}) }));
jest.mock('@/lib/setup/wizardFlag', () => ({ markWizardDone: jest.fn(async () => {}) }));
jest.mock('@/lib/shop', () => ({
  ...jest.requireActual('@/lib/shop'),
  listMembers: async () => [],
  updateShopSettings: jest.fn(async () => {}),
}));
const mockRecord = jest.fn();
jest.mock('@/lib/setup/siteSync', () => ({
  updateSiteData: jest.fn(),
  updateSiteRecord: (fn: any) => mockRecord(fn),
}));

import { Wizard, WIZARD_PUBLISH_BODY, WIZARD_PUBLISH_TITLE } from '@/components/setup/Wizard';

const SHOP: any = { id: 's1', slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true };
const SITE: any = {
  draftId: 'd', inputs: { shopName: 'F', area: '', phone: '' }, data: { shopName: 'F', phone: '1' },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
};

async function finish() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockRecord.mockImplementation(async (fn: any) => fn(SITE));
  const onFinish = jest.fn();
  const tree = await render(<Wizard shop={SHOP} site={SITE} onShopChanged={() => {}} onFinish={onFinish} />);
  for (let i = 0; i < 4; i++) await press(tree, 'Continue');
  await press(tree, 'Finish');
  return { alert, onFinish };
}

afterEach(() => jest.restoreAllMocks());

it('finishing with AI Barber booking prompts to publish', async () => {
  const { alert, onFinish } = await finish();
  expect(alert).toHaveBeenCalledWith(WIZARD_PUBLISH_TITLE, WIZARD_PUBLISH_BODY);
  expect(onFinish).toHaveBeenCalled();
});
