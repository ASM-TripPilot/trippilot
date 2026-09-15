import Svg, { Path } from 'react-native-svg';

// TRIP-806 · place 카드 전용 하트 글리프 — `features/explore/ui/ExploreGlyphs`의 하트 3종을
// entities 로 모았다(카드가 entities 로 올라오며 함께 이동). features 간 import 금지 관례처럼
// 색은 이 파일 안에서만 raw hex 로 고정한다(`*Glyphs.tsx` 는 raw-hex 가드 대상 아님, 리포 전체 관례).
//
// 담김/미담김은 SVG fill 색이 아니라 **서로 다른 글리프 컴포넌트 + testID**로 잰다(글리프 fill
// 함정 회피, repo-traps) — 그래서 옵셔널 `testID` prop 을 받는다(소비처가 필요하면 전달).

const INK = '#222222';
const PRIMARY = '#FF385C';
const HEART_PATH =
  'M9 16.0125L7.9125 15.0225C4.05 11.52 1.5 9.21 1.5 6.375C1.5 4.065 3.315 2.25 5.625 2.25C6.93 2.25 8.1825 2.8575 9 3.8175C9.8175 2.8575 11.07 2.25 12.375 2.25C14.685 2.25 16.5 4.065 16.5 6.375C16.5 9.21 13.95 11.52 10.0875 15.03L9 16.0125Z';

type GlyphProps = {
  size?: number;
  testID?: string;
};

/** 미담김 — 테두리만(먹색). */
export function HeartOutlineGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d={HEART_PATH}
        stroke={INK}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 담김 — 분홍 채움. */
export function HeartFilledGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path d={HEART_PATH} fill={PRIMARY} />
    </Svg>
  );
}

/** "담음" 배지 안에 들어가는 축소 하트(흰색). */
export function HeartBadgeGlyph({ size = 12, testID }: GlyphProps) {
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
        fill="#FFFFFF"
      />
    </Svg>
  );
}
