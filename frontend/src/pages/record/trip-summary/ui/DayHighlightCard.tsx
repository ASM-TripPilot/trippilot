import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import {
  CATEGORY_PALETTES,
  type SummaryDayCardVM,
} from '@/features/reflection/index.view';

/**
 * TRIP-1666 · j04 일차 카드(매거진형) — 그 날의 주 카테고리 색 바탕에 큰 `1일차`, `· M곳`, 방문지 칩, 거리 각주.
 * 값은 전부 VM(`SummaryDayCardVM`)이 만든 완성 문자열이고, 색은 팔레트 키로 `CATEGORY_PALETTES` 에서 찾아 `style` 로 칠한다
 * (동적 hex 는 className 이 못 받는다). 목적지가 없어 누를 수 없는 View 다(`›` 없음) — 카드의 일차 번호는 여행 일차가 아니라
 * 기록 있는 날 순번이라 j03 로 잇지 않는다. 소요시간 없음(INV-3). 텍스트는 `1일차`·`· 2곳`·칩·거리를 각각 별도 Text 로 둔다(완전 일치 매처).
 * testID `reflection-summary-day-card` 가 `RevealItem` 의 직접 자식 호스트여야 등장 모션 테스트가 래퍼를 읽는다.
 */
export function DayHighlightCard({
  day,
}: {
  day: SummaryDayCardVM;
}): ReactElement {
  const palette = CATEGORY_PALETTES[day.palette];
  return (
    <View
      testID="reflection-summary-day-card"
      className="mx-xl gap-md rounded-[28px] p-xl"
      style={{ backgroundColor: palette.bg }}
    >
      <View className="flex-row items-end gap-sm">
        <Text
          className="font-noto-bold text-[34px] leading-[38px]"
          style={{ color: palette.fg }}
        >
          {day.dayLabel}
        </Text>
        <Text
          className="pb-[4px] font-noto-bold text-label"
          style={{ color: palette.fg, opacity: 0.75 }}
        >
          {`· ${day.visitCountLabel}`}
        </Text>
      </View>
      {day.places.length > 0 ? (
        <View className="flex-row flex-wrap gap-sm">
          {day.places.map((place, index) => (
            <Text
              // 같은 이름이 한 날에 두 번 올 수 있어 순번을 key 에 섞는다.
              key={`${index}-${place}`}
              numberOfLines={1}
              className="rounded-pill px-[10px] py-[6px] font-noto-bold text-caption"
              style={{ backgroundColor: palette.fg, color: palette.bg }}
            >
              {place}
            </Text>
          ))}
        </View>
      ) : null}
      {day.distance ? (
        <Text
          className="font-noto text-caption"
          style={{ color: palette.fg, opacity: 0.75 }}
        >
          {day.distance}
        </Text>
      ) : null}
    </View>
  );
}
