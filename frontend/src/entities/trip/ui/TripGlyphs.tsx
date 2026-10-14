import Svg, { Path } from 'react-native-svg';
// 공용 글리프(shared/ui/glyphs) 재수출 — 소비처 import 경로는 그대로다 (TRIP-1358)
import { TrashGlyph as SharedTrashGlyph } from '@/shared/ui/glyphs';

export { ChevronRightGlyph } from '@/shared/ui/glyphs';

// TRIP-808 · entities/trip 카드 전용 인라인 벡터 글리프. features/itinerary/ui/ItineraryGlyphs 는
// entities → features 역참조라 import 할 수 없어(층 위반) chevron 을 여기 자기 사본으로 둔다
// (리포 글리프 로컬 복제 관례). ChevronRightGlyph 는 ItineraryGlyphs 판을 viewBox·path·색·획 두께까지
// 그대로 옮긴 것 — h06 resume CTA 의 chevron 이 이관으로 모양을 안 바꾸게 한다.
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례,
// SVG `stroke`/`fill` 은 className 을 못 받는다).

const INK = '#222222';

type GlyphProps = {
  size?: number;
  testID?: string;
};

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
  return <SharedTrashGlyph size={size} color="primary" testID={testID} />;
}
