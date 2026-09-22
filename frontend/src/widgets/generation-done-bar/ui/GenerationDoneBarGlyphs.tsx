import Svg, { Path } from 'react-native-svg';

// GenerationDoneBar 전용 인라인 SVG 글리프. widgets→`@/features` import 금지라 `ItineraryGlyphs` 의
// 체크를 못 가져다 쓴다(MapSheetGlyphs 로컬 복제 선례). 색은 이 파일에서만 raw hex 로 고정한다 —
// SVG `stroke` 는 className 을 못 받고, `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다.

const SUCCESS = '#0E9384';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 완료 도킹 배너 체크(20) — Figma 3911:2327 노드 4466:1789. 원 없는 체크만(success 색, 굵은 획).
export function DoneCheckGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M16.6667 5L7.5 14.1667L3.33333 10"
        stroke={SUCCESS}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
