import type { TutorialSlug } from '@/lib/tutorialTopics';

/**
 * The bundled tutorial videos. Metro needs a static require, so a recording is added by dropping
 * assets/tutorial/<slug>.mp4 in and adding its line here. A slug with no entry shows "Video coming soon".
 */
export const TUTORIAL_VIDEOS: Partial<Record<TutorialSlug, number>> = {
  // 'site-editing': require('../../assets/tutorial/site-editing.mp4'),
  // 'bookings': require('../../assets/tutorial/bookings.mp4'),
  // 'store': require('../../assets/tutorial/store.mp4'),
  // 'adding-products': require('../../assets/tutorial/adding-products.mp4'),
  // 'getting-paid': require('../../assets/tutorial/getting-paid.mp4'),
};
