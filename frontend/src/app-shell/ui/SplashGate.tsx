import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';

import { useBootstrapGate } from '@/features/auth/model/useBootstrapGate';
import { SplashScreen } from '@/features/auth/ui/SplashScreen';

/** 스플래시 최소 노출 하한(ms). 정본 근거 없는 발명값 — 머지 후 실기 체감으로 조정. */
export const SPLASH_MIN_VISIBLE_MS = 900;

/**
 * 부트스트랩 게이트 컨테이너(D1 A안, 루트 셸에 마운트). useBootstrapGate 를 구독해
 * loading 이거나 목적지 미결이거나 최소 노출 하한(SPLASH_MIN_VISIBLE_MS) 미경과면 SplashScreen 을,
 * resolved+하한 경과면 destination 으로 가드된 Stack.Protected 그룹만 노출한다. destination 이
 * 갱신되면(잠정→온라인 복구 교정) 켜지는 그룹이 선언형으로 다시 결정돼 스플래시로 되돌아가지 않는다.
 *
 * floor 는 마운트 후 한 번만 흐르는 하한이다(경과 깃발은 true 로 굳고 다시 false 로 안 돈다) — 캐시
 * 토큰으로 즉시 resolve 돼도 첫 화면이 한 프레임은 보이고, 그 뒤의 목적지 교정은 지연시키지 않는다.
 */
export function SplashGate() {
  const { phase, destination } = useBootstrapGate();
  const [floorElapsed, setFloorElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setFloorElapsed(true),
      SPLASH_MIN_VISIBLE_MS
    );
    return () => clearTimeout(timer);
  }, []);

  if (phase === 'loading' || destination === null || !floorElapsed) {
    return <SplashScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={destination === 'FORCE_UPDATE'}>
        <Stack.Screen name="force-update" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'RECONSENT'}>
        <Stack.Screen name="reconsent" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'LOGIN'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'ONBOARDING'}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={destination === 'HOME'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}
