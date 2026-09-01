import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './RecordGlyphs';
import type { PastTripCardVM } from '../model/recordsCalendar';

/**
 * TRIP-575 · j07 지난 여행 카드 목록(무상태 프레젠테이션).
 *
 * 카드 = **제목 + 날짜범위(+박수)만**. 72×72 대표 사진·"사진 N·메모 M" 통계는 그리지 않는다 —
 * `Trip` 계약에 그 필드가 없어(Q2 정직 degrade, 후속 Blocker F) 가짜값을 발명하지 않는다.
 * null 라벨은 미렌더(가짜 박수 금지). 날짜범위·박수는 **별개 Text leaf** 로 그린다 — 테스트가
 * `getByText('2026.5.1–5.3')`·`getByText('2박 3일')` 완전일치로 각각 잡기 때문이다(한 줄 합치면 못 잡음).
 * 카드(testID `record-calendar-past-trip-{tripId}`) press → `onSelectTrip(tripId)`(그 여행 기록으로 진입).
 */

export interface PastTripListProps {
  pastTrips: PastTripCardVM[];
  onSelectTrip: (tripId: string) => void;
}

export function PastTripList({
  pastTrips,
  onSelectTrip,
}: PastTripListProps): ReactElement {
  return (
    <View className="w-full gap-[12px]">
      {pastTrips.map((card) => (
        <Pressable
          key={card.tripId}
          testID={`record-calendar-past-trip-${card.tripId}`}
          accessibilityRole="button"
          onPress={() => onSelectTrip(card.tripId)}
          className="w-full flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas p-[12px]"
        >
          <View className="flex-1 gap-[3px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {card.title}
            </Text>
            {(card.dateRangeLabel !== null || card.nightsLabel !== null) && (
              <View className="flex-row items-center">
                {card.dateRangeLabel !== null && (
                  <Text className="font-noto text-label text-muted">
                    {card.dateRangeLabel}
                  </Text>
                )}
                {card.dateRangeLabel !== null && card.nightsLabel !== null && (
                  <Text className="font-noto text-label text-muted"> · </Text>
                )}
                {card.nightsLabel !== null && (
                  <Text className="font-noto text-label text-muted">
                    {card.nightsLabel}
                  </Text>
                )}
              </View>
            )}
          </View>
          <ChevronRightGlyph size={20} />
        </Pressable>
      ))}
    </View>
  );
}
