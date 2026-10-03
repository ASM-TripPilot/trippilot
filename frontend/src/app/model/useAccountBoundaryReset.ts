import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import { usePreferenceStore } from '@/features/edit-preferences';

/**
 * 계정 경계 정리(TRIP-1077). 스택을 그린 뒤 게이트 목적지가 비LOGIN → LOGIN 으로 바뀌면(로그아웃·세션 만료)
 * 스택을 걷고 로그인으로 바꾼 뒤 이전 계정의 서버 캐시와 취향 세션 스토어를 비운다.
 *
 * - 가드 밖 화면(trips/…)은 가드 전환이 걷어 주지 않는다 — 그래서 직접 dismissAll 한다.
 * - dismissAll 먼저, replace 나중 — 반대면 POP_TO_TOP 이 방금 넣은 (auth) 까지 걷는다.
 * - 스플래시 중(스택 미마운트)엔 라우터 액션의 결과를 보장할 수 없다(throw 또는 재마운트, 미실측) —
 *   그래서 "직전 커밋에 스택을 그렸나"를 본다.
 * - canDismiss 는 가드가 화면을 빼기 전 스택을 읽을 수 있다(03b 경고-1, 6-b 확인 대상).
 * - effect(커밋 뒤)에서 부른다 — replace 는 (auth) 가 라우트에 들어온 뒤라야 먹힌다(TRIP-1034).
 */
export function useAccountBoundaryReset(
  drawn: boolean,
  destination: BootstrapDestination | null
): void {
  const queryClient = useQueryClient();
  const previous = useRef({ drawn, destination });

  useEffect(() => {
    const before = previous.current;
    previous.current = { drawn, destination };
    if (!before.drawn || before.destination === 'LOGIN') return;
    if (destination !== 'LOGIN') return;

    if (router.canDismiss()) router.dismissAll();
    router.replace('/login');
    queryClient.clear();
    usePreferenceStore.getState().reset();
  }, [drawn, destination, queryClient]);
}
