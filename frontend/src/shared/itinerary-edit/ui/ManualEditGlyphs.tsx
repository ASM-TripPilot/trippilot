import Svg, { Path, Polyline, Rect } from 'react-native-svg';

/**
 * TRIP-443 · 공용 편집 셸(i15·i22) 인라인 SVG 글리프 — 뒤로·되돌리기·경고삼각형·자물쇠·휴지통·플러스.
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(리포 전체). features 글리프와 그림이 겹쳐도
 * cross-feature/layer import 금지라 복제다(재사용 아님). 값은 tailwind 토큰 색과 손으로 맞춘다.
 */

const INK = '#222222';
const MUTED = '#6A6A6A';
const PRIMARY_TEXT = '#C13515';

type GlyphProps = { size?: number };

export function BackChevronGlyph({ size = 24 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="15 5 8 12 15 19"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 되돌리기(반시계 화살) — i15 hint 줄.
export function UndoGlyph({ size = 16 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8H14C17.3 8 20 10.7 20 14C20 17.3 17.3 20 14 20H7"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="8 4 4 8 8 12"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 경고삼각형 — i22 누락 배너.
export function WarningTriangleGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3L22 20H2L12 3Z"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M12 10V14"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M12 16.8V17"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 자물쇠 — 잠금 슬롯(숙소 체크인·완료).
export function LockGlyph({ size = 16 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={10}
        width={14}
        height={10}
        rx={2}
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
      />
      <Path
        d="M8 10V7C8 4.8 9.8 3 12 3C14.2 3 16 4.8 16 7V10"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 휴지통 — 비잠금 슬롯 삭제.
export function TrashGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6H20"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M9 6V4H15V6"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M6 6L7 20H17L18 6"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlusGlyph({ size = 18 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5V19M5 12H19"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
