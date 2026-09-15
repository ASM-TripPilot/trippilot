import type { ReactElement } from 'react';
import { View } from 'react-native';

import { PastTripRow } from '@/entities/trip/ui/PastTripRow';
import { ChevronRightGlyph } from './RecordGlyphs';
import type { PastTripCardVM } from '../model/recordsCalendar';

/**
 * TRIP-575 · j07 지난 여행 카드 목록. (TRIP-808: 행 자체는 `entities/trip/ui/PastTripRow` 로 이관 —
 * 이 파일은 목록 래핑 + chevron(RecordGlyphs) trailing 주입 + testID 리터럴 조립만 진다.)
 *
 * `record-calendar-past-trip-{tripId}` 리터럴을 explicit prop 으로 넘기므로 그 문자열이 여기 잔존해
 * 선재 `recordsCalendarStructure.test.ts` G3 앵커가 재조준 없이 산다.
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
