import type { ReactElement } from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

/**
 * TRIP-571 · j03 오늘의 회고 인라인 아이콘(react-native-svg). `*Glyphs.tsx` raw-hex 스캔 제외 관례
 * (SVG stroke/fill 은 className 을 못 받는다).
 *
 * ★ `LocationOffGlyph` 는 `shared/location/LocationGlyphs.tsx` 에도 있으나 features 간 import 금지라
 * 그대로 못 쓴다 — `RecordGlyphs` 선례대로 벡터만 feature-local 로 미러한다(색·크기는 이 화면 톤).
 * fill 색은 심판 대상이 아니다(repo-traps 글리프 함정 — jest 는 fill 을 못 본다). 얼굴 분기는 색이 아니라
 * 서로 다른 testID·조건부 렌더로 잠근다.
 */

const MUTED = '#9AA1AB';
const INK = '#222222';
const CORAL = '#FF385C';

type GlyphProps = { size?: number; color?: string };

/** ‹ 뒤로가기(헤더). */
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

/** 위치 기록 없음 — 핀 위 사선(data-insufficient 지도 자리). */
export function LocationOffGlyph({
  size = 30,
  color = MUTED,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <Path
        d="M15 3.75C10.86 3.75 7.5 7.11 7.5 11.25C7.5 16.875 15 25 15 25C15 25 22.5 16.875 22.5 11.25C22.5 7.11 19.14 3.75 15 3.75Z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
      <Circle cx={15} cy={11.25} r={2.5} stroke={color} strokeWidth={1.9} />
      <Line
        x1={5}
        y1={4.5}
        x2={25}
        y2={25.5}
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 사진 없음 — 액자 위 사선(data-insufficient 사진 그리드 자리). */
export function PhotoOffGlyph({
  size = 26,
  color = MUTED,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      <Path
        d="M4 6H22V20H4V6Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={11} r={1.6} fill={color} />
      <Path
        d="M6 18L11 13L15 16.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={4}
        y1={5}
        x2={22}
        y2={21}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 빈 원 일러스트(empty 얼굴 — 기록 없음). */
export function EmptyCircleGlyph({ size = 72 }: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" fill="none">
      <Circle cx={36} cy={36} r={34} stroke={MUTED} strokeWidth={1.6} />
    </Svg>
  );
}

/** ↻ 다시 시도(error 카드). */
export function RetryGlyph({
  size = 20,
  color = CORAL,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M16 6.5C14.9 4.4 12.6 3 10 3C6.1 3 3 6.1 3 10C3 13.9 6.1 17 10 17C13.2 17 15.9 14.8 16.7 11.9"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M16.5 3.5V7H13"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * TRIP-762 · 기분 3택 글리프(아쉬워요 / 괜찮았어요 / 좋았어요) — 날씨 은유(흐림 → 반쯤 갬 → 맑음).
 * 선택 시 코랄 원 배경 위 흰색, 미선택 시 회색 원 위 회색 — 색(raw hex)은 이 `*Glyphs.tsx` 안에만
 * 둔다(raw-hex 스캔 제외 관례). fill 은 심판 대상이 아니고(글리프 함정), 선택은 화면 Pressable 의
 * `accessibilityState.selected` 로 잠근다.
 */

const WHITE = '#FFFFFF';
type MoodGlyphProps = { size?: number; selected?: boolean };

/** 아쉬워요 — 흐린 구름. */
export function MoodSadGlyph({
  size = 26,
  selected = false,
}: MoodGlyphProps): ReactElement {
  const color = selected ? WHITE : MUTED;
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Path
        d="M8.5 20.5H18.5C21 20.5 23 18.5 23 16C23 13.6 21.1 11.6 18.7 11.5C18 8.6 15.4 6.5 12.3 6.5C8.7 6.5 5.8 9.4 5.8 13C5.8 13.3 5.8 13.6 5.9 13.9C4.2 14.6 3 16.2 3 18.1C3 19.5 4.1 20.5 5.5 20.5H8.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 괜찮았어요 — 해가 구름 뒤로 반쯤. */
export function MoodSosoGlyph({
  size = 26,
  selected = false,
}: MoodGlyphProps): ReactElement {
  const color = selected ? WHITE : MUTED;
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Circle cx={10.5} cy={10} r={4} stroke={color} strokeWidth={1.6} />
      <Path
        d="M10.5 2.5V4M4 10H2.5M5.4 4.9L4.4 3.9M15.6 4.9L16.6 3.9"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path
        d="M11 22.5H19.5C21.4 22.5 23 20.9 23 19C23 17.2 21.6 15.7 19.8 15.5C19.3 13.3 17.4 11.7 15 11.7C12.6 11.7 10.6 13.4 10.2 15.6C8.6 15.9 7.5 17.3 7.5 19C7.5 20.9 9 22.5 11 22.5Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 좋았어요 — 맑은 해. */
export function MoodGoodGlyph({
  size = 26,
  selected = false,
}: MoodGlyphProps): ReactElement {
  const color = selected ? WHITE : MUTED;
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <Circle cx={14} cy={14} r={5} stroke={color} strokeWidth={1.9} />
      <Path
        d="M14 3.5V6M14 22V24.5M3.5 14H6M22 14H24.5M6.6 6.6L8.4 8.4M19.6 19.6L21.4 21.4M21.4 6.6L19.6 8.4M8.4 19.6L6.6 21.4"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}
