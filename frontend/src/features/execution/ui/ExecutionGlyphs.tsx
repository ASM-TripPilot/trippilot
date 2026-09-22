import Svg, { Circle, Path } from 'react-native-svg';

/**
 * TRIP-395 · 여행 중(i01·i05·i08) 인라인 벡터 글리프 — i01 허브 레일 상태 점 3종(TRIP-746),
 * i05 헤더, i08 칩·배너 아이콘. (i01 "일정 수정" FAB 연필은 itinerary `PencilGlyph` tone=white 를 쓴다.)
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(`docs/structure.md` §지금 작업하려면,
 * `ItineraryGlyphs.tsx` 선례). 정확한 벡터 정합(굵기·곡률)은 6-b 실기 캘리브레이션 대상이다.
 */

const PRIMARY = '#FF385C';
const SUCCESS = '#0E9384';
// 비활성 회청(Figma #C2CCD6) — 토큰 없음, TripGlyphs `DISABLED` 선례와 같은 값.
const DISABLED = '#C2CCD6';
const MUTED_SOFT = '#9AA1AB';
const WHITE = '#FFFFFF';
// i08 칩·i01 배너 표면의 글자·아이콘 색(text-primary-text 토큰의 raw 값, brief §4).
const PRIMARY_TEXT = '#C13515';

type GlyphProps = { size?: number };
type TintGlyphProps = GlyphProps & { color?: string };

// TRIP-746 · i01 허브 레일 상태 점 3종(Figma 4125:3957 rail) — 크기가 상태마다 다르다(18·16·12).
// 완료=success 원 + 흰 테두리 + 흰 체크.
export function RailDoneGlyph({ size = 18 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle
        cx={9}
        cy={9}
        r={8}
        fill={SUCCESS}
        stroke={WHITE}
        strokeWidth={2}
      />
      <Path
        d="M12.67 6.25L7.63 11.29L5.33 9"
        stroke={WHITE}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 진행 중=흰 원 + primary 테두리 + 가운데 6px primary 점.
export function RailActiveGlyph({ size = 16 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle
        cx={8}
        cy={8}
        r={6.75}
        fill={WHITE}
        stroke={PRIMARY}
        strokeWidth={2.5}
      />
      <Circle cx={8} cy={8} r={3} fill={PRIMARY} />
    </Svg>
  );
}

// 예정=흰 원 + 비활성 회청 테두리.
export function RailUpcomingGlyph({ size = 12 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Circle
        cx={6}
        cy={6}
        r={5}
        fill={WHITE}
        stroke={DISABLED}
        strokeWidth={2}
      />
    </Svg>
  );
}

// i05 헤더 뒤로가기(‹) — 화살표 없이 굵은 셰브론.
export function BackArrowGlyph({
  size = 24,
  color = MUTED_SOFT,
}: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5L8 12L15 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// i05 헤더 공유 — 세 점 + 잇는 선.
export function ShareGlyph({ size = 24, color = MUTED_SOFT }: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={18} cy={5} r={2.4} stroke={color} strokeWidth={1.8} />
      <Circle cx={6} cy={12} r={2.4} stroke={color} strokeWidth={1.8} />
      <Circle cx={18} cy={19} r={2.4} stroke={color} strokeWidth={1.8} />
      <Path
        d="M8.1 10.9L15.9 6.1M8.1 13.1L15.9 17.9"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ── TRIP-561 · i08 트리거 칩 · i01 변수감지 배너 4종(색 기본 = PRIMARY_TEXT) ──
// 다른 feature(auth·explore·stay 등)에 동명 글리프가 있으나 features 간 직접 import 금지라
// execution 로컬로 다시 그린다(미러, 재구현 아님 — 리포 *Glyphs.tsx 관례). 정확한 벡터 정합은
// 6-b 실기 캘리브레이션 대상이다.

// i01 배너 공통 leading · i08 칩 DELAY/CLOSURE 폴백 — 경고삼각형(ExploreGlyphs 미러).
export function WarningTriangleGlyph({
  size = 13,
  color = PRIMARY_TEXT,
}: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M10 2.5L18.3333 16.6667H1.66667L10 2.5Z"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 7.5V11.6667"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 14.1667H10.0083"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// i08 칩 WEATHER leading — 비구름(Figma 1793:2480 근사).
export function WeatherCloudGlyph({
  size = 24,
  color = PRIMARY_TEXT,
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

// i08 칩 chevron(대안 보기 지시) — BackArrowGlyph(‹) 반전.
export function ChevronRightGlyph({
  size = 22,
  color = PRIMARY_TEXT,
}: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5L16 12L9 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// i08 칩 dismiss(×) — ExploreGlyphs CloseGlyph 미러.
export function CloseGlyph({
  size = 18,
  color = PRIMARY_TEXT,
}: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
