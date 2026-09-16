import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-783 · 시트 헤더(widgets · presentation-only). 소비처가 `title·dayLabel·dateLabel·meta` 4문자열을
 * 조립해 주입한다 — 합산(`N곳 · X.Xkm`)·날짜 포맷은 셸을 순수하게 유지하려 소비처(페이지/픽스처) 몫이다
 * (01b Q3). 각 leaf 는 값 하나만 담아 `toHaveTextContent` 완전일치로 잠긴다 — 가운뎃점 구분자는 testID
 * 없는 별도 Text 라 어느 leaf 의 값에도 안 섞인다.
 */

export interface SheetHeaderProps {
  title: string;
  dayLabel: string;
  dateLabel: string;
  meta: string;
}

export function SheetHeader({
  title,
  dayLabel,
  dateLabel,
  meta,
}: SheetHeaderProps): ReactElement {
  return (
    <View
      testID="sheet-header-root"
      className="flex-row items-start justify-between gap-sm px-lg pb-md pt-sm"
    >
      <View className="flex-1 flex-row flex-wrap items-center gap-[6px]">
        <Text
          testID="sheet-header-title"
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {title}
        </Text>
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          ·
        </Text>
        <Text
          testID="sheet-header-day"
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {dayLabel}
        </Text>
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          ·
        </Text>
        <Text
          testID="sheet-header-date"
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {dateLabel}
        </Text>
      </View>
      <Text
        testID="sheet-header-meta"
        className="font-noto text-label text-muted"
      >
        {meta}
      </Text>
    </View>
  );
}
