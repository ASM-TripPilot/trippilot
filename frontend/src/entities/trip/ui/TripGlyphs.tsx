import Svg, { Circle, Path } from 'react-native-svg';
import { COLOR_TOKENS } from '@/shared/config';

// TRIP-808 · entities/trip 카드 전용 인라인 벡터 글리프. features/itinerary/ui/ItineraryGlyphs 는
// entities → features 역참조라 import 할 수 없어(층 위반) chevron 을 여기 자기 사본으로 둔다
// (리포 글리프 로컬 복제 관례). ChevronRightGlyph 는 ItineraryGlyphs 판을 viewBox·path·색·획 두께까지
// 그대로 옮긴 것 — h06 resume CTA 의 chevron 이 이관으로 모양을 안 바꾸게 한다.
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례,
// SVG `stroke`/`fill` 은 className 을 못 받는다).

const INK = COLOR_TOKENS.ink;

type GlyphProps = {
  size?: number;
  testID?: string;
};

// TRIP-1786 · 카드 ⋯ 메뉴 「여행 설정」 톱니(stroke 24 격자, feather settings 계열) — 공용 글리프에 톱니가 없어 여기 로컬로 둔다.
export function TripGearGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle
        cx={12}
        cy={12}
        r={3}
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// TRIP-1786 · 압정 — 「맨 위에 고정」 항목과 고정 표식(「고정」 알약 12px) 공용. Figma `icon · pushpin` 에셋은 못 받아 선 하나짜리로 그렸다(6-b 육안 확인).
export function PushpinGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 17v5"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
