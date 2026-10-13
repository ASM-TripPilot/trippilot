import Svg, { Path } from 'react-native-svg';

// TRIP-1266 · 위저드 공용 헤더 ‹ 글리프. widgets 는 `@/features` 를 import 하지 않으므로
// `features/trip/ui/TripGlyphs` 의 BackChevronGlyph(ink) 를 **바이트 복제**한다(MapSheetGlyphs 선례).
// 색은 이 파일에서만 raw hex 로 고정한다(SVG stroke 는 className 을 못 받는다 · `*Glyphs.tsx` 관례).

const INK = '#222222';

// 앱바 뒤로가기(24) — Figma `1675:1185`.
export function BackChevronGlyph() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
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
