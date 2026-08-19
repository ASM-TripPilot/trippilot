import type { ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { coPickProgress } from '@/features/itinerary/model/coPickProgress';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import { timeBandLabel } from '@/features/itinerary/model/timeBandLabel';
import {
  CoPickHubScreen,
  type CoPickHubSlot,
} from '@/features/itinerary/ui/CoPickHubScreen';
import { WarningTriangleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-335 슬라이스2 · h16 허브 배선 — itinerary GET 을 재조회해 찬/빈 슬롯을 다시 그린다(로컬
 * 상태 미보유 · 매번 서버 진실로 렌더).
 *
 * 진행 카운터는 여기서 **순수 함수 `coPickProgress` 한 곳**으로 산출해 화면에 내린다(재판정 금지 —
 * 화면은 그 값을 그리기만 한다, 구조 가드가 두 자리를 갈라 잠근다).
 *
 * 계약 한계(★9): `ItineraryDaysItemSlotsItem.poiId` 가 required 라 "빈 슬롯"(아직 안 고른 자리)을
 * 표현할 방법이 계약에 없다 — 그래서 실 데이터에서 나오는 슬롯은 전부 찬(filled)/고정(fixed)뿐이고
 * `remaining` 은 현재 계약에선 항상 0 이다. "빈 슬롯 → remaining>0 → 확정 disabled" 는 화면이 props
 * 로 잠근다(계약 무의존). 시각 노출은 초안 규칙(BR-U3-07) — 비고정은 시간대 라벨만, 고정만 시각.
 */

export interface CoPickHubPageProps {
  tripId: string;
}

export function CoPickHubPage({ tripId }: CoPickHubPageProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);

  // 조회 실패는 침묵하지 않는다(INV-4 원칙 — 빈 화면 영구 유지 금지). 오류·재시도를 명시한다.
  if (itinerary.isError) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <StateNotice
          testID="itinerary-copick-hub-error"
          icon={<WarningTriangleGlyph />}
          title="일정을 불러올 수 없어요"
          description="잠시 후 다시 시도해 주세요."
          actions={[
            {
              testID: 'itinerary-copick-hub-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: () => itinerary.refetch(),
            },
          ]}
        />
      </SafeAreaView>
    );
  }

  // 데이터 도착 전에는 허브 화면(root·progress testID)을 그리지 않는다 — 매번 서버 진실로만
  // 찬/빈 슬롯을 렌더한다(로컬 상태 미보유). 콜드캐시 가드와 같은 취지: 원본이 없으면 아무 것도
  // 판정하지 않는다. 읽기 전용 뷰라 PUT 데이터 손실 위험은 없다.
  if (itinerary.data === undefined) {
    return <View testID="itinerary-copick-hub-loading" style={{ flex: 1 }} />;
  }
  const days = itinerary.data.days;

  const slots: CoPickHubSlot[] = days.flatMap((day) =>
    day.slots.map((slot) => ({
      slotKey: buildSlotKey(day.date, slot.poiId),
      bandLabel: timeBandLabel(slot.startAt),
      name: slot.nameKo ?? '이름 준비 중',
      status: slot.isFixed ? ('fixed' as const) : ('filled' as const),
      fixedTimeLabel: slot.isFixed
        ? `${slot.startAt.slice(0, 5)} 도착 · 변경 불가`
        : undefined,
    }))
  );

  const progress = coPickProgress(
    days.flatMap((day) =>
      day.slots.map((slot) => ({ fixed: slot.isFixed, filled: true }))
    )
  );

  function goToSlot(slotKey: string): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/copick/[slotKey]',
      params: { tripId, slotKey },
    });
  }

  return (
    <CoPickHubScreen
      slots={slots}
      progress={progress}
      onPickSlot={goToSlot}
      onChangeSlot={goToSlot}
      onConfirm={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/copick/complete',
          params: { tripId },
        })
      }
      onBack={() => router.back()}
    />
  );
}
