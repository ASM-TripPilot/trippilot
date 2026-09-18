import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import { PlanbRequestPage } from '@/pages/planb-request';

/**
 * i10 재계획 요청(AI에게 맡길게요) — 얇은 라우트. 배선은 `pages/planb-request`가 진다
 * (`draft.tsx`·`manual/index.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다.
 *
 * TRIP-561: i08 칩 [대안 보기] 가 `?scope=...` 를 실어 이 라우트를 연다 — 그 scope 로 폼 범위를
 * 시드한다(결정 3, 작은 additive). URL 은 신뢰 경계라 알려진 2값만 반영하고 그 외는 스토어 기본
 * (PARTIAL_SLOTS)을 유지한다. 자동 심판 없음(AC 없는 additive) — 6-b 실기·후속.
 */
export default function PlanbRequestRoute() {
  const { tripId, scope } = useLocalSearchParams<{
    tripId: string;
    scope?: string;
  }>();
  const setScope = useReplanFormStore((store) => store.setScope);

  useEffect(() => {
    if (scope === 'FULL_DAY' || scope === 'PARTIAL_SLOTS') {
      setScope(scope);
    }
  }, [scope, setScope]);

  return <PlanbRequestPage tripId={tripId} />;
}
