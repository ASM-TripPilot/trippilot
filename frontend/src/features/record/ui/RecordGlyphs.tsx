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
const MUTED_SOFT = '#9AA1AB';
const MUTED = '#6A6A6A';

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

/** 문서(모서리 접힘 + 가로줄 2) — j01 「오늘의 회고」 FAB(Figma 4716:2946 `note`). 코랄 위라 기본 흰색. */
export function NoteGlyph({
  size = 20,
  color = 'white',
}: GlyphProps & { color?: string }): ReactElement {
  const stroke = {
    stroke: color,
    strokeWidth: 1.66667 * (size / 20),
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M11.6667 2.5H5.83333C5.39131 2.5 4.96738 2.67559 4.65482 2.98816C4.34226 3.30072 4.16667 3.72464 4.16667 4.16667V15.8333C4.16667 16.2754 4.34226 16.6993 4.65482 17.0118C4.96738 17.3244 5.39131 17.5 5.83333 17.5H14.1667C14.6087 17.5 15.0326 17.3244 15.3452 17.0118C15.6577 16.6993 15.8333 16.2754 15.8333 15.8333V6.66667L11.6667 2.5Z"
        {...stroke}
      />
      <Path d="M11.6667 2.5V6.66667H15.8333" {...stroke} />
      <Path d="M7.5 10.8333H12.5" {...stroke} />
      <Path d="M7.5 14.1667H10.8333" {...stroke} />
    </Svg>
  );
}

/**
 * ⚠ 업로드 실패 셀 아이콘(경고 삼각 + 느낌표) — muted-soft.
 * TRIP-760 · 색·정확한 벡터는 jest 사각(6-b 육안, Figma 1561:1790).
 */
export function WarningTriangleGlyph({ size = 18 }: GlyphProps): ReactElement {
  const s = size / 18;
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M9 2.25L16.5 15.25H1.5L9 2.25Z"
        stroke={MUTED_SOFT}
        strokeWidth={1.5 * s}
        strokeLinejoin="round"
      />
      <Path
        d="M9 7V10.25"
        stroke={MUTED_SOFT}
        strokeWidth={1.5 * s}
        strokeLinecap="round"
      />
      <Path
        d="M9 12.75V12.76"
        stroke={MUTED_SOFT}
        strokeWidth={1.6 * s}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * ↻ 업로드 다시 시도 아이콘(원형 화살표) — primary(coral).
 * TRIP-760 · 색·정확한 벡터는 jest 사각(6-b 육안, Figma 1561:1790).
 */
export function RetryGlyph({
  size = 16,
  color = CORAL,
}: GlyphProps & { color?: string }): ReactElement {
  const s = size / 16;
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M13 8C13 10.7614 10.7614 13 8 13C5.23858 13 3 10.7614 3 8C3 5.23858 5.23858 3 8 3C9.79 3 11.36 3.94 12.24 5.35"
        stroke={color}
        strokeWidth={1.5 * s}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.5 2.5V5.5H9.5"
        stroke={color}
        strokeWidth={1.5 * s}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** ‹ 뒤로가기. `color` 미지정이면 INK(하위호환 — 앱바 뒤로가기 소비처가 안 깨진다); 월 캘린더 chevron 은
 *  회색을 넘겨 얇은 회색으로 그린다. stroke 색은 className 을 못 받아 prop 으로 받는다(글리프 함정). */
export function BackArrowGlyph({
  size = 24,
  color = INK,
}: GlyphProps & { color?: string }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 18L9 12L15 6"
        stroke={color}
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

/**
 * › legend 줄 끝 chevron(TRIP-1120) — 누르면 이동하는 줄에만 붙는다. Figma 4761:3104: 14 슬롯 안에 24 박스
 * 벡터(stroke 2)가 1:1 로 넘쳐 그려진다 → viewBox 를 가운데 14 로 잘라 같은 크기·굵기를 슬롯 안에 담는다.
 */
export function LegendChevronGlyph({ size = 14 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="5 5 14 14" fill="none">
      <Path
        d="M9 6L15 12L9 18"
        stroke={MUTED_SOFT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * ⌄ legend '더 보기' chevron(TRIP-1084). Figma 4699:2914 Icon — 16 박스 가운데 9.6 벡터(stroke 0.8)를
 * 16 좌표로 3.2 평행이동했다. '접기'는 호출부가 180° 돌린다(Figma Icon 세트에 up 이 없다).
 */
export function ChevronDownGlyph({
  size = 16,
  color = MUTED,
}: GlyphProps & { color?: string }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M5.6 6.8L8 9.2L10.4 6.8"
        stroke={color}
        strokeWidth={0.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * ⓘ 안내 아이콘(원 + i) — TRIP-761 · GPS 미동의 배너 좌측. muted.
 * 색·정확한 벡터는 jest 사각(글리프 함정, 6-b 육안, Figma 1562:1949).
 */
export function InfoCircleGlyph({ size = 20 }: GlyphProps): ReactElement {
  const s = size / 20;
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Circle cx={10} cy={10} r={8.25} stroke={MUTED} strokeWidth={1.5 * s} />
      <Path
        d="M10 9.2V13.6"
        stroke={MUTED}
        strokeWidth={1.6 * s}
        strokeLinecap="round"
      />
      <Path
        d="M10 6.4V6.41"
        stroke={MUTED}
        strokeWidth={1.8 * s}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * ⊘ GPS 꺼짐 아이콘(크로스헤어 + 사선) — TRIP-761 · 지도 좌상단 배지. muted.
 * 색·정확한 벡터는 jest 사각(글리프 함정, 6-b 육안, Figma 1562:1957).
 */
export function GpsOffGlyph({ size = 15 }: GlyphProps): ReactElement {
  const s = size / 15;
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Circle cx={7.5} cy={7.5} r={3.3} stroke={MUTED} strokeWidth={1.3 * s} />
      <Path
        d="M7.5 1.4V3.1M7.5 11.9V13.6M1.4 7.5H3.1M11.9 7.5H13.6"
        stroke={MUTED}
        strokeWidth={1.3 * s}
        strokeLinecap="round"
      />
      <Path
        d="M2.3 2.3L12.7 12.7"
        stroke={MUTED}
        strokeWidth={1.4 * s}
        strokeLinecap="round"
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

/** 🔖 기록 탭 아이콘과 같은 북마크 외곽선(j07 지난 여행 빈 상태 · Figma 4821:2887). 색은 muted-soft. */
export function BookmarkGlyph({ size = 24 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3H18C18.2652 3 18.5196 3.10536 18.7071 3.29289C18.8946 3.48043 19 3.73478 19 4V21L12 17L5 21V4C5 3.73478 5.10536 3.48043 5.29289 3.29289C5.48043 3.10536 5.73478 3 6 3Z"
        stroke={MUTED_SOFT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** ✕ 닫기 — i01 허브 메모 시트 머리(Figma 4741:2993 · Icon close 1237:1058). ink 선이라 home·explore
 *  ✕(흰·on-primary)를 못 쓰고, features 경계로 가져올 수도 없어 벡터만 옮겼다. */
export function CloseGlyph({ size = 24 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6L18 18" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <Path d="M18 6L6 18" stroke={INK} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
