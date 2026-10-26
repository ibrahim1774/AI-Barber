import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { LearnVideoSlug } from '@/lib/learnContent';

type P = { size?: number; color: string };
const Base = ({ size = 22, color, children }: P & { children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </Svg>
);

/** One small line icon per Learn topic (lucide shapes). */
export function LearnTopicIcon({ slug, size, color }: P & { slug: LearnVideoSlug }) {
  switch (slug) {
    case 'intro': // play
      return <Base size={size} color={color}><Circle cx="12" cy="12" r="10" /><Path d="m10 8 6 4-6 4z" /></Base>;
    case 'editing': // pencil
      return <Base size={size} color={color}><Path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></Base>;
    case 'no-account': // user check
      return <Base size={size} color={color}><Circle cx="9" cy="7" r="4" /><Path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><Path d="m17 11 2 2 4-4" /></Base>;
    case 'calendar':
      return <Base size={size} color={color}><Rect x="3" y="4" width="18" height="18" rx="2" /><Path d="M16 2v4M8 2v4M3 10h18" /></Base>;
    case 'store': // shopping bag
      return <Base size={size} color={color}><Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><Path d="M3 6h18" /><Path d="M16 10a4 4 0 0 1-8 0" /></Base>;
    case 'domain': // globe
      return <Base size={size} color={color}><Circle cx="12" cy="12" r="10" /><Path d="M2 12h20" /><Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></Base>;
    case 'notifications': // bell
      return <Base size={size} color={color}><Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Base>;
    case 'team': // users
      return <Base size={size} color={color}><Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M22 21v-2a4 4 0 0 0-3-3.87" /><Path d="M16 3.13a4 4 0 0 1 0 7.75" /></Base>;
  }
}
