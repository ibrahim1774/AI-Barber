// Jest stand-in for expo-video.
import React from 'react';

export const mockPlayer = {
  loop: false,
  muted: false,
  playbackRate: 1,
  play: jest.fn(),
  pause: jest.fn(),
  replay: jest.fn(),
  addListener: jest.fn((ev: string, fn: (e?: any) => void) => {
    (mockHandlers[ev] ||= []).push(fn);
    return { remove: jest.fn() };
  }),
};
export const mockHandlers: Record<string, ((e?: any) => void)[]> = {};
/** Fire a player event at the component (e.g. 'playToEnd'). */
export const emit = (ev: string, e?: any) => (mockHandlers[ev] || []).forEach((f) => f(e));
/** Every source a player was created with, newest last (tests check which clip a screen plays). */
export const mockSources: unknown[] = [];
export const useVideoPlayer = (s: unknown, setup?: (p: typeof mockPlayer) => void) => {
  const done = React.useRef(false); // like the real hook, setup runs once per mount
  if (!done.current) {
    done.current = true;
    mockSources.push(s);
    setup?.(mockPlayer);
  }
  return mockPlayer;
};
export const VideoView = (props: object) => React.createElement('VideoView', props);
