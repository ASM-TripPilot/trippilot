/**
 * c08-push 푸시 알림 사전 안내 카드 배선 (TRIP-1108 · 온보딩 location → push → pref1).
 *
 * `계속` → 권한 루틴을 부르고 **기다리지 않고** 취향 1/2 로 간다(R2 — 루틴 안 토큰 발급·POST 는 시간 상한이
 * 없어 기다리면 느린 네트워크에 온보딩이 멈춘다. 루틴은 실패를 삼키고 reject 하지 않는다).
 * `나중에 하기` → 묻지 않고 취향 1/2. 도착만으로는 권한을 조회·요청하지 않는다(카드가 먼저).
 */
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { guardPress } from '@/shared/press/pressGuard';
import { promptAndRegisterPush } from '@/shared/push';
import { PushPreprompt } from '@/shared/push/PushPreprompt';

export function PushPage(): ReactElement {
  const router = useRouter();

  const handleProceed = guardPress(() => {
    void promptAndRegisterPush();
    router.replace('/(onboarding)/pref1');
  });
  const handleDefer = guardPress(() => router.replace('/(onboarding)/pref1'));

  return <PushPreprompt onProceed={handleProceed} onDefer={handleDefer} />;
}
