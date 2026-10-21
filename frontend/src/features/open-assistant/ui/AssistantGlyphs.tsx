import type { ReactElement } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { GLYPH_COLORS } from '@/shared/ui/glyphs';

/**
 * ✦ 도우미 글리프 — 네 갈래 별(Figma b 밴드 헤더 원 안 기호). SVG raw hex 는 `*Glyphs.tsx` 리포 관례.
 */
export function SparkleGlyph({
  size = 22,
  color = '#FFFFFF',
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5c.5 4.6 2.4 8 9.5 9.5-7.1 1.5-9 4.9-9.5 9.5-.5-4.6-2.4-8-9.5-9.5 7.1-1.5 9-4.9 9.5-9.5Z"
        fill={color}
      />
    </Svg>
  );
}

/**
 * 말풍선 + 점 셋 — 허브 하단 바 "챗봇" 칸 아이콘(TRIP-1522, Figma 챗봇 칸 · 킷 §6 미등록 조합). ✦ 는 AI 수정 항목과 헷갈려
 * 쓰지 않는다. 24 viewBox · stroke 2 를 27 로 그리면 2.25 라 탭 바 아이콘과 굵기가 같다. 색은 호출부가 정한다(활성/비활성).
 */
export function ChatBubbleGlyph({
  size = 27,
  color = GLYPH_COLORS.muted,
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7.9 20A9 9 0 1 0 4 16.1L2 22L7.9 20Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={8} cy={12} r={1.1} fill={color} />
      <Circle cx={12} cy={12} r={1.1} fill={color} />
      <Circle cx={16} cy={12} r={1.1} fill={color} />
    </Svg>
  );
}
