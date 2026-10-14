import Svg, { Path } from 'react-native-svg';

import { GLYPH_COLORS } from './colors';
import type { GlyphProps } from './types';

// 돋보기 — 소비처마다 stroke 굵기가 달라(1.67/1.8) strokeWidth 를 열어 둔다.
export function SearchGlyph({
  size = 20,
  color = 'ink',
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
        d="M9.16667 15C12.3883 15 15 12.3883 15 9.16667C15 5.94501 12.3883 3.33333 9.16667 3.33333C5.94501 3.33333 3.33333 5.94501 3.33333 9.16667C3.33333 12.3883 5.94501 15 9.16667 15Z"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17.5 17.5L13.75 13.75"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TrashGlyph({ size = 20, color = 'ink', testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M2.5 5H17.5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15.8333 5L15 16.6667C15 17.1087 14.8244 17.5326 14.5118 17.8452C14.1993 18.1577 13.7754 18.3333 13.3333 18.3333H6.66667C6.22464 18.3333 5.80072 18.1577 5.48816 17.8452C5.17559 17.5326 5 17.1087 5 16.6667L4.16667 5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.66667 5V3.33333C6.66667 2.89131 6.84226 2.46738 7.15482 2.15482C7.46738 1.84226 7.89131 1.66667 8.33333 1.66667H11.6667C12.1087 1.66667 12.5326 1.84226 12.8452 2.15482C13.1577 2.46738 13.3333 2.89131 13.3333 3.33333V5"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
