import Svg, { Path } from 'react-native-svg';

// TRIP-808 · entities/trip 카드 전용 인라인 벡터 글리프. features/itinerary/ui/ItineraryGlyphs 는
// entities → features 역참조라 import 할 수 없어(층 위반) chevron 을 여기 자기 사본으로 둔다
// (리포 글리프 로컬 복제 관례). ChevronRightGlyph 는 ItineraryGlyphs 판을 viewBox·path·색·획 두께까지
// 그대로 옮긴 것 — h06 resume CTA 의 chevron 이 이관으로 모양을 안 바꾸게 한다.
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례,
// SVG `stroke`/`fill` 은 className 을 못 받는다).

const MUTED_SOFT = '#9AA1AB';
const INK = '#222222';
const PRIMARY = '#FF385C';

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

// ⋯ more(20) — Figma `4682:2624`(h06 삭제 메뉴 more-button). 원 세 개 ink 채움.
export function MoreDotsGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M4.16667 11.25C4.85702 11.25 5.41667 10.6904 5.41667 10C5.41667 9.30964 4.85702 8.75 4.16667 8.75C3.47631 8.75 2.91667 9.30964 2.91667 10C2.91667 10.6904 3.47631 11.25 4.16667 11.25Z"
        fill={INK}
      />
      <Path
        d="M10 11.25C10.6904 11.25 11.25 10.6904 11.25 10C11.25 9.30964 10.6904 8.75 10 8.75C9.30964 8.75 8.75 9.30964 8.75 10C8.75 10.6904 9.30964 11.25 10 11.25Z"
        fill={INK}
      />
      <Path
        d="M15.8333 11.25C16.5237 11.25 17.0833 10.6904 17.0833 10C17.0833 9.30964 16.5237 8.75 15.8333 8.75C15.143 8.75 14.5833 9.30964 14.5833 10C14.5833 10.6904 15.143 11.25 15.8333 11.25Z"
        fill={INK}
      />
    </Svg>
  );
}

// 휴지통(18) — Figma `4682:2647`(h06 삭제 메뉴 항목). primary 선 1.5.
export function TrashGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M2.25 4.5H15.75"
        stroke={PRIMARY}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14.25 4.5L13.5 15C13.5 15.3978 13.342 15.7794 13.0607 16.0607C12.7794 16.342 12.3978 16.5 12 16.5H6C5.60218 16.5 5.22064 16.342 4.93934 16.0607C4.65804 15.7794 4.5 15.3978 4.5 15L3.75 4.5"
        stroke={PRIMARY}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 4.5V3C6 2.60218 6.15804 2.22064 6.43934 1.93934C6.72064 1.65804 7.10218 1.5 7.5 1.5H10.5C10.8978 1.5 11.2794 1.65804 11.5607 1.93934C11.842 2.22064 12 2.60218 12 3V4.5"
        stroke={PRIMARY}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
