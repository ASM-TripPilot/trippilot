import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useRef } from 'react';

import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';
import { usePostTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * h04 시작 방법 배선(TRIP-303). 방식을 골라 생성을 시작한다.
 *
 * **생성 선행조건(거점 커버리지·겹침) 판단은 여기 없다** — 그 게이트는 여행 생성 2/2(g02,
 * `TripNewStep2Page`)가 소유한다(`generateDisabled = blocked !== false`, 겹침 해소도 g02 의
 * `TripBaseFixSheet`). h04 는 "어떻게 만들지"만 고른다. 완전AI 는 `POST FULLY_AI` 를 1회 쏘고
 * 성공 후 draft 로 간다. copick·manual 은 착지 화면이 아직 없어(01b D2·D3) 화면이 "준비 중"만 낸다.
 *
 * POST 실패는 **침묵하지 않는다**(INV-4) — `isError` 를 화면에 내려 안내를 띄우고, 카드가 활성으로
 * 남아 다시 시도할 수 있게 한다. `isPending` 동안 재탭은 무시해 생성을 두 번 쏘지 않는다.
 */
export function ItineraryMethodPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  // 즉시읽기 락 — `isPending`(다음 렌더에야 참)만으로는 같은 틱 연타를 못 막아 생성이 2건 나간다.
  // 리포 관례(`submitLockedRef`·`beginLock`)대로 ref 로 같은 틱에 바로 잠근다.
  const submitLockedRef = useRef(false);

  const handleFullAi = (): void => {
    if (submitLockedRef.current || generate.isPending) return; // 중복 제출 방어
    submitLockedRef.current = true;
    generate.mutate(
      { tripId, data: { generationMode: 'FULLY_AI' } },
      {
        onSuccess: () =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/draft',
            params: { tripId },
          }),
        // 실패면 락을 풀어 다시 시도할 수 있게 한다(성공은 draft 로 떠나므로 무관).
        onSettled: () => {
          submitLockedRef.current = false;
        },
      }
    );
  };

  return (
    <MethodPickerScreen
      onBack={() => router.back()}
      onPressFullAi={handleFullAi}
      generating={generate.isPending}
      generateFailed={generate.isError}
    />
  );
}
