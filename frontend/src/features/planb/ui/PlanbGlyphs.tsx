import Svg, { Circle, Path } from 'react-native-svg';

/**
 * TRIP-440 · i12 재계획 로딩 체크리스트 상태 아이콘 3종(done/active/waiting) — 인라인 SVG.
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다 — SVG `stroke`/`fill` 은 className 을 못 받고,
 * `*Glyphs.tsx` 는 raw-hex 스캔 가드 제외 관례다(리포 전체). execution `ExecutionGlyphs`의 레일
 * 점 3종과 같은 그림이지만 cross-feature import 금지라 복제다(재사용 아님). 정확한 벡터 정합은
 * 6-b 실기 캘리브레이션 대상이다.
 */

const PRIMARY = '#FF385C';
const MUTED_SOFT = '#9AA1AB';
const WHITE = '#FFFFFF';

type GlyphProps = { size?: number };

// 완료 = 핑크 채움 + 흰 체크.
export function ChecklistDoneGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={11} fill={PRIMARY} />
      <Path
        d="M7.5 12.5L10.5 15.5L16.5 8.5"
        stroke={WHITE}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 진행 중 = 핑크 타깃 원(테두리 + 가운데 점).
export function ChecklistActiveGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={10}
        fill={WHITE}
        stroke={PRIMARY}
        strokeWidth={2.4}
      />
      <Circle cx={12} cy={12} r={4.5} fill={PRIMARY} />
    </Svg>
  );
}

// 대기 = 회색 빈 원.
export function ChecklistWaitingGlyph({ size = 20 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={7}
        fill={WHITE}
        stroke={MUTED_SOFT}
        strokeWidth={2.4}
      />
    </Svg>
  );
}
