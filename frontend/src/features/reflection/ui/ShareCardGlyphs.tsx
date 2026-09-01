import type { ReactElement } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * TRIP-574 · j06 공유 카드 인라인 아이콘(react-native-svg). `*Glyphs.tsx` raw-hex 스캔 제외 관례
 * (SVG stroke/fill 은 className 을 못 받는다). 카드 코랄·워터마크는 브랜드색(의도적 raw, 토큰화 금지).
 */

const INK = '#222222';
const WHITE = '#FFFFFF';
const CORAL = '#FF385C';

type GlyphProps = { size?: number; color?: string };

/** ↓ 이미지 저장(다운로드) — 하단 버튼. */
export function DownloadGlyph({
  size = 18,
  color = INK,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M9 2.5V11M9 11L5.5 7.5M9 11L12.5 7.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 12.5V14.5H14.5V12.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** ⤴ 공유하기(연결된 세 점) — 하단 버튼(코랄 배경 위 흰색). */
export function ShareGlyph({
  size = 18,
  color = WHITE,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={4.5} cy={9} r={2} stroke={color} strokeWidth={1.6} />
      <Circle cx={13} cy={4.5} r={2} stroke={color} strokeWidth={1.6} />
      <Circle cx={13} cy={13.5} r={2} stroke={color} strokeWidth={1.6} />
      <Path
        d="M6.3 8L11.2 5.4M6.3 10L11.2 12.6"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 워터마크 — 코랄 라운드 아이콘 + 흰 물방울 마커(TripPilot 로고 대체 벡터). */
export function WatermarkLogoGlyph({
  size = 22,
  color = CORAL,
}: GlyphProps): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <Rect x={1} y={1} width={20} height={20} rx={6} fill={color} />
      <Path
        d="M11 5.5C8.5 5.5 6.8 7.3 6.8 9.5C6.8 12.4 11 16.5 11 16.5C11 16.5 15.2 12.4 15.2 9.5C15.2 7.3 13.5 5.5 11 5.5Z"
        fill={WHITE}
      />
      <Circle cx={11} cy={9.4} r={1.6} fill={color} />
    </Svg>
  );
}
