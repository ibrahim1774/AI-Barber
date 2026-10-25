import type { LearnVideoSlug } from '@/lib/learnContent';

/**
 * The bundled how-to videos. Metro needs a static require, so a recording is added by dropping
 * assets/tutorial/<slug>.mp4 in and adding its line here. A slug with no entry shows nothing.
 */
export const LEARN_VIDEOS: Partial<Record<LearnVideoSlug, number>> = {
  // intro: require('../../assets/tutorial/intro.mp4'),
  // editing: require('../../assets/tutorial/editing.mp4'),
  // bookings: require('../../assets/tutorial/bookings.mp4'),
  // store: require('../../assets/tutorial/store.mp4'),
  // payments: require('../../assets/tutorial/payments.mp4'),
};
