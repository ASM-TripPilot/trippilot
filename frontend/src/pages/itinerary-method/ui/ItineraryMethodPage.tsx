import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';

/**
 * h04 시작 방법 배선(TRIP-303 → TRIP-305). 방식을 고른다.
 *
 * 완전AI 는 이제 생성을 **직접 쏘지 않는다** — h05(필수 방문지)로 navigate 하고, h05 의 CTA 가
 * h09 로 잇는다(TRIP-454 편입, AC-1). 마운트 시 생성 POST 를 발화하는 것은 여전히 h09 가
 * 소유한다(AC-7·⚑B). 생성 선행조건(거점 커버리지·
 * 겹침) 게이트도 여기 없다 — g02(여행 생성 2/2)가 소유한다. 직접 짜기(manual)는 h19(빈 일정)로
 * navigate 한다(TRIP-460 개통 — 라우트·h19↔h20 배선 기존재). copick(AI와 같이 짜기)은 h09 생성 중
 * 화면을 CO_PLAN 씨앗으로 재사용하도록 navigate 한다(TRIP-462 — 생성 POST 는 씨앗 화면이 소유하고,
 * 완료 시 copick 허브(h16)로 replace 한다).
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
          pathname: '/trips/[tripId]/itinerary/must-visits',
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
      // TRIP-462: copick 게이트 해제 — h09 생성 중 화면을 CO_PLAN 씨앗으로 재사용. mode·successRoute 를
      // 실어 보내면 씨앗이 {generationMode:'CO_PLAN'} 으로 생성하고 완료 시 copick 허브로 replace 한다.
      onPressCoPick={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/generating',
          params: {
            tripId,
            mode: 'CO_PLAN',
            successRoute: '/trips/[tripId]/itinerary/copick',
          },
        })
      }
      // ponytail: 낙관적 스텁(TRIP-404). 서버 동시생성 판정면(선행 BE 칸)이 아직 없어 항상 미차단.
      // 필드 신설 시 여기서 그 판정면을 넘기고 onPressActiveGeneration 을 배선한다.
      activeGeneration={null}
    />
  );
}
