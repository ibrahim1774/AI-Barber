import type { LearnVideoSlug } from '@/lib/learnContent';

/**
 * The bundled how-to videos (assets/tutorial/<slug>.mp4, portrait H.264, under 3 MB each). Metro needs a static
 * require, so a recording is added by dropping the file in and adding its line here. A slug with no entry shows
 * nothing. Recorded from the iOS Simulator on demo data with arrows and captions: see scripts/make_tutorial_video.py.
 */
export const LEARN_VIDEOS: Partial<Record<LearnVideoSlug, number>> = {
  intro: require('../../assets/tutorial/intro.mp4'),
  editing: require('../../assets/tutorial/editing.mp4'),
  'no-account': require('../../assets/tutorial/no-account.mp4'),
  calendar: require('../../assets/tutorial/calendar.mp4'),
  store: require('../../assets/tutorial/store.mp4'),
  domain: require('../../assets/tutorial/domain.mp4'),
  notifications: require('../../assets/tutorial/notifications.mp4'),
  team: require('../../assets/tutorial/team.mp4'),
};
