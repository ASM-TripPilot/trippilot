import Svg, { Path } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

// 하트 두 벌 — 22-viewBox(`HeartStroke*`, stroke 1.6)와 18-viewBox(`Heart{Outline,Filled,Badge}`, 카드용)는
// 곡선이 달라 그림을 합치지 않고 이름을 분리했다(TRIP-1829 에서 18 하트 파일을 여기로 옮김).
// 담김/미담김은 색이 아니라 **서로 다른 컴포넌트**로 가른다(repo-traps: fill 변화는 jest 사각 — useState 토글 금지).
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

// 18-viewBox 하트 — place 카드·stay 검색 카드·HeartButton 이 쓴다(색은 고정, color prop 없음).
const HEART_18_PATH =
  'M9 16.0125L7.9125 15.0225C4.05 11.52 1.5 9.21 1.5 6.375C1.5 4.065 3.315 2.25 5.625 2.25C6.93 2.25 8.1825 2.8575 9 3.8175C9.8175 2.8575 11.07 2.25 12.375 2.25C14.685 2.25 16.5 4.065 16.5 6.375C16.5 9.21 13.95 11.52 10.0875 15.03L9 16.0125Z';

type FixedColorGlyphProps = Omit<GlyphProps, 'color'>;

/** 미담김 — 테두리만(먹색). */
export function HeartOutlineGlyph({ size = 18, testID }: FixedColorGlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d={HEART_18_PATH}
        stroke={GLYPH_COLORS.ink}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 담김 — 분홍 채움. */
export function HeartFilledGlyph({ size = 18, testID }: FixedColorGlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path d={HEART_18_PATH} fill={GLYPH_COLORS.primary} />
    </Svg>
  );
}

/** "담음" 배지 안에 들어가는 축소 하트(흰색). */
export function HeartBadgeGlyph({ size = 12, testID }: FixedColorGlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M6 10.675L5.275 10.015C2.7 7.68 1 6.14 1 4.25C1 2.71 2.21 1.5 3.75 1.5C4.62 1.5 5.455 1.905 6 2.545C6.545 1.905 7.38 1.5 8.25 1.5C9.79 1.5 11 2.71 11 4.25C11 6.14 9.3 7.68 6.725 10.02L6 10.675Z"
        fill={GLYPH_COLORS.onPrimary}
      />
    </Svg>
  );
}
