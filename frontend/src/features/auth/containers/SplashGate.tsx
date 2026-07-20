import { Stack } from 'expo-router';

import { useBootstrapGate } from '../hooks/useBootstrapGate';
import { SplashScreen } from '../screens/SplashScreen';

/**
 * 부트스트랩 게이트 컨테이너(D1 A안, 루트 셸에 마운트). useBootstrapGate 를 구독해
 * loading 이거나 목적지 미결이면 SplashScreen 을, resolved 면 destination 으로 가드된
 * Stack.Protected 그룹만 노출한다. destination 이 갱신되면(잠정→온라인 복구 교정) 켜지는 그룹이
 * 선언형으로 다시 결정돼 스플래시로 되돌아가지 않는다.
 */
export function SplashGate() {
  const { phase, destination } = useBootstrapGate();

  if (phase === 'loading' || destination === null) {
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
