import { useLocalSearchParams } from 'expo-router';

import { PlanbRequestPage } from '@/pages/planb-request';

/**
 * i04 재계획 요청(AI에게 맡길게요) — 얇은 라우트. 배선은 `pages/planb-request`가 진다
 * (`draft.tsx`·`manual/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 그대로 내린다.
 *
 * i03 [대안 보기]가 `?scope=…&triggerId=…` 를 실어 이 라우트를 연다. 폼 초기화·scope 반영·감지 트리거
 * 시드는 페이지가 한 흐름으로 한다(TRIP-750). 루트 Stack 이 이 라우트를 `transparentModal` 로
 * 선언해 허브 위에 겹쳐 띄운다(`app-shell/ui/SplashGate.tsx`).
 */
export default function PlanbRequestRoute() {
  const { tripId, scope, triggerId } = useLocalSearchParams<{
    tripId: string;
    scope?: string;
    triggerId?: string;
  }>();

  return (
    <PlanbRequestPage tripId={tripId} scope={scope} triggerId={triggerId} />
  );
}
