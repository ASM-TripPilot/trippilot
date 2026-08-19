import type { ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { legDistance } from '@/features/itinerary/model/legDistance';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import { timeBandLabel } from '@/features/itinerary/model/timeBandLabel';
import {
  CoPickCompleteScreen,
  type CoPickCompleteSlot,
} from '@/features/itinerary/ui/CoPickCompleteScreen';
import { WarningTriangleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-335 슬라이스2 · h17 내가 고른 완성 배선 — itinerary GET 을 실 DTO 로 받아 완성 화면을 조립한다.
 *
 * 무엇을 보장하나(BR-U3-07 · INV-3):
 *  - 비고정 슬롯은 **시간대 라벨만**(`timeBandLabel(startAt)`) — 검증 시각(startAt 09:30 등)을 화면으로
 *    흘리지 않는다. 고정 블록(숙소)만 시각("21:00 도착 · 변경 불가")을 실어 내린다.
 *  - 총 거리는 슬라이스1/354 의 `legDistance` **재사용**(서버 distanceRange 합산, 재발명 0) — "이동 X"
 *    라벨을 그대로 leaf 로 내린다.
 *
 * 시각을 붙일지 여부는 여기서 `isFixed` 로 갈라 내려준다 — 화면은 준 것만 그린다.
 */

export interface CoPickCompletePageProps {
  tripId: string;
}

export function CoPickCompletePage({
  tripId,
}: CoPickCompletePageProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);

  // 조회 실패는 침묵하지 않는다(INV-4 원칙 — 빈 화면 영구 유지 금지).
  if (itinerary.isError) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StateNotice
          testID="itinerary-copick-complete-error"
          icon={<WarningTriangleGlyph />}
          title="일정을 불러올 수 없어요"
          description="잠시 후 다시 시도해 주세요."
          actions={[
            {
              testID: 'itinerary-copick-complete-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: () => itinerary.refetch(),
            },
          ]}
        />
      </SafeAreaView>
    );
  }

  // 데이터 도착 전에는 완성 화면(root testID)을 그리지 않는다 — 실 DTO 가 와야 시각 라벨·총거리를
  // 조립할 수 있다. 읽기 전용 뷰라 PUT 데이터 손실 위험은 없다.
  if (itinerary.data === undefined) {
    return (
      <View testID="itinerary-copick-complete-loading" style={{ flex: 1 }} />
    );
  }
  const days = itinerary.data.days;

  const slots: CoPickCompleteSlot[] = days.flatMap((day) =>
    day.slots.map((slot) => ({
      slotKey: buildSlotKey(day.date, slot.poiId),
      bandLabel: timeBandLabel(slot.startAt),
      name: slot.nameKo ?? '이름 준비 중',
      isFixed: slot.isFixed,
      fixedTimeLabel: slot.isFixed
        ? `${slot.startAt.slice(0, 5)} 도착 · 변경 불가`
        : undefined,
      tagsLabel:
        slot.tags && slot.tags.length > 0
          ? slot.tags.map((tag) => `#${tag}`).join(' ')
          : undefined,
    }))
  );

  const totalDistanceLabel = legDistance(
    days.flatMap((day) => day.slots.map((slot) => slot.distanceRange))
  );

  return (
    <CoPickCompleteScreen
      slots={slots}
      totalDistanceLabel={totalDistanceLabel}
      onConfirm={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary',
          params: { tripId },
        })
      }
      onBack={() => router.back()}
    />
  );
}
