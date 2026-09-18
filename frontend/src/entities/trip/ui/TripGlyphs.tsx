import Svg, { Path } from 'react-native-svg';

// TRIP-808 · entities/trip 카드 전용 인라인 벡터 글리프. features/itinerary/ui/ItineraryGlyphs 는
// entities → features 역참조라 import 할 수 없어(층 위반) chevron 을 여기 자기 사본으로 둔다
// (리포 글리프 로컬 복제 관례). ChevronRightGlyph 는 ItineraryGlyphs 판을 viewBox·path·색·획 두께까지
// 그대로 옮긴 것 — h06 resume CTA 의 chevron 이 이관으로 모양을 안 바꾸게 한다.
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례,
// SVG `stroke`/`fill` 은 className 을 못 받는다).

const MUTED_SOFT = '#9AA1AB';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// chevron-right(20) — Figma `1906:1083`(ItineraryGlyphs 판 그대로).
export function ChevronRightGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M7.5 5L12.5 10L7.5 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.83333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
