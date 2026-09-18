import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { PastTripCardVM } from '../model';

/**
 * TRIP-808 · j07 지난 여행 행 — 순수 프레젠테이션(features/record/ui/PastTripList 의 행에서 이관).
 *
 * 카드 = **제목 + 날짜범위(+박수)만**. 72×72 썸네일·"사진 N·메모 M" 통계는 `Trip` 계약에 필드가 없어
 * 안 그린다(INV-1 정직 degrade). 날짜범위·박수는 **별개 leaf** 로 그린다 — 테스트가 getByText 완전일치로
 * 각각 잡기 때문(한 줄로 합치면 exact 실패). null 라벨은 미렌더(가짜 날짜·가짜 "0박" 금지).
 *
 * chevron 은 카드가 소유하지 않고 소비처가 `trailing` 슬롯으로 주입한다(807 SavedStayCard 동형) —
 * j07 PastTripList 가 RecordGlyphs.ChevronRightGlyph 를 넣는다. testID 도 소비처가 명시 full 문자열
 * (`record-calendar-past-trip-{id}`)로 주입해 그 리터럴이 PastTripList.tsx 에 잔존한다(선재 가드 무재조준).
 */
export interface PastTripRowProps {
  vm: PastTripCardVM;
  onPress: () => void;
  trailing?: ReactNode;
  testID: string;
}

export function PastTripRow({
  vm,
  onPress,
  trailing,
  testID,
}: PastTripRowProps): ReactElement {
  const { title, dateRangeLabel, nightsLabel } = vm;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="w-full flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas p-[12px]"
    >
      <View className="flex-1 gap-[3px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {title}
        </Text>
        {(dateRangeLabel !== null || nightsLabel !== null) && (
          <View className="flex-row items-center">
            {dateRangeLabel !== null && (
              <Text className="font-noto text-label text-muted">
                {dateRangeLabel}
              </Text>
            )}
            {dateRangeLabel !== null && nightsLabel !== null && (
              <Text className="font-noto text-label text-muted"> · </Text>
            )}
            {nightsLabel !== null && (
              <Text className="font-noto text-label text-muted">
                {nightsLabel}
              </Text>
            )}
          </View>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
