import React, { type MutableRefObject } from 'react';

const mockInject = jest.fn();
let mockMounts = 0;
let mockProps: any = null;
jest.mock('react-native-webview', () => {
  const R = require('react');
  return {
    WebView: R.forwardRef((props: any, ref: any) => {
      mockProps = props;
      R.useEffect(() => { mockMounts += 1; }, []);
      R.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
      return null;
    }),
  };
});
jest.mock('@/constants/theme', () => require('./store/themeMock'));

import SitePreview from '@/components/SitePreview';
import { shop } from './pagesV2Fixture';

const { act, create } = require('react-test-renderer');
const msg = (o: unknown) => ({ nativeEvent: { data: JSON.stringify(o) } });

describe('SitePreview recovers when iOS ends the page process', () => {
  beforeEach(() => { mockInject.mockClear(); mockMounts = 0; });
  afterEach(() => { jest.useRealTimers(); });

  const render = async () => {
    const d = await shop({});
    jest.useFakeTimers();
    const check: MutableRefObject<(() => void) | null> = { current: null };
    act(() => { create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} aliveCheckRef={check} />); });
    return check;
  };

  test('the terminate callback rebuilds the WebView', async () => {
    await render();
    expect(mockMounts).toBe(1);
    act(() => { mockProps.onContentProcessDidTerminate(); });
    expect(mockMounts).toBe(2);
  });

  test('no check before the page has been ready once', async () => {
    const check = await render();
    act(() => { check.current!(); jest.advanceTimersByTime(5000); });
    expect(mockMounts).toBe(1);
  });

  test('a silent page is rebuilt after the wait', async () => {
    const check = await render();
    act(() => { mockProps.onMessage(msg({ type: 'ready' })); });
    act(() => { check.current!(); });
    expect(mockInject.mock.calls.some((c) => String(c[0]).includes('pong'))).toBe(true);
    act(() => { jest.advanceTimersByTime(3500); });
    expect(mockMounts).toBe(2);
  });

  test('an answering page is left alone', async () => {
    const check = await render();
    act(() => { mockProps.onMessage(msg({ type: 'ready' })); });
    act(() => { check.current!(); });
    act(() => { mockProps.onMessage({ nativeEvent: { data: '{"type":"pong"}' } }); jest.advanceTimersByTime(5000); });
    expect(mockMounts).toBe(1);
  });

  test('no check while a load is in progress', async () => {
    const check = await render();
    act(() => { mockProps.onMessage(msg({ type: 'ready' })); mockProps.onLoadStart(); });
    act(() => { check.current!(); jest.advanceTimersByTime(5000); });
    expect(mockMounts).toBe(1);
  });
});
