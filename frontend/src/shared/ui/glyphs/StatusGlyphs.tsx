import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

// 경고 원(느낌표) — 소비처마다 stroke 굵기가 달라(1.67/1.83) strokeWidth 를 열어 둔다.
export function AlertCircleGlyph({
  size = 20,
  color = 'primaryText',
  strokeWidth = 1.66667,
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
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 6.66667V10.8333"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 13.75H10.0083"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WarningTriangleGlyph({
  size = 20,
  color = 'ink',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 2.5L18.3333 16.6667H1.66667L10 2.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 7.5V11.6667"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 14.1667H10.0083"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function InfoCircleGlyph({
  size = 20,
  color = 'muted',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 9.16667V13.3333"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 6.66667H10.0083"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function LockGlyph({
  size = 14,
  color = 'primaryText',
  testID,
}: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={10.5}
        width={14}
        height={9.5}
        rx={2.2}
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
      />
      <Path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ClockGlyph({ size = 20, color = 'body', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 5.83333V10L12.5 11.6667"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function FullAiGlyph({ size = 24, color = 'body', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 2L13.8 10.2L22 12L13.8 13.8L12 22L10.2 13.8L2 12L10.2 10.2L12 2Z"
        fill={GLYPH_COLORS[color]}
      />
    </Svg>
  );
}

// 채움 경고 삼각(12) — 삼각은 primary 채움·획, 느낌표는 onPrimary 고정이라 색 prop 이 없다 (TRIP-1773).
export function WarningFilledGlyph({
  size = 12,
  testID,
}: Pick<GlyphProps, 'size' | 'testID'>) {
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M6 1.2L11.2 10.4H0.8L6 1.2Z"
        fill={GLYPH_COLORS.primary}
        stroke={GLYPH_COLORS.primary}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <Path
        d="M6 4.6V7.1"
        stroke={GLYPH_COLORS.onPrimary}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <Circle cx={6} cy={8.8} r={0.7} fill={GLYPH_COLORS.onPrimary} />
    </Svg>
  );
}

// 정보 원(16-viewBox) — InfoCircleGlyph(20)와 도형·획이 달라 따로 둔다.
export function InfoGlyph({ size = 15, color = 'muted', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 7.3V11M8 5H8.008"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 정보 원(18-viewBox).
export function InfoCircle18Glyph({
  size = 18,
  color = 'muted',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 15.75C12.7279 15.75 15.75 12.7279 15.75 9C15.75 5.27208 12.7279 2.25 9 2.25C5.27208 2.25 2.25 5.27208 2.25 9C2.25 12.7279 5.27208 15.75 9 15.75Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 8.25V12"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6H9.0075"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 경고 삼각(24-viewBox) — WarningTriangleGlyph(20)와 도형이 달라 따로 둔다.
export function WarningTriangle24Glyph({
  size = 20,
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
        d="M12 3.5 22 20H2L12 3.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 10V14"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 17H12.01"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
