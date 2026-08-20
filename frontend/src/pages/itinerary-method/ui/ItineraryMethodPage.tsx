import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';

/**
 * h04 시작 방법 배선(TRIP-303 → TRIP-305). 방식을 고른다.
 *
 * 완전AI 는 이제 생성을 **직접 쏘지 않는다** — h09(생성 중)로 navigate 하고, 마운트 시 POST 를
 * 발화하는 것은 h09 가 소유한다(AC-7·⚑B, 현행 인라인 스피너 대체). 생성 선행조건(거점 커버리지·
 * 겹침) 게이트도 여기 없다 — g02(여행 생성 2/2)가 소유한다. 직접 짜기(manual)는 h19(빈 일정)로
 * navigate 한다(TRIP-460 개통 — 라우트·h19↔h20 배선 기존재). copick 은 착지 화면이 아직
 * 없어(01b D2) 화면이 "준비 중"만 낸다.
 */
export function ItineraryMethodPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();

  return (
    <MethodPickerScreen
      onBack={() => router.back()}
      onPressFullAi={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/generating',
          params: { tripId },
        })
      }
      // TRIP-460: 직접 짜기 게이트 해제 — h19(빈 일정)로 navigate. 라우트·h19↔h20 배선은 이미 실재.
      onPressManual={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/manual',
          params: { tripId },
        })
      }
      // ponytail: 낙관적 스텁(TRIP-404). 서버 동시생성 판정면(선행 BE 칸)이 아직 없어 항상 미차단.
      // 필드 신설 시 여기서 그 판정면을 넘기고 onPressActiveGeneration 을 배선한다.
      activeGeneration={null}
    />
  );
}
