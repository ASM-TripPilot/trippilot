import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { PastTripRow } from '@/entities/trip';
import { BookmarkGlyph, ChevronRightGlyph } from '@/features/record';
import type { PastTripCardVM } from '../model/recordsCalendar';

/**
 * TRIP-575 · j07 지난 여행 카드 목록. (TRIP-808: 행 자체는 `entities/trip/ui/PastTripRow` 로 이관 —
 * 이 파일은 목록 래핑 + chevron(RecordGlyphs) trailing 주입 + testID 리터럴 조립만 진다.)
 *
 * `record-calendar-past-trip-{tripId}` 리터럴을 explicit prop 으로 넘기므로 그 문자열이 여기 잔존한다.
 */

export interface PastTripListProps {
  pastTrips: PastTripCardVM[];
  onSelectTrip: (tripId: string) => void;
}

export function PastTripList({
  pastTrips,
  onSelectTrip,
}: PastTripListProps): ReactElement {
  // TRIP-1206 · 지난 여행 0개 — 점선 박스 한 줄(Figma 4821:2827). 설명·CTA 없음.
  if (pastTrips.length === 0) {
    return (
      <View
        testID="record-past-empty"
        className="w-full flex-row items-center gap-[12px] rounded-[12px] border border-dashed border-hairline-strong px-[12px] py-[16px]"
      >
        <View className="h-[48px] w-[48px] items-center justify-center rounded-full bg-surface-soft">
          <BookmarkGlyph size={24} />
        </View>
        <Text className="font-noto text-[14px] leading-[20px] text-muted">
          여행이 끝나면 여기에 기록이 쌓여요
        </Text>
      </View>
    );
  }
  return (
    <View className="w-full gap-[12px]">
      {pastTrips.map((card) => (
        <PastTripRow
          key={card.tripId}
          vm={card}
          onPress={() => onSelectTrip(card.tripId)}
          trailing={<ChevronRightGlyph size={20} />}
          testID={`record-calendar-past-trip-${card.tripId}`}
        />
      ))}
    </View>
  );
}
