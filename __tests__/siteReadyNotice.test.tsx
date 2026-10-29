import React from 'react';
import { Modal } from 'react-native';
import { clearOverlayFlags, hasSeen, markSeen } from '@/lib/overlayFlags';

jest.mock('@/constants/theme', () => require('./store/themeMock'));

import { SiteReadyNotice } from '@/components/SiteReadyNotice';

const { act, create } = require('react-test-renderer');
const texts = (tree: any) => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));

describe('the "your website is ready" notice', () => {
  test('says what can be edited and that Publish puts the site online; Got it closes', () => {
    const onClose = jest.fn();
    let tree: any;
    act(() => { tree = create(<SiteReadyNotice visible onClose={onClose} />); });
    const all = texts(tree).join(' | ');
    expect(all).toContain('You can edit the text, photos, services and prices');
    expect(all).toContain('tap Publish to put your website online');
    const btn = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Got it' && n.props.onPress)[0];
    act(() => btn.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('hidden when not visible', () => {
    let tree: any;
    act(() => { tree = create(<SiteReadyNotice visible={false} onClose={jest.fn()} />); });
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
  });
});

describe('the welcome flag (once per generated site)', () => {
  test('unset, set when closed, and cleared by a new generation', async () => {
    const id = `draft-${Math.random().toString(36).slice(2)}`;
    expect(await hasSeen('welcome', id)).toBe(false);
    await markSeen('welcome', id);
    expect(await hasSeen('welcome', id)).toBe(true);
    await clearOverlayFlags(id);
    expect(await hasSeen('welcome', id)).toBe(false);
  });
});
