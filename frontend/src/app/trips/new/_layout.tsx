import { useEffect } from 'react';
import { Stack } from 'expo-router';

import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

/**
 * 여행 생성 위저드 셸(BR-U1-33) — `(tabs)` 밖 몰입 화면이라 탭바가 구조적으로 안 붙는다.
 * 진행 표시(`1 / 2`)는 각 화면(`TripWizardStep1Screen` 등)이 스스로 그린다 — 이 레이아웃은
 * 네이티브 헤더만 끈다.
 *
 * **진입 초기화(TRIP-288 D1)** — 드래프트는 앱이 사는 내내 남는 모듈 싱글턴이라, 지우는 자리가
 * 없으면 여행을 하나 만든 뒤 새로 만들 때 이전 여행의 시드가 그대로 따라온다(그것을 지울 화면은
 * 아직 없다 — g03 미구현). 비우는 것은 **시드 3필드뿐이다**(`resetMustVisits`) — `reset()`을
 * 부르면 사용자가 손으로 채운 여행지·기간·인원·동반·예산·`touched`까지 함께 사라진다(AC-1이
 * 초기화 대상으로 시드 3개만 열거했고, 나머지가 재진입에도 남는 것은 스토어가 스스로 적어 둔
 * 계약이다 — BR-U1-33).
 *
 * 이 자리를 고른 이유는 위저드 **전체**를 감싸서, step1 ↔ step2 왕복과 뒤로가기 복귀로는 다시
 * 마운트되지 않기 때문이다 — 그 왕복에서는 사용자가 x로 뺀 편집이 살아남는다. 반대로 탐색의
 * 「담은 장소로 여행 만들기」 CTA 복귀는 `push('/trips/new/step1')`이라 **진입으로 친다**(D3):
 * 시드가 지금 담은 목록으로 다시 서고, 그 전에 뺀 편집은 함께 사라진다.
 * ⚠️ 그 경로가 실제로 셸을 다시 마운트시키는지는 jest가 증명하지 못한다(`expo-router`가 통째로
 * 목킹된다 — 01b D4, 실기 스모크 몫). 이 파일이 정하는 것은 "초기화는 **마운트에만** 걸린다"
 * 까지고, 의존성이 안정된 액션 하나뿐이라 리렌더로는 돌지 않는다.
 */
export default function TripWizardLayout() {
  const resetMustVisits = useTripWizardStore((state) => state.resetMustVisits);

  useEffect(() => {
    // 진짜 신규 진입(셸 마운트)이면 직전 여행이 남긴 `createdTripId`를 비운다(TRIP-601 가드 c) —
    // 새 여행이 옛 tripId를 물어 그 일정을 이어받는 오염("기존 일정을 새로 만들겠다는 표시")을
    // 막는다. `preserveMustVisitsOnce` 조기 반환 **앞**에 둬야 d02 시드 경로(=역시 새 여행)에서도
    // 비워진다. 마운트 전용 효과라 step1↔step2 왕복(리렌더)에선 진행 중 만든 id가 보존된다.
    // 정본이 `createdTripId` 수명을 정하지 않아(BR-U1-33은 사용자 입력 축만) 자율 세션 가정이다.
    useTripWizardStore.setState({ createdTripId: undefined });

    // d02 "이 장소들로 여행 만들기"는 이 진입을 항상 동반하는데(push('/trips/new/step1')),
    // 그 CTA가 방금 `seedMustVisitsFromD02`로 심은 시드를 여기서 지우면 사용자가
    // 고른 장소가 안 담긴다 — `preserveMustVisitsOnce`가 켜져 있으면 이번 한 번만 건너뛰고
    // 스스로 끈다(다음 진입부터는 다시 평소대로 비운다).
    if (useTripWizardStore.getState().preserveMustVisitsOnce) {
      useTripWizardStore.setState({ preserveMustVisitsOnce: false });
      return;
    }
    resetMustVisits();
  }, [resetMustVisits]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
