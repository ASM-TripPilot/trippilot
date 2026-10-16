/**
 * 취향 2/2 배선 (AC2 · AC3 · AC4) — usePreferenceStore ↔ PrefStep2Screen ↔ expo-router.
 * 동행·활동·음식·이동 4축 상태와 토글 액션을 셀렉터로 구독해 Screen에 내려주고,
 * '완료'·일괄 탈출 모두 스토어를 건드리지 않고 홈으로 replace한다(US-ONB-06/07/09/10 —
 * 미선택 축은 null로 유지). TRIP-719: Q4 번복으로 back chevron 제거 — onBack 배선도 사라졌다.
 * TRIP-1421: 두 출구가 온보딩 완료를 부르고, 성공한 뒤에만 홈으로 간다.
 */
import { useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '@/features/edit-preferences';
import { toPreferenceInput } from '@/features/edit-preferences';
import { waitForGateDestination } from '@/features/auth/index.view';
import { completeOnboarding } from '@/shared/api';
import { notifyBootstrapReeval } from '@/shared/lib/bootstrapReeval';
import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';
import { usePutMePreferences } from '@/shared/api/index.hooks';
import { PrefStep2Screen } from './PrefStep2Screen';

export function PrefStep2Page(): ReactElement {
  const router = useRouter();
  const putPreferences = usePutMePreferences();

  // getState()가 아니라 셀렉터로 구독해야 타일을 탭했을 때 화면이 다시 그려진다.
  const selectedCompanions = usePreferenceStore((state) => state.companions);
  const selectedActivities = usePreferenceStore((state) => state.activities);
  const selectedFoods = usePreferenceStore((state) => state.foods);
  const selectedTransports = usePreferenceStore((state) => state.transports);
  const toggleCompanion = usePreferenceStore((state) => state.toggleCompanion);
  const toggleActivity = usePreferenceStore((state) => state.toggleActivity);
  const toggleFood = usePreferenceStore((state) => state.toggleFood);
  const toggleTransport = usePreferenceStore((state) => state.toggleTransport);

  const [completeFailed, setCompleteFailed] = useState(false);
  // 완료 응답 대기 잠금 — 두 출구가 공유한다(400ms 연타 창은 응답 대기를 못 덮는다). 실패하면 풀어 재탭 = 재시도.
  const inFlightRef = useRef(false);

  // TRIP-1421 — 완료 성공 → 재평가 신호 → 게이트가 HOME 을 연 뒤 홈. 목적지가 아직 ONBOARDING 인데
  // '/'로 보내면 온보딩 index 로 떨어진다(재평가는 비동기라 신호 직후엔 안 바뀌어 있다).
  const finishOnboarding = async (): Promise<void> => {
    inFlightRef.current = true;
    setCompleteFailed(false);
    try {
      await completeOnboarding();
    } catch {
      inFlightRef.current = false;
      setCompleteFailed(true);
      return;
    }
    notifyBootstrapReeval();
    await waitForGateDestination('HOME');
    openPressGuardWindow();
    router.replace('/');
  };

  // TRIP-1013 #004 — 1/2 '다음'의 창 안이면 무시(연타 관통).
  const handleDone = guardPress(() => {
    if (inFlightRef.current) return;
    // TRIP-471 — 온보딩 완료 시 세션 취향을 서버에 영속한다(slug→서버 enum 번역 경유).
    // fire-and-forget: 실패해도 온보딩 완료(재평가·replace)는 막지 않는다(INV-4 성격 — 취향은
    // 여행 생성 시 프리필로만 쓰여 저장 실패가 흐름을 끊을 이유가 없다). 미선택 축은 null 로 간다(예산은 보내지 않는다).
    putPreferences.mutate({
      data: toPreferenceInput(usePreferenceStore.getState()),
    });
    void finishOnboarding();
  });

  const handleSkipAll = () => {
    // 탈출 경로도 완료로 취급한다(하나만 고치면 다른 쪽 사용자가 갇힘).
    // 스토어는 건드리지 않는다 — 미선택 축이 []가 아니라 null로 유지돼야 한다.
    if (inFlightRef.current) return;
    void finishOnboarding();
  };

  return (
    <PrefStep2Screen
      selectedCompanions={selectedCompanions}
      selectedActivities={selectedActivities}
      selectedFoods={selectedFoods}
      selectedTransports={selectedTransports}
      onToggleCompanion={toggleCompanion}
      onToggleActivity={toggleActivity}
      onToggleFood={toggleFood}
      onToggleTransport={toggleTransport}
      onDone={handleDone}
      onSkipAll={handleSkipAll}
      completeFailed={completeFailed}
    />
  );
}
