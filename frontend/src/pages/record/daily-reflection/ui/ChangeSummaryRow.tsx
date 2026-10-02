import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-571 · 변경 요약 행. testID `reflection-daily-change-summary`.
 *
 * 무엇을 보장하나: "이날 휴무로 1곳을 변경했어요" 같은 이날의 계획 변경 요약을 한 줄로 그린다.
 * `changeSummary` 가 없으면(null/undefined) 화면이 이 행을 아예 렌더하지 않는다(빈 줄 방지).
 *
 * ★ Figma 의 우측 하트 버튼은 이 티켓 범위 밖(§8 testID·BR 근거 0 — 좋아요/저장 후속 배선, 01b Q3).
 */

export interface ChangeSummaryRowProps {
  changeSummary: string;
}

export function ChangeSummaryRow({
  changeSummary,
}: ChangeSummaryRowProps): ReactElement {
  return (
    <View
      testID="reflection-daily-change-summary"
      className="w-full rounded-card bg-surface-soft px-lg py-md"
    >
      <Text className="font-noto text-label text-muted">{changeSummary}</Text>
    </View>
  );
}
