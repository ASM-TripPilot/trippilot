import Svg, { Circle, Path } from 'react-native-svg';

// CoPickStepper 전용 인라인 SVG 글리프. widgets→`@/features` import 금지라 `ItineraryGlyphs` 의
// 마커를 못 가져다 쓴다(MapSheetGlyphs·GenerationDoneBarGlyphs 로컬 복제 선례). 색은 이 파일에서만
// raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고 `*Glyphs.tsx` 는 raw-hex 스캔
// 제외 관례다(그래서 `widgetsStructure` F 가 이 파일은 안 훑는다).

const SUCCESS = '#0E9384'; // 완료 체크 배지 초록.
const WHITE = '#FFFFFF'; // 현재 단(빨강 원) 위 마커.
const MUTED = '#9AA1AB'; // 이전·다음 단(회색 원) 위 마커.

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 스텝 원 안 마커(해 · sun). 현재 단은 흰색(빨강 원 위), 이전·다음은 muted(회색 원 위).
// 카테고리 아이콘이 아니라 상태 마커라 로컬 글리프로 둔다(D4 · iconKey 미주입 기본 글리프).
export function StepperSunGlyph({
  size = 18,
  testID,
  tone = 'muted',
}: GlyphProps & { tone?: 'white' | 'muted' }) {
  const stroke = tone === 'white' ? WHITE : MUTED;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={4} stroke={stroke} strokeWidth={1.8} />
      <Path
        d="M12 2.5V4.5M12 19.5V21.5M4.5 12H2.5M21.5 12H19.5M6.5 6.5L5 5M19 19L17.5 17.5M17.5 6.5L19 5M5 19L6.5 17.5"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 이전 단 원 우하단 완료 배지 — 초록 원 + 흰 체크. "고름"(이미 고른 슬롯)을 표시한다.
export function StepperCheckBadge({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Circle cx={7} cy={7} r={7} fill={SUCCESS} />
      <Path
        d="M4 7.2L6.2 9.4L10 5"
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
