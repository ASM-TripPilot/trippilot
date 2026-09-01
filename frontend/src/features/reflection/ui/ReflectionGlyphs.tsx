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

/** ⤴ 공유(j03 헤더, TRIP-574) — 종료·요약된 여행에서만 활성(코랄), 아니면 muted. */
export function ShareGlyph({
  size = 22,
  muted = false,
}: {
  size?: number;
  muted?: boolean;
}): ReactElement {
  const color = muted ? MUTED : CORAL;
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <Circle cx={6} cy={11} r={2.4} stroke={color} strokeWidth={1.9} />
      <Circle cx={16} cy={5.5} r={2.4} stroke={color} strokeWidth={1.9} />
      <Circle cx={16} cy={16.5} r={2.4} stroke={color} strokeWidth={1.9} />
      <Path
        d="M8.1 9.9L13.9 6.6M8.1 12.1L13.9 15.4"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}
