import Svg, { Path } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

export function BackChevronGlyph({
  size = 24,
  color = 'ink',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 18L9 12L15 6"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 뒤로 가기 — BackChevronGlyph 와 같은 도형이라 위임한다(testID 는 원래 안 받았다).
export function BackArrowGlyph({
  size = 24,
  color = 'ink',
  testID,
}: GlyphProps) {
  return <BackChevronGlyph size={size} color={color} testID={testID} />;
}

// 넓은 뒤로 꺾쇠(‹, 높이 14 · 획 2) — BackChevronGlyph(높이 12 · 획 2.2)와 그림이 다르다.
// 장소 상세(d06·i10)·탐색 앱바가 쓴다(TRIP-1829 에서 explore·execution 사본을 모음).
export function BackChevronWideGlyph({
  size = 24,
  color = 'ink',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 5L8 12L15 19"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 아래 쉐브론 — 소비처마다 stroke 굵기가 달라(1.83/2) strokeWidth 를 열어 둔다.
export function ChevronDownGlyph({
  size = 20,
  color = 'mutedSoft',
  strokeWidth = 1.83333,
  testID,
}: GlyphProps & { strokeWidth?: number }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M5 7.5L10 12.5L15 7.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightGlyph({
  size = 20,
  color = 'mutedSoft',
  strokeWidth = 1.83333,
  testID,
}: GlyphProps & { strokeWidth?: number }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M7.5 5L12.5 10L7.5 15"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 24-viewBox 오른쪽 쉐브론 — 20-viewBox 판(ChevronRightGlyph)과 도형이 달라 따로 둔다 (TRIP-1773).
export function ChevronRight24Glyph({
  size = 16,
  color = 'primaryText',
  strokeWidth = 2,
  testID,
}: GlyphProps & { strokeWidth?: number }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M9 6L15 12L9 18"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 16-viewBox 오른쪽 쉐브론(획 1.46667 고정).
export function ChevronRight16Glyph({
  size = 16,
  color = 'primaryText',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M6 4L10 8L6 12"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.46667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloseGlyph({
  size = 24,
  color = 'onPrimary',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function PlusGlyph({
  size = 18,
  color = 'ink',
  strokeWidth = 1.8,
  testID,
}: GlyphProps & { strokeWidth?: number }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 3.75V14.25"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M3.75 9H14.25"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function CheckGlyph({
  size = 12,
  color = 'primaryText',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M10 3L4.5 8.5L2 6"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 24-viewBox 체크(20 기본 크기) — 12-viewBox 판(CheckGlyph)과 도형이 달라 따로 둔다.
export function Check24Glyph({
  size = 20,
  color = 'onPrimary',
  strokeWidth = 2.2,
  testID,
}: GlyphProps & { strokeWidth?: number }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20 6L9 17L4 12"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
