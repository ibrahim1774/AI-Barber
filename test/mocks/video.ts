// Jest stand-in for expo-video.
import React from 'react';

export const mockPlayer = {
  loop: false,
  playbackRate: 1,
  play: jest.fn(),
  pause: jest.fn(),
  replay: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};
export const useVideoPlayer = (_s: unknown, setup?: (p: typeof mockPlayer) => void) => {
  setup?.(mockPlayer);
  return mockPlayer;
};
export const VideoView = (props: object) => React.createElement('VideoView', props);
