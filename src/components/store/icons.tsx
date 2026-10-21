import Svg, { Path } from 'react-native-svg';

type IconProps = { size?: number; color: string };
const base = { viewBox: '0 0 24 24', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** lucide ShoppingBag (the Store tab). */
export function BagIcon({ size = 20, color }: IconProps) {
  return (
    <Svg width={size} height={size} {...base} stroke={color}>
      <Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <Path d="M3 6h18" />
      <Path d="M16 10a4 4 0 0 1-8 0" />
    </Svg>
  );
}
