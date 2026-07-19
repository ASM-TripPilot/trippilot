import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

import { fetchBootstrap } from '@/shared/api';
import { hasStoredToken } from '@/shared/storage';
import {
  resolveBootstrapDestination,
  type BootstrapDestination,
} from '../model/resolveBootstrapDestination';

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
        // 응답 실패는 타임아웃 폴백/온라인 복구 경로가 처리한다.
      }
    };

    void applyServerResult();

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
    };
  }, []);

  return { phase, destination, isProvisional };
}
