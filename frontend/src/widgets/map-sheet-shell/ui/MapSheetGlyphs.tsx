import Svg, { Circle, Path } from 'react-native-svg';

// TRIP-783 · 지도+시트 셸 전용 인라인 SVG 글리프. widgets → `@/features` import 는 층 린트가 막아
// (widgetsStructure F FAIL) `features/itinerary/ui/ItineraryGlyphs` 의 Back/Car/Walk 를 **바이트 복제**
// 한다(리포 글리프 로컬 복제 관례의 N번째 사본). 색은 이 파일에서만 raw hex 로 고정한다(SVG stroke/fill
// 은 className 을 못 받고 `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례 · docs/structure.md §지금 작업하려면).

const INK = '#222222';
const MUTED = '#6A6A6A';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 좌상단 back — 흰 원 안 뒤로가기 chevron. BackChevronGlyph(ItineraryGlyphs) 바이트 복제.
export function BackChevronGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 18L9 12L15 6"
        stroke={INK}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 커넥터 이동수단 · 도보(16) — WalkGlyph(ItineraryGlyphs) 바이트 복제. `distanceRange` 에 `차량` 이
// 없으면 이 글리프를 쓴다. 거리 글자와 같은 muted.
export function WalkGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Circle cx={9} cy={3} r={1.5} fill={MUTED} />
      <Path
        d="M9 5.5L8 9"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L6.5 13"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L10 11.5V13"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6.5L11 8"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 커넥터 이동수단 · 차량(16) — CarGlyph(ItineraryGlyphs) 바이트 복제. `distanceRange` 에 `차량` 이
// 있으면 이 글리프를 쓴다. 거리 글자와 같은 muted.
export function CarGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M2 11L3 7.5C3.13 7.2 3.42 7 3.75 7H12.25C12.58 7 12.87 7.2 13 7.5L14 11V12.5H2V11Z"
        stroke={MUTED}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={5} cy={12.5} r={1} fill={MUTED} />
      <Circle cx={11} cy={12.5} r={1} fill={MUTED} />
    </Svg>
  );
}
