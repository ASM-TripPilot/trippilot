import Svg, { Circle, Path } from 'react-native-svg';

/**
 * TRIP-395 · 여행 중(i01·i05·i08) 인라인 벡터 글리프 — i01 허브 레일 상태 점 3종(TRIP-746),
 * i10 원형 버튼·히어로(TRIP-755), i02 트리거 알약 경고삼각(TRIP-748)·비구름. (i01 "일정 수정" FAB 연필은 itinerary `PencilGlyph` tone=white 를 쓴다.)
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(`docs/structure.md` §지금 작업하려면,
 * `ItineraryGlyphs.tsx` 선례). 정확한 벡터 정합(굵기·곡률)은 6-b 실기 캘리브레이션 대상이다.
 */

const PRIMARY = '#FF385C';
const SUCCESS = '#0E9384';
// 비활성 회청(Figma #C2CCD6) — 토큰 없음, TripGlyphs `DISABLED` 선례와 같은 값.
const DISABLED = '#C2CCD6';
const WHITE = '#FFFFFF';
const INK = '#222222';
// 비구름 글리프 기본색(text-primary-text 토큰의 raw 값).
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

// i10 원형 버튼 뒤로가기(‹) — 화살표 없이 굵은 셰브론. 흰 원 위 먹색이 기본(TRIP-755).
export function BackArrowGlyph({ size = 24, color = INK }: TintGlyphProps) {
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

// i10 원형 버튼 공유 — 세 점 + 잇는 선. 흰 원 위 먹색이 기본(TRIP-755).
export function ShareGlyph({ size = 24, color = INK }: TintGlyphProps) {
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

// ── TRIP-748 · i02 지도 위 트리거 알약 leading ──
// 채운 빨강 삼각 + 흰 `!`(Figma 4184:2741 — `⚠` 텍스트를 SVG 로: iOS 가 U+26A0 을 노랑 컬러 이모지로
// 그릴 수 있어 색을 결정론으로 고정한다, Seed Q3). testID 는 Svg 호스트에 얹는다(존재 단언용).
export function WarningFilledGlyph({
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

// ── TRIP-561 · 트리거 아이콘(색 기본 = PRIMARY_TEXT) ──
// 다른 feature 에 동명 글리프가 있으나 features 간 직접 import 금지라 execution 로컬로 다시 그린다
// (미러, 재구현 아님 — 리포 *Glyphs.tsx 관례). 정확한 벡터 정합은 6-b 실기 캘리브레이션 대상이다.

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

// ── TRIP-755 · i10 히어로(사진 위 흰 글리프) ──
// 부제 앞 흰 핀(Figma 4159:2673). 형제 feature `MapPinGlyph`(explore on-primary)와 같은 도형이지만
// features 간 import 금지라 여기 다시 그린다 — 동명 복제(traps-glyphs)를 피하려 이름을 달리했다.
export function HeroPinGlyph({
  size = 14,
  testID,
}: GlyphProps & { testID?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
    >
      <Path
        d="M26.6667 13.3333C26.6667 21.3333 16 29.3333 16 29.3333C16 29.3333 5.33333 21.3333 5.33333 13.3333C5.33333 10.5044 6.45714 7.79125 8.45753 5.79086C10.4579 3.79047 13.171 2.66667 16 2.66667C18.829 2.66667 21.5421 3.79047 23.5425 5.79086C25.5429 7.79125 26.6667 10.5044 26.6667 13.3333Z"
        stroke={WHITE}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke={WHITE}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// "1 / N" 카운터 칩 앞 흰 사진 아이콘. entities `PhotoGlyph`(ink·disabled 톤뿐)와 같은 도형의 흰 판.
export function HeroPhotoGlyph({ size = 13 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M12.67 2.67H3.33C2.6 2.67 2 3.26 2 4V12C2 12.74 2.6 13.33 3.33 13.33H12.67C13.4 13.33 14 12.74 14 12V4C14 3.26 13.4 2.67 12.67 2.67Z"
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.67 7.07C6.26 7.07 6.73 6.59 6.73 6C6.73 5.41 6.26 4.93 5.67 4.93C5.08 4.93 4.6 5.41 4.6 6C4.6 6.59 5.08 7.07 5.67 7.07Z"
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 10.67L10.67 7.33L3.33 14"
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
