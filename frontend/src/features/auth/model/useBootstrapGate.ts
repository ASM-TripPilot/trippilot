import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

import { fetchBootstrap } from '@/shared/api';
import { getTokens, hasStoredToken } from '@/shared/storage';
import {
  getAccessToken,
  hydrate,
  subscribeAccessToken,
} from '@/shared/api/tokenManager';
import {
  resolveBootstrapDestination,
  type BootstrapDestination,
} from './resolveBootstrapDestination';

export const BOOTSTRAP_TIMEOUT_MS = 3000;

type BootstrapPhase = 'loading' | 'resolved';

interface BootstrapGateState {
  phase: BootstrapPhase;
  destination: BootstrapDestination | null;
  isProvisional: boolean;
}

/**
 * 스플래시 게이트: 부트스트랩 응답을 받아 목적지로 분기한다. 타임아웃(3s) 이내에
 * 응답이 없으면 로컬 토큰 유무로 잠정 분기하고(무한 스플래시 금지), 온라인 복구 시
 * 재호출해 서버 판정으로 교정한다.
 *
 * TRIP-172(결함 A·D) — 마운트 시 저장소 토큰을 먼저 메모리(tokenManager)로 복원(hydrate)한
 * 뒤 첫 부트스트랩을 보낸다(재시작 직후에도 첫 요청부터 인증됨). 이후 토큰이 바뀌면(로그인 성공)
 * subscribeAccessToken 이 부트스트랩을 재조회한다 — 단, effect 를 재실행하지 않고 같은
 * applyServerResult 를 다시 부르기만 한다. effect 재실행으로 만들면 3초 타임아웃이 재무장돼
 * 재조회 무응답이 잠정 분기(HOME)로 새어 AC-S2 를 어긴다.
 */
export function useBootstrapGate(): BootstrapGateState {
  const [phase, setPhase] = useState<BootstrapPhase>('loading');
  const [destination, setDestination] = useState<BootstrapDestination | null>(
    null
  );
  const [isProvisional, setIsProvisional] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let unsubscribeToken: (() => void) | null = null;

    const applyServerResult = async () => {
      try {
        const response = await fetchBootstrap();
        if (cancelled) {
          return;
        }
        const hasToken = await hasStoredToken();
        if (cancelled) {
          return;
        }
        settled = true;
        setDestination(resolveBootstrapDestination(response, hasToken));
        setIsProvisional(false);
        setPhase('resolved');
      } catch {
        if (cancelled) {
          return;
        }
        if (!settled) {
          // 최초 왕복의 실패는 타임아웃 폴백/온라인 복구 경로가 처리한다.
          return;
        }
        // settled 이후의 재조회 실패(TRIP-222 03b W-2) — 최초 분기가 끝나면 타임아웃도
        // 온라인 복구(NetInfo)도 다시 안 탄다(위 주석 "effect 재실행 금지" 참고). 이 재조회는
        // 토큰 변경(로그인·`onSessionExpired`)이 불렀으므로, 지금 홀더 값으로 다시 분기해야
        // 세션 만료가 SplashGate 를 LOGIN 으로 재해석한다 — 안 그러면 오프라인 중 세션이
        // 만료돼도 destination 이 옛 값에 갇혀 `(auth)` 그룹이 영영 안 열린다.
        setDestination(getAccessToken() !== null ? 'HOME' : 'LOGIN');
        setIsProvisional(true);
      }
    };

    const bootstrapWithRestoredToken = async () => {
      const stored = await getTokens();
      if (cancelled) {
        return;
      }
      if (stored?.accessToken) {
        hydrate(stored.accessToken);
      }
      await applyServerResult();
      if (cancelled) {
        return;
      }
      // 첫 왕복이 끝난 뒤에만 구독한다 — hydrate 의 복원 통지가 이 콜백을 다시 부르면
      // 부트스트랩이 부팅 시 두 번 나가버린다(케이스 3).
      unsubscribeToken = subscribeAccessToken(() => {
        if (cancelled) {
          return;
        }
        void applyServerResult();
      });
    };

    void bootstrapWithRestoredToken();

    const timer = setTimeout(async () => {
      if (cancelled || settled) {
        return;
      }
      const hasToken = await hasStoredToken();
      if (cancelled || settled) {
        return;
      }
      setDestination(hasToken ? 'HOME' : 'LOGIN');
      setIsProvisional(true);
      setPhase('resolved');
    }, BOOTSTRAP_TIMEOUT_MS);

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && !settled) {
        void applyServerResult();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeToken?.();
    };
  }, []);

  return { phase, destination, isProvisional };
}
