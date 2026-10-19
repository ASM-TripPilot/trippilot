import type { ReactElement } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * 도우미 시트 전용 글리프(TRIP-1322) — SVG raw hex 는 `*Glyphs.tsx` 리포 관례(className 을 못 받는다).
 * 색: ink #222222 · primary #FF385C · primary-text #C13515 · info #0B6E63 · muted #6A6A6A.
 */

export function CloseGlyph({ size = 22 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 6l12 12M18 6L6 18"
        stroke="#222222"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SendArrowGlyph({ size = 20 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 19V5M5.5 11.5L12 5l6.5 6.5"
        stroke="#FFFFFF"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ChevronRightGlyph({
  size = 16,
  color = '#222222',
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 5l7 7-7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WarningGlyph({ size = 18 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5L2.5 20h19L12 3.5Z"
        stroke="#C13515"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M12 10v4.5M12 17.2v.3"
        stroke="#C13515"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function InfoGlyph({ size = 18 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke="#0B6E63" strokeWidth={1.8} />
      <Path
        d="M12 11v5.5M12 7.8v.2"
        stroke="#0B6E63"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function RetryGlyph({ size = 16 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CheckGlyph({ size = 18 }: { size?: number }): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="#FF385C"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * 답 평가 엄지(US-ASSIST-09) — 평소 muted 선, 고르면 ink 로 채운다. Figma 없음(사용자 결정: 엄지 둘로 먼저 그리고
 * Figma 를 나중에 맞춘다). `DOWN` 은 `UP` 을 위아래로 뒤집은 같은 그림이다.
 */
export function ThumbGlyph({
  rating,
  selected = false,
  size = 20,
}: {
  rating: 'UP' | 'DOWN';
  selected?: boolean;
  size?: number;
}): ReactElement {
  const color = selected ? '#222222' : '#6A6A6A';
  const fill = selected ? '#222222' : 'none';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={2.2}
        y={rating === 'DOWN' ? 4 : 10}
        width={2.6}
        height={10}
        rx={1}
        stroke={color}
        strokeWidth={1.7}
        fill={fill}
      />
      <Path
        d={
          rating === 'DOWN'
            ? 'M7.6 14l3.1 6.2a1.6 1.6 0 0 0 2.9-1.3L12.9 15H18a2 2 0 0 0 2-2.3l-1.2-7A2 2 0 0 0 16.8 4H7.6v10Z'
            : 'M7.6 10l3.1-6.2a1.6 1.6 0 0 1 2.9 1.3L12.9 9H18a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7.6V10Z'
        }
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill={fill}
      />
    </Svg>
  );
}
