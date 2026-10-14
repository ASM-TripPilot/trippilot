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

export function BackArrowGlyph({
  size = 24,
  color = 'ink',
  testID,
}: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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
        d="M7.5 5L12.5 10L7.5 15"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.83333}
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

export function PlusGlyph({ size = 18, color = 'ink', testID }: GlyphProps) {
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
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M3.75 9H14.25"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
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
