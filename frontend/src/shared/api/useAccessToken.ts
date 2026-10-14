import { useSyncExternalStore } from 'react';

import { getAccessToken, subscribeAccessToken } from './tokenManager';

/**
 * 현재 accessToken(없으면 null)을 **구독으로** 읽는다. 렌더 중 `getAccessToken()` 직접 읽기는 React 가 모르는
 * 모듈 변수라 React Compiler 가 "순수"로 보고 memo 해 로그인·로그아웃을 놓친다(TRIP-1364).
 * 토큰이 같은 값으로 다시 세팅되면 통지되지 않는다(tokenManager 동등 비교 가드).
 */
export function useAccessToken(): string | null {
  return useSyncExternalStore(
    (onChange) => subscribeAccessToken(onChange),
    getAccessToken,
    getAccessToken
  );
}
