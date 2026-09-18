import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * h04 시작 방법 배선(TRIP-303 → TRIP-305 → TRIP-504). 방식을 고른다.
 *
 * 완전AI 는 생성을 직접 쏘지 않는다 — h05(필수 방문지)로 navigate 하고, h05 의 CTA 가 h09 로
 * 잇는다(TRIP-454). 직접 짜기(manual)는 h19(빈 일정)로 navigate 한다(TRIP-460).
 *
 * **TRIP-504 · copick 재배선(안 (가))** — copick 도 h09 직행을 버리고 h05 로 `mode=CO_PLAN` 을 실어
 * navigate 한다(h05 가 CO_PLAN generating + 첫 슬롯 successRoute 로 잇는다, AC-4/5). 그리고 h04 는
 * **기존 일정 유무를 조회**해, days 가 있으면 재생성 확인을 먼저 띄운다(AC-1/2/3, BR-U3-06/18 —
 * 확인 없이 편집분을 덮어쓰지 않는다). 확인은 바텀시트가 아니라 트리에 렌더되는 **인라인**이라
 * 심판된다(MethodPickerScreen 이 `showRegenerateConfirm` 으로 제어받아 그린다). 생성 POST 는 어느
 * 경로에서도 h04 가 안 쏜다(h09·h19 각자 소유).
 */
export function ItineraryMethodPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  // 덮어쓸 것이 있는가 = 이미 생성된 일정에 슬롯이 담긴 days 가 있는가(조회 부재·빈 일정은 없음).
  const hasExistingItinerary = (itinerary.data?.days.length ?? 0) > 0;

  // 재생성 확인을 먼저 띄워야 하는가. **로딩 중(`isPending`)이면 기존 일정 유무를 아직 모른다** —
  // `data?.days.length ?? 0` 만 보면 이때 false 로 접혀 확인 없이 copick 가 진행돼 기존 일정을 침묵
  // 덮어쓴다(BR-U3-18 위반). 그래서 로딩 창에선 "덮어쓸 수 있다"고 보고 확인을 여는 쪽으로 fail-safe
  // 한다. 404(일정 없음)는 `isPending=false`+`data undefined` 라 이 값이 false → 확인 없이 진행(AC-2).
  const mustConfirmRegenerate = itinerary.isPending || hasExistingItinerary;

  // copick 는 h05 로 `mode=CO_PLAN` 을 싣고 간다 — h05 가 그 신호로 CO_PLAN generating +
  // 첫 슬롯 successRoute 로 잇는다(AC-4/5). generating 직행이 아니다.
  function goToCoPickMustVisits(): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/must-visits',
      params: { tripId, mode: 'CO_PLAN' },
    });
  }

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
      // TRIP-504: 기존 일정이 있거나(확실) 아직 조회 로딩 중(불확실)이면 곧장 진행하지 않고 재생성
      // 확인을 먼저 띄운다. 확실히 없을 때만 바로 h05 로(침묵 덮어쓰기 불가, BR-U3-18).
      onPressCoPick={() => {
        if (mustConfirmRegenerate) {
          setShowRegenerateConfirm(true);
          return;
        }
        goToCoPickMustVisits();
      }}
      showRegenerateConfirm={showRegenerateConfirm}
      onRegenerateContinue={() => {
        setShowRegenerateConfirm(false);
        goToCoPickMustVisits();
      }}
      onRegenerateCancel={() => setShowRegenerateConfirm(false)}
      // ponytail: 낙관적 스텁(TRIP-404). 서버 동시생성 판정면(선행 BE 칸)이 아직 없어 항상 미차단.
      // 필드 신설 시 여기서 그 판정면을 넘기고 onPressActiveGeneration 을 배선한다.
      activeGeneration={null}
    />
  );
}
