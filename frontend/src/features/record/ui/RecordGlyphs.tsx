import type { ReactElement } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * TRIP-565 · j01 방문 기록 인라인 아이콘(react-native-svg). path 는 Figma j01(1557:1738)
 * 실 에셋에서 옮겼다. `*Glyphs.tsx` raw hex 스캔 제외 관례(SVG stroke/fill 은 className 을 못
 * 받는다) — features 간 import 금지라 execution/auth 글리프를 재사용하지 않고 벡터만 옮겼다.
 *
 * ⚠️ 상태 체크서클의 **색은 심판 대상이 아니다**(repo-traps 글리프 함정 — jest 는 fill 을 못 본다).
 * 완료↔미완료 구분은 카드가 상태별로 **다른 testID** 를 렌더해 구조로 잠근다(VisitRecordCard).
 */

const CORAL = '#FF385C';
const INK = '#222222';
const CIRCLE_UPCOMING = '#C2C7CE';
const CIRCLE_SKIPPED = '#9AA1AB';

type GlyphProps = { size?: number };

/** 완료 체크서클 — coral 채운 원 + 흰 체크. */
export function VisitCheckDoneGlyph({ size = 22 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <Circle cx={11} cy={11} r={10.0833} fill={CORAL} />
      <Path
        d="M6.6 11.3667L9.53333 14.3L15.2167 8.25"
        stroke="white"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 미완료 계열 체크서클(빈 원) — 색만 다르다(진행 중=coral, 예정=회색, 건너뜀=muted). */
function CircleOutlineGlyph({
  size = 22,
  stroke,
}: GlyphProps & { stroke: string }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <Circle
        cx={11}
        cy={11}
        r={9.625}
        fill="white"
        stroke={stroke}
        strokeWidth={1.83333}
      />
    </Svg>
  );
}

/** 진행 중(도착·미완료) — coral 외곽선(탭하면 완료). */
export function VisitCheckActiveGlyph(props: GlyphProps): ReactElement {
  return <CircleOutlineGlyph {...props} stroke={CORAL} />;
}

/** 예정(도착 전) — 회색 빈 원. */
export function VisitCheckUpcomingGlyph(props: GlyphProps): ReactElement {
  return <CircleOutlineGlyph {...props} stroke={CIRCLE_UPCOMING} />;
}

/** 건너뜀 — muted 빈 원. */
export function VisitCheckSkippedGlyph(props: GlyphProps): ReactElement {
  return <CircleOutlineGlyph {...props} stroke={CIRCLE_SKIPPED} />;
}

/** ＋ (즉석 방문 추가·사진 추가 타일). */
export function PlusGlyph({
  size = 18,
  color = CORAL,
}: GlyphProps & { color?: string }): ReactElement {
  const s = size / 18;
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M9 3.75V14.25"
        stroke={color}
        strokeWidth={1.95 * s}
        strokeLinecap="round"
      />
      <Path
        d="M3.75 9H14.25"
        stroke={color}
        strokeWidth={1.95 * s}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** ‹ 뒤로가기. */
export function BackArrowGlyph({ size = 24 }: GlyphProps): ReactElement {
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

/** › 카드 우측 진입 chevron(지난 여행 카드). features 경계로 trip/itinerary 글리프 재사용 불가라 로컬 미러. */
export function ChevronRightGlyph({
  size = 20,
  color = CIRCLE_UPCOMING,
}: GlyphProps & { color?: string }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M7.5 5L12.5 10L7.5 15"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 📅 빈 상태 안내 아이콘(캘린더 아웃라인). StateNotice 아이콘 슬롯용. */
export function CalendarGlyph({ size = 32 }: GlyphProps): ReactElement {
  const s = size / 32;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M6 8.5C6 7.4 6.9 6.5 8 6.5H24C25.1 6.5 26 7.4 26 8.5V24C26 25.1 25.1 26 24 26H8C6.9 26 6 25.1 6 24V8.5Z"
        stroke={CORAL}
        strokeWidth={2 * s}
        strokeLinejoin="round"
      />
      <Path
        d="M6 12.5H26"
        stroke={CORAL}
        strokeWidth={2 * s}
        strokeLinecap="round"
      />
      <Path
        d="M11 4V9M21 4V9"
        stroke={CORAL}
        strokeWidth={2 * s}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** ♥ 저장 FAB. */
export function HeartGlyph({ size = 26 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      <Path
        d="M13 23.1292L11.4292 21.6992C5.85 16.64 2.16667 13.3033 2.16667 9.20833C2.16667 5.87167 4.78833 3.25 8.125 3.25C10.01 3.25 11.8192 4.1275 13 5.51417C14.1808 4.1275 15.99 3.25 17.875 3.25C21.2117 3.25 23.8333 5.87167 23.8333 9.20833C23.8333 13.3033 20.15 16.64 14.5708 21.71L13 23.1292Z"
        fill={CORAL}
      />
    </Svg>
  );
}
