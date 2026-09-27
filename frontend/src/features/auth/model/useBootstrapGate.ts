import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

import { fetchBootstrap } from '@/shared/api';
import { getTokens, hasStoredToken } from '@/shared/storage';
import {
  getAccessToken,
  hydrate,
  subscribeAccessToken,
} from '@/shared/api/tokenManager';
import { subscribeBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';
import { publishGateDestination } from './gateDestination';
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
    let hadStoredToken = false;
    // 요청 세대 — 더 새 요청이 나간 뒤 돌아온 옛 응답은 버린다(TRIP-1034 03b 경고-2).
    let generation = 0;
    let unsubscribeToken: (() => void) | null = null;
    let unsubscribeReeval: (() => void) | null = null;

    const applyServerResult = async () => {
      const mine = ++generation;
      try {
        const response = await fetchBootstrap();
        if (cancelled || mine !== generation) {
          return;
        }
        const hasToken = await hasStoredToken();
        if (cancelled || mine !== generation) {
          return;
        }
        settled = true;
        setDestination(resolveBootstrapDestination(response, hasToken));
        setIsProvisional(false);
        setPhase('resolved');
      } catch {
        if (cancelled || mine !== generation) {
          return;
        }
        if (!settled) {
          // 최초 왕복의 실패 중 "인증 실패"만 여기서 확정한다: 부팅 시 저장 토큰이 있었는데
          // (hadStoredToken) 지금 홀더가 비었다면(getAccessToken() === null) 인터셉터가
          // 401 → onSessionExpired 로 홀더를 비운 것뿐이다(유일한 확정 신호) → LOGIN 확정.
          // 네트워크 실패(홀더 잔존)·게스트(hadStoredToken 거짓)는 타임아웃 폴백/온라인
          // 복구 경로가 처리하도록 그대로 반환한다(무응답은 미확정 · 401만 확정).
          if (hadStoredToken && getAccessToken() === null) {
            settled = true;
            setDestination('LOGIN');
            setIsProvisional(false);
            setPhase('resolved');
          }
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
      // 결함 B 판별의 절반 — "부팅 시 저장 토큰이 hydrate 됐나"(홀더가 401 로 비면 인증 실패).
      hadStoredToken = Boolean(stored?.accessToken);
      // hydrate 뒤·첫 왕복 앞에 구독한다 — hydrate 통지는 이미 지나가 부팅 중복 요청이 없고(케이스 3),
      // 첫 왕복이 느린 동안의 로그아웃도 재조회를 부른다(TRIP-1034 03b 경고-2).
      unsubscribeToken = subscribeAccessToken(() => {
        if (cancelled) {
          return;
        }
        void applyServerResult();
      });
      await applyServerResult();
      if (cancelled) {
        return;
      }
      // 온보딩 완료 재평가 신호(결함 A) — 토큰 구독과 같은 자리·같은 방식(effect 재실행이
      // 아니라 같은 applyServerResult 재호출)이라 3초 타이머가 재무장되지 않는다(AC-S2).
      unsubscribeReeval = subscribeBootstrapReeval(() => {
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
      unsubscribeReeval?.();
    };
  }, []);

  // 목적지 공개(TRIP-1034) — setDestination 호출부 4곳 대신 여기 한 곳. effect 는 commit 뒤에
  // 돌므로 공개 시점엔 SplashGate 가 이미 새 가드로 렌더를 마쳤다.
  useEffect(() => {
    if (destination !== null) {
      publishGateDestination(destination);
    }
  }, [destination]);

  return { phase, destination, isProvisional };
}
