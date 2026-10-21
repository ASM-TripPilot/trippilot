import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useNavigationContainerRef } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import { usePreferenceStore } from '@/features/edit-preferences';

/**
 * 계정 경계 정리(TRIP-1077). 스택을 그린 뒤 게이트 목적지가 비LOGIN → LOGIN 으로 바뀌면(로그아웃·세션 만료)
 * 스택을 걷고 로그인으로 바꾼 뒤 이전 계정의 서버 캐시와 취향 세션 스토어를 비운다.
 *
 * - 가드 밖 화면(trips/…)은 가드 전환이 걷어 주지 않는다 — 그래서 직접 루트 스택을 첫 화면만 남기고 걷는다.
 * - 걷기 먼저, replace 나중 — 반대면 POP_TO_TOP 이 방금 넣은 (auth) 까지 걷는다.
 * - 루트 스택을 직접 겨눈다(target). router.dismissAll 은 포커스된 가장 안쪽 스택부터 받아서, 위저드(trips/new)가
 *   2장 이상이면 위저드가 안에서 접고 끝나 루트의 아래 화면이 남았다(TRIP-1502).
 * - 스플래시 중(스택 미마운트)엔 라우터 액션의 결과를 보장할 수 없다(throw 또는 재마운트, 미실측) —
 *   그래서 "직전 커밋에 스택을 그렸나"를 본다.
 * - 걷을지는 루트 스택 index 로 본다 — canDismiss 는 가드가 (tabs) 를 빼기 전 사본을 읽고(TRIP-1431), canGoBack 은
 *   탭 이력도 세는데 탭은 POP_TO_TOP 을 처리하지 않는다. 루트가 index 0 이면 보내지 않는다(미처리 dev 경고).
 * - effect(커밋 뒤)에서 부른다 — replace 는 (auth) 가 라우트에 들어온 뒤라야 먹힌다(TRIP-1034).
 */
export function useAccountBoundaryReset(
  drawn: boolean,
  destination: BootstrapDestination | null
): void {
  const queryClient = useQueryClient();
  const navigation = useNavigationContainerRef();
  const previous = useRef({ drawn, destination });

  useEffect(() => {
    const before = previous.current;
    previous.current = { drawn, destination };
    if (!before.drawn || before.destination === 'LOGIN') return;
    if (destination !== 'LOGIN') return;

    // 최상위는 expo-router 래퍼(`__root`)라 진짜 루트 스택은 그 안쪽이다.
    const rootStack = navigation.getRootState()?.routes[0]?.state;
    if (rootStack?.key && (rootStack.index ?? 0) > 0)
      navigation.dispatch({ type: 'POP_TO_TOP', target: rootStack.key });
    router.replace('/login');
    queryClient.clear();
    usePreferenceStore.getState().reset();
  }, [drawn, destination, queryClient, navigation]);
}
