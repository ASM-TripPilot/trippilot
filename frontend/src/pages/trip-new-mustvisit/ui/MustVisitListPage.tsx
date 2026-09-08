import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { MustVisitListScreen } from '@/features/trip/ui/MustVisitListScreen';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { getAccessToken } from '@/shared/api/tokenManager';

/**
 * S12 배선(TRIP-676) — store ↔ 화면 ↔ 라우터를 잇는 유일한 자리.
 *
 * store `mustVisits` 를 **구독만** 한다(재시드는 `TripNewStep1Page` 몫). 제거는 store
 * `removeMustVisit(sourcePoiId)` 로 흘려, 요약 스트립과 **같은 store** 를 줄인다 — 그 단일
 * 출처가 곧 카운트 동기다(AC-3, 별도 배선 없음).
 *
 * 더 담기 목적지는 g01 스트립의 삼항을 그대로 재사용한다(TRIP-367) — 담은 곳이 있으면
 * 담은 장소 화면(d02), 없으면 장소 탐색(d04). 뒤로는 `router.back()`.
 */
export function MustVisitListPage() {
  const router = useRouter();
  const mustVisits = useTripWizardStore((state) => state.mustVisits);
  const removeMustVisit = useTripWizardStore((state) => state.removeMustVisit);
  const { savedPlaces } = useSavedPlaces({
    isAuthed: getAccessToken() !== null,
  });

  return (
    <MustVisitListScreen
      items={mustVisits}
      onRemove={removeMustVisit}
      onAddMore={() =>
        router.push(
          savedPlaces.length > 0 ? '/explore/saved-places' : '/explore/places'
        )
      }
      onBack={() => router.back()}
    />
  );
}
