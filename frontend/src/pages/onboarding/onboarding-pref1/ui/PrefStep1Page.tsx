/**
 * 취향 1/2 배선 (AC3 · AC4) — usePreferenceStore ↔ PrefStep1Screen ↔ expo-router.
 * 스타일·페이스 상태와 토글 액션을 셀렉터로 구독해 Screen에 내려주고, '다음'은 pref2로
 * push(back()이 1/2로 돌아오도록 replace가 아니다), skip은 스토어를 건드리지 않고
 * 홈으로 replace한다(US-ONB-11 — 미선택 축은 null로 유지).
 * TRIP-1421: skip 은 온보딩 완료를 부르고, 성공한 뒤에만 홈으로 간다.
 */
import { useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { usePreferenceStore } from '@/features/edit-preferences';
import { waitForGateDestination } from '@/features/auth/index.view';
import { completeOnboarding } from '@/shared/api';
import { notifyBootstrapReeval } from '@/shared/lib/bootstrapReeval';
import { guardPress, openPressGuardWindow } from '@/shared/lib/pressGuard';
import { PrefStep1Screen } from './PrefStep1Screen';

export function PrefStep1Page(): ReactElement {
  const router = useRouter();

  // getState()가 아니라 셀렉터로 구독해야 카드를 탭했을 때 화면이 다시 그려진다.
  const selectedStyles = usePreferenceStore((state) => state.styles);
  const selectedPace = usePreferenceStore((state) => state.pace);
  const toggleStyle = usePreferenceStore((state) => state.toggleStyle);
  const togglePace = usePreferenceStore((state) => state.togglePace);

  // TRIP-1013 #004 — 연타의 두 번째 탭이 2/2 '완료'를 관통하지 않게 창을 연다.
  const handleNext = guardPress(() => {
    if (inFlightRef.current) return;
    router.push('/(onboarding)/pref2');
  });

  const [completeFailed, setCompleteFailed] = useState(false);
  // 완료 응답 대기 잠금 — 실패하면 풀어 재탭 = 재시도.
  const inFlightRef = useRef(false);

  const handleSkipAll = async (): Promise<void> => {
    // 취향 1/2 탈출도 완료로 취급한다(ticket AC-A · US-ONB-11 — pref2 만 고치면 1/2 에서 탈출한
    // 사용자가 갇힌다). 스토어를 건드리지 않는다 — 미선택 축이 []가 아니라 null로 유지돼야 한다.
    // 완료 성공 → 재평가 신호 → 게이트가 HOME 을 연 뒤 홈(TRIP-1421 — PrefStep2Page 와 같은 순서).
    if (inFlightRef.current) return;
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

  return (
    <PrefStep1Screen
      selectedStyles={selectedStyles}
      selectedPace={selectedPace}
      onToggleStyle={toggleStyle}
      onTogglePace={togglePace}
      onNext={handleNext}
      onSkipAll={() => void handleSkipAll()}
      completeFailed={completeFailed}
    />
  );
}
