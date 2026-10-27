import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockAddOwn = jest.fn();
const mockSetView = jest.fn();
jest.mock('@/components/setup/useServicesEditor', () => ({
  useServicesEditor: () => ({ reload: jest.fn(), view: { kind: 'list' }, addOwn: mockAddOwn, setView: mockSetView }),
}));
jest.mock('@/components/setup/ServicesEditor', () => ({ ServicesEditorView: () => null }));
import fs from 'fs';
import path from 'path';
import { canOpenAddService, keepServicesAdd } from '@/lib/addServiceGuard';
import { BookingsServicesSheet } from '@/components/setup/BookingsServicesSheet';

const { act, create } = require('react-test-renderer');

describe('add a service guard', () => {
  test('blocked by any open sheet or overlay', () => {
    expect(canOpenAddService(null, null)).toBe(true);
    expect(canOpenAddService('hours', null)).toBe(false);
    expect(canOpenAddService(null, 'guide')).toBe(false);
    expect(canOpenAddService(null, 'prompts')).toBe(false);
  });
  test('the add flag does not outlive the Services sheet', () => {
    expect(keepServicesAdd(true, 'services')).toBe(true);
    expect(keepServicesAdd(true, null)).toBe(false); // lapse close
    expect(keepServicesAdd(true, 'sections')).toBe(false);
    expect(keepServicesAdd(false, 'services')).toBe(false);
  });
  test('the Edit tab uses both', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/edit.tsx'), 'utf8');
    expect(src).toMatch(/canOpenAddService\(sheet, overlayRef\.current\)/);
    expect(src).toMatch(/keepServicesAdd\(/);
  });
});

describe('Add a service on a Bookings-shop site', () => {
  const shop = { id: 's1', slug: 's' } as never;
  const mount = (startAdd?: boolean) => {
    act(() => { create(<BookingsServicesSheet visible shop={shop} onServices={jest.fn()} onClose={jest.fn()} upload={jest.fn()} startAdd={startAdd} />); });
  };
  beforeEach(() => { mockAddOwn.mockClear(); mockSetView.mockClear(); });
  test('startAdd opens the shop\'s new-service form', () => {
    mount(true);
    expect(mockAddOwn).toHaveBeenCalledTimes(1);
  });
  test('without startAdd the list shows', () => {
    mount(false);
    expect(mockAddOwn).not.toHaveBeenCalled();
  });
  test('closing the sheet resets it to the list, so it never reopens on a leftover New service form', () => {
    const el = (visible: boolean) => <BookingsServicesSheet visible={visible} shop={shop} onServices={jest.fn()} onClose={jest.fn()} upload={jest.fn()} />;
    let r: { update(e: unknown): void };
    act(() => { r = create(el(true)); });
    expect(mockSetView).not.toHaveBeenCalled();
    act(() => { r.update(el(false)); });
    expect(mockSetView).toHaveBeenCalledWith({ kind: 'list' });
  });
});
