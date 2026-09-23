import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * planb 인라인 SVG 글리프. 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은
 * className 을 못 받고, `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(리포 전체).
 */

const PRIMARY = '#FF385C';
const WHITE = '#FFFFFF';
const INK = '#222222';
// 변경됨·고정·"다른 후보 N" 텍스트색(brand red-dark, brief §토큰 스냅 raw 값). SVG stroke 은
// className 을 못 받아 글리프 파일에서만 raw 로 고정한다(리포 *Glyphs raw-hex 면제 관례).
const PRIMARY_TEXT = '#C13515';

type GlyphProps = { size?: number };

/**
 * TRIP-441 · i19 반영 완료 화면 글리프 3종.
 *
 * `AppliedCheckGlyph` 는 **체크 표시만** 그린다(원 배경 없음) — 성공 원은 화면에서
 * `bg-primary rounded-pill` 토큰 View 로 그려 브랜드색을 토큰으로 유지하고, 여기서는
 * 흰 체크 획만 raw hex(글리프 파일 raw-hex 면제 관례)로 낸다.
 */

// i19 헤더 뒤로 — ink 색 back chevron(terms·nickname·location 의 것과 좌표 동일, 복제).
export function AppliedBackGlyph({ size = 24 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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

// i19 성공 원 안 흰 체크(획만 — 원 배경은 화면의 bg-primary 토큰이 그린다).
export function AppliedCheckGlyph({ size = 36 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 12.5L10.5 16.5L17.5 8"
        stroke={WHITE}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 확정 실패 안내 아이콘 — primary 경고 삼각형(StateNotice 의 primary-pale 원 안에 놓인다).
// ExploreGlyphs.WarningTriangleGlyph 과 같은 그림이지만 cross-feature import 금지라 복제다.
export function AppliedAlertGlyph({ size = 32 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M10 2.5L18.3333 16.6667H1.66667L10 2.5Z"
        stroke={PRIMARY}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 7.5V11.6667"
        stroke={PRIMARY}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 14.1667H10.0083"
        stroke={PRIMARY}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * TRIP-749 · i03 위험 상세 시트 eyebrow — 빨강 채운 삼각 + 흰 `!`. `⚠` 글자는 iOS 에서 노란 컬러
 * 이모지로 뜰 수 있어 SVG 로 그린다. execution `WarningFilledGlyph` 와 같은 벡터지만 cross-feature
 * import 금지라 복제다(정확한 벡터 정합은 6-b 실기 캘리브레이션 대상).
 */
export function RiskWarningGlyph({
  size = 12,
  testID,
}: GlyphProps & { testID?: string }) {
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M6 1.2L11.2 10.4H0.8L6 1.2Z"
        fill={PRIMARY}
        stroke={PRIMARY}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <Path
        d="M6 4.6V7.1"
        stroke={WHITE}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Circle cx={6} cy={8.8} r={0.7} fill={WHITE} />
    </Svg>
  );
}

/**
 * TRIP-563 · i13 재계획안 슬롯 행 글리프 2종.
 *
 * 색은 primary-text(#C13515) raw 고정 — "다른 후보 N" 텍스트·고정 pill 텍스트와 같은 잉크.
 * 체브론·자물쇠는 리포 곳곳에 유사 벡터가 있으나 features 간 import 금지라 planb 로컬 복제다
 * (`ItineraryGlyphs.ChevronRightGlyph`·`ItineraryGlyphs.LockGlyph` 계열과 동형 관례).
 */

// "다른 후보 N >" 우측 체브론.
export function ChevronRightGlyph({ size = 16 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6L15 12L9 18"
        stroke={PRIMARY_TEXT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 고정 pill 자물쇠(몸통 + 걸쇠).
export function LockGlyph({ size = 14 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={10.5}
        width={14}
        height={9.5}
        rx={2.2}
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
      />
      <Path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}
