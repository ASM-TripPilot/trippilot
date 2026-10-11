import type { ReactElement } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

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
