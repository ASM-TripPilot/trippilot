import type { ReactElement } from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * ✦ 도우미 글리프 — 네 갈래 별(Figma b 밴드 헤더 원 안 기호). SVG raw hex 는 `*Glyphs.tsx` 리포 관례.
 */
export function SparkleGlyph({
  size = 22,
  color = '#FFFFFF',
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5c.5 4.6 2.4 8 9.5 9.5-7.1 1.5-9 4.9-9.5 9.5-.5-4.6-2.4-8-9.5-9.5 7.1-1.5 9-4.9 9.5-9.5Z"
        fill={color}
      />
    </Svg>
  );
}
