import Svg, { Circle, Path } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

export function MapPinGlyph({
  size = 32,
  color = 'primary',
  testID,
}: GlyphProps) {
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
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SuitcaseGlyph({
  size = 26,
  color = 'primary',
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
        d="M5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18v-8A1.5 1.5 0 0 1 5 8.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M9 8.5V7a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 7v1.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path d="M12 8.5V21" stroke={GLYPH_COLORS[color]} strokeWidth={1.8} />
    </Svg>
  );
}

export function WalkGlyph({ size = 16, color = 'muted', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Circle cx={9} cy={3} r={1.5} fill={GLYPH_COLORS[color]} />
      <Path
        d="M9 5.5L8 9"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L6.5 13"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L10 11.5V13"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6.5L11 8"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CarGlyph({ size = 16, color = 'muted', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M2 11L3 7.5C3.13 7.2 3.42 7 3.75 7H12.25C12.58 7 12.87 7.2 13 7.5L14 11V12.5H2V11Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={5} cy={12.5} r={1} fill={GLYPH_COLORS[color]} />
      <Circle cx={11} cy={12.5} r={1} fill={GLYPH_COLORS[color]} />
    </Svg>
  );
}

// 맛집 — 포크+나이프.
export function ForkKnifeGlyph({
  size = 24,
  color = 'body',
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
        d="M7 2.5V10.5M9 2.5V10.5M5 2.5V8.5C5 9.6 5.9 10.5 7 10.5V21.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 2.5C15.3431 2.5 14 4.79086 14 7.5C14 9.98528 15.1193 12.0402 16.5714 12.4272L16 21.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 쇼핑 — 쇼핑백.
export function ShoppingBagGlyph({
  size = 24,
  color = 'body',
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
        d="M4.5 8.5H19.5L18.5 20.5H5.5L4.5 8.5Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8.5V6.5C8 4.29086 9.79086 2.5 12 2.5C14.2091 2.5 16 4.29086 16 6.5V8.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 대중교통(교환/순환 화살표) — 소비처마다 획 굵기가 달라(1.8/1.95) strokeWidth 를 열어 둔다.
export function TransitGlyph({
  size = 24,
  color = 'body',
  strokeWidth = 1.8,
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
        d="M4 9.5L4 15.5C4 16.6 4.9 17.5 6 17.5H16.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 14.5L17 17.5L14 20.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 14.5L20 8.5C20 7.4 19.1 6.5 18 6.5L7.5 6.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 3.5L7 6.5L10 9.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
