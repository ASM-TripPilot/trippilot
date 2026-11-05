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

// 문서(모서리 접힘 + 가로줄 2) — 기록 하단 바 「회고」 칸(Figma 4716:2946 `note`). TRIP-1584 에서 features/record 에서 이사 — 위젯이 features 를 못 문다.
export function NoteGlyph({ size = 20, color = 'muted', testID }: GlyphProps) {
  const stroke = {
    stroke: GLYPH_COLORS[color],
    strokeWidth: 1.66667 * (size / 20),
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
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

// 막대 그래프(27 격자, 세로 막대 3 + 바닥선) — 기록 하단 바 「요약」 칸(Figma 5053:3539 `barChart`). 두께 2.25 = 하단 바 다른 칸 아이콘과 같다.
export function SummaryChartGlyph({
  size = 27,
  color = 'muted',
  testID,
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 27 27"
      fill="none"
    >
      <Path
        d="M6.75 22.5V14.625M13.5 22.5V5.625M20.25 22.5V10.125M3.375 22.5H23.625"
        stroke={GLYPH_COLORS[color]}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 되돌리기 ↶(18 격자, 화살촉 + 반원 되돌이선) — 일정 편집 머리 「되돌리기」(Figma 5210:4522 `undo`). 선 굵기 1.65 는 시안 값.
export function UndoGlyph({ size = 18, color = 'ink', testID }: GlyphProps) {
  const stroke = {
    stroke: GLYPH_COLORS[color],
    strokeWidth: 1.65,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path d="M6.75 10.5L3 6.75L6.75 3" {...stroke} />
      <Path
        d="M3 6.75H10.875C11.4167 6.75 11.9531 6.8567 12.4536 7.064C12.954 7.2713 13.4088 7.57514 13.7918 7.95818C14.1749 8.34123 14.4787 8.79596 14.686 9.29643C14.8933 9.7969 15 10.3333 15 10.875C15 11.4167 14.8933 11.9531 14.686 12.4536C14.4787 12.954 14.1749 13.4088 13.7918 13.7918C13.4088 14.1749 12.954 14.4787 12.4536 14.686C11.9531 14.8933 11.4167 15 10.875 15H8.25"
        {...stroke}
      />
    </Svg>
  );
}

// ⋯ 더보기(20 격자, 채운 점 셋) — h06 카드 삭제 메뉴(Figma 4682:2624)와 편집기 카드 「다른 날로 옮기기」(TRIP-1793)가 같이 쓴다.
export function MoreDotsGlyph({
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
        d="M4.16667 11.25C4.85702 11.25 5.41667 10.6904 5.41667 10C5.41667 9.30964 4.85702 8.75 4.16667 8.75C3.47631 8.75 2.91667 9.30964 2.91667 10C2.91667 10.6904 3.47631 11.25 4.16667 11.25Z"
        fill={GLYPH_COLORS[color]}
      />
      <Path
        d="M10 11.25C10.6904 11.25 11.25 10.6904 11.25 10C11.25 9.30964 10.6904 8.75 10 8.75C9.30964 8.75 8.75 9.30964 8.75 10C8.75 10.6904 9.30964 11.25 10 11.25Z"
        fill={GLYPH_COLORS[color]}
      />
      <Path
        d="M15.8333 11.25C16.5237 11.25 17.0833 10.6904 17.0833 10C17.0833 9.30964 16.5237 8.75 15.8333 8.75C15.143 8.75 14.5833 9.30964 14.5833 10C14.5833 10.6904 15.143 11.25 15.8333 11.25Z"
        fill={GLYPH_COLORS[color]}
      />
    </Svg>
  );
}
