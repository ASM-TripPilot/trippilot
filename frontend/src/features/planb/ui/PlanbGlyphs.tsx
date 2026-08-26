import Svg, { Circle, Path } from 'react-native-svg';

/**
 * TRIP-440 · i12 재계획 로딩 체크리스트 상태 아이콘 3종(done/active/waiting) — 인라인 SVG.
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(리포 전체). execution `ExecutionGlyphs`의 레일
 * 점 3종과 같은 그림이지만 cross-feature import 금지라 복제다(재사용 아님). 정확한 벡터 정합은
 * 6-b 실기 캘리브레이션 대상이다.
 */

const PRIMARY = '#FF385C';
const MUTED_SOFT = '#9AA1AB';
const WHITE = '#FFFFFF';
const INK = '#222222';

type GlyphProps = { size?: number };

// 완료 = 핑크 채움 + 흰 체크.
export function ChecklistDoneGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={11} fill={PRIMARY} />
      <Path
        d="M7.5 12.5L10.5 15.5L16.5 8.5"
        stroke={WHITE}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 진행 중 = 핑크 타깃 원(테두리 + 가운데 점).
export function ChecklistActiveGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={10}
        fill={WHITE}
        stroke={PRIMARY}
        strokeWidth={2.4}
      />
      <Circle cx={12} cy={12} r={4.5} fill={PRIMARY} />
    </Svg>
  );
}

// 대기 = 회색 빈 원.
export function ChecklistWaitingGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={7}
        fill={WHITE}
        stroke={MUTED_SOFT}
        strokeWidth={2.4}
      />
    </Svg>
  );
}

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
