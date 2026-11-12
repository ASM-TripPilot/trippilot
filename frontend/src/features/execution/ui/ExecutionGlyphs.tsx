import Svg, { Circle, Path } from 'react-native-svg';
import { COLOR_TOKENS } from '@/shared/config';

/**
 * TRIP-395 · 여행 중(i01·i05·i08) 인라인 벡터 글리프 — i01 허브 레일 상태 점 3종(TRIP-746),
 * i10 원형 버튼·히어로(TRIP-755), i02 트리거 알약 경고삼각(TRIP-748)·비구름. (i01 "일정 수정" FAB 연필은 itinerary `PencilGlyph` tone=white 를 쓴다.)
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(`docs/structure.md` §지금 작업하려면,
 * `ItineraryGlyphs.tsx` 선례). 정확한 벡터 정합(굵기·곡률)은 6-b 실기 캘리브레이션 대상이다.
 */

const PRIMARY = COLOR_TOKENS.primary;
const SUCCESS = COLOR_TOKENS.success;
// 비활성 회청(Figma #C2CCD6) — 토큰 없음, TripGlyphs `DISABLED` 선례와 같은 값.
// eslint-disable-next-line trippilot/no-raw-hex -- Figma raw fill(비활성), 토큰 없음
const DISABLED = '#C2CCD6';
const WHITE = COLOR_TOKENS.canvas;
const MUTED = COLOR_TOKENS.muted;
// 비구름 글리프 기본색(text-primary-text 토큰의 raw 값).
const PRIMARY_TEXT = COLOR_TOKENS['primary-text'];

type GlyphProps = { size?: number };
type TintGlyphProps = GlyphProps & { color?: string };

// TRIP-746 · i01 허브 레일 상태 점 3종(Figma 4125:3957 rail) — 크기가 상태마다 다르다(22·16·12 — 완료는 TRIP-1558 에서 18 → 22, TRIP-1592 에서 26).
// 완료=success 원 + 흰 테두리 + 흰 체크. TRIP-1592 — 체크가 원에서 차지하는 비율이 커 보인다는 사용자 지적: 원만 키우고 체크는 화면에서 그대로다.
// 체크는 22 크기일 때의 배율(22/18)을 그대로 쓰도록 도화지(viewBox)를 `DONE_VIEW` 로 넓히고, 체크 path 를 `DONE_PAD` 만큼 안쪽으로 옮겼다(원 반지름만 같은 만큼 늘어난다).
const DONE_UNIT = 22 / 18; // 22 크기에서 도화지 한 칸이 그리는 화면 픽셀 — 이 배율을 크기와 무관하게 지킨다.
const DONE_SIZE = 26;
const DONE_VIEW = DONE_SIZE / DONE_UNIT; // ≈ 21.27
const DONE_PAD = (DONE_VIEW - 18) / 2; // ≈ 1.64
export function RailDoneGlyph({ size = DONE_SIZE }: GlyphProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${DONE_VIEW} ${DONE_VIEW}`}
      fill="none"
    >
      <Circle
        cx={DONE_VIEW / 2}
        cy={DONE_VIEW / 2}
        r={8 + DONE_PAD}
        fill={SUCCESS}
        stroke={WHITE}
        strokeWidth={2}
      />
      <Path
        d="M12.67 6.25L7.63 11.29L5.33 9"
        transform={`translate(${DONE_PAD} ${DONE_PAD})`}
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

// TRIP-1522 · i01 하단 바 "행사" 칸 — 깃발(pennant, 킷 `flag`). 활성 primary / 비활성 muted 는 호출부가 `color` 로 고른다.
// 24 viewBox · stroke 2 를 27 로 그리면 2.25 가 되어 탭 바 아이콘과 굵기가 같다.
export function EventGlyph({ size = 27, color = MUTED }: TintGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 15C4 15 5 14 8 14C11 14 13 16 16 16C19 16 20 15 20 15V3C20 3 19 4 16 4C13 4 11 2 8 2C5 2 4 3 4 3V15Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4 22V15" stroke={color} strokeWidth={2} strokeLinecap="round" />
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
