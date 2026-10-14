import Svg, { Path } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

// 22-viewBox 하트(stroke 1.6) — shared/ui/HeartGlyphs.tsx(18-viewBox, 카드용)와 모양이 달라
// 합치지 않고 이름을 분리했다. 담김/미담김은 색이 아니라 **서로 다른 컴포넌트**로 가른다
// (repo-traps: fill 변화는 jest 사각 — useState 토글 금지).
const HEART_22_PATH =
  'M11 19C11 19 3 14 3 8.6C3 5.9 5.1 3.8 7.7 3.8C9.1 3.8 10.4 4.5 11 5.6C11.6 4.5 12.9 3.8 14.3 3.8C16.9 3.8 19 5.9 19 8.6C19 14 11 19 11 19Z';

/** 담김 — 채움(분홍) + 같은 색 테두리. */
export function HeartStrokeFilledGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d={HEART_22_PATH}
        fill={GLYPH_COLORS.primary}
        stroke={GLYPH_COLORS.primary}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 미담김 — 테두리만. 색은 사진 위(onPrimary)·회색 카드 위(muted)에 따라 소비처가 고른다. */
export function HeartStrokeOutlineGlyph({
  size = 22,
  color = 'muted',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d={HEART_22_PATH}
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
