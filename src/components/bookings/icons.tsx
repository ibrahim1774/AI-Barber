import Svg, { Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color: string };
const base = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** lucide Calendar (the Bookings tab). */
export function CalendarIcon({ size = 20, color }: IconProps) {
  return (
    <Svg width={size} height={size} {...base} stroke={color}>
      <Path d="M8 2v4" />
      <Path d="M16 2v4" />
      <Rect x="3" y="4" width="18" height="18" rx="2" />
      <Path d="M3 10h18" />
    </Svg>
  );
}

export function PlusIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} {...base} stroke={color}>
      <Path d="M5 12h14" />
      <Path d="M12 5v14" />
    </Svg>
  );
}

/** lucide Share (the header's Share button). */
export function ShareIcon({ size = 20, color }: IconProps) {
  return (
    <Svg width={size} height={size} {...base} stroke={color}>
      <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <Path d="m16 6-4-4-4 4" />
      <Path d="M12 2v13" />
    </Svg>
  );
}
