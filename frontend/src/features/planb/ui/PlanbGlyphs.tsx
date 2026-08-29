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
// i09 감시 행 아이콘 기본색(text-muted 토큰 raw 값, brief §토큰 스냅) — 화면이 활성 행엔 primary-text 로 덮는다.
const MUTED = '#6A6A6A';

type GlyphProps = { size?: number };
type TintGlyphProps = GlyphProps & { color?: string };

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

/**
 * TRIP-562 · i09 감시 3항목 kind 아이콘(날씨·이동 지연·영업·휴무). execution 에 동명 글리프
 * (`WeatherCloudGlyph`·`ClockGlyph`)가 있으나 cross-feature import 금지라 벡터만 옮겨 planb 로컬로
 * 미러 신설한다(재구현 아님, 상점은 리포에 없어 새 근사 벡터). 색 기본 = MUTED(정상 행), 화면이 활성
 * 행엔 color 로 덮는다. 정확한 벡터 정합은 6-b 실기 캘리브레이션 대상이다.
 */

// WEATHER — 비구름(execution WeatherCloudGlyph 미러).
export function WeatherCloudGlyph({
  size = 22,
  color = MUTED,
}: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7.5 16.5A3.5 3.5 0 0 1 7.1 9.54 5 5 0 0 1 16.9 8.6 3.2 3.2 0 0 1 17 16.5H7.5Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M8.5 18.5L7.5 20.5M12.5 18.5L11.5 20.5M16.5 18.5L15.5 20.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// DELAY — 시계(execution ClockGlyph 미러).
export function ClockGlyph({ size = 22, color = MUTED }: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M12 7.5V12L15.5 14"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// CLOSURE — 상점(차양+간판, 새 근사 벡터).
export function ShopGlyph({ size = 22, color = MUTED }: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5V19.5H20V10.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 5.5H20.5L21.5 10.5H2.5L3.5 5.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M9.5 19.5V14.5H14.5V19.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
