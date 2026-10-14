import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { Stack } from 'expo-router';

import { useAccountBoundaryReset } from '@/app/model/useAccountBoundaryReset';
import { useBootstrapGate } from '@/features/auth';
import { SplashScreen } from '@/features/auth';
import { registerPushIfGranted } from '@/shared/push';

import { BOOT_MODULE_LOADED_AT } from './bootClock';

/** 스플래시 최소 노출 하한(ms). 정본 근거 없는 발명값 — 비행 모션 1.3초(SPLASH_FLIGHT_MS)가 끝까지 보이게 맞춘다(TRIP-1383). 실기 체감으로 조정. */
export const SPLASH_MIN_VISIBLE_MS = 1300;

/** HOME 진입 뒤 푸시 토큰 재등록까지 미루는 시간(ms) — exp.host 외부 호출이 홈 첫 요청들과 경쟁하지 않게 한다(TRIP-1362). */
export const PUSH_REGISTER_DELAY_MS = 2500;

/**
 * 부트스트랩 게이트 컨테이너(D1 A안, 루트 셸에 마운트). useBootstrapGate 를 구독해
 * loading 이거나 목적지 미결이거나 최소 노출 하한(SPLASH_MIN_VISIBLE_MS) 미경과면 SplashScreen 을,
 * resolved+하한 경과면 destination 으로 가드된 Stack.Protected 그룹만 노출한다. destination 이
 * 갱신되면(잠정→온라인 복구 교정) 켜지는 그룹이 선언형으로 다시 결정돼 스플래시로 되돌아가지 않는다.
 *
 * floor 는 한 번만 흐르는 하한이다. 기준점은 마운트가 아니라 JS 모듈 로드 시각(`BOOT_MODULE_LOADED_AT`)이라 번들 평가·부팅에
 * 쓴 시간이 하한에 흡수된다(TRIP-1362). 경과 깃발은 true 로 굳고 다시 false 로 안 돈다 — 캐시
 * 토큰으로 즉시 resolve 돼도 첫 화면이 한 프레임은 보이고, 그 뒤의 목적지 교정은 지연시키지 않는다.
 */
export function SplashGate() {
  const { phase, destination } = useBootstrapGate();
  const [floorElapsed, setFloorElapsed] = useState(false);

  useEffect(() => {
    // 이미 흐른 시간만큼 덜어 낸다. 시계가 뒤로 가도(음수 경과) 하한을 넘겨 기다리지 않게 SPLASH_MIN_VISIBLE_MS 로 막는다.
    const elapsed = Date.now() - BOOT_MODULE_LOADED_AT;
    const timer = setTimeout(
      () => setFloorElapsed(true),
      Math.min(
        SPLASH_MIN_VISIBLE_MS,
        Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed)
      )
    );
    return () => clearTimeout(timer);
  }, []);

  // 인증된 진입(로그인·재로그인 포함)마다 조용히 토큰을 다시 올린다 — 조회만, 절대 묻지 않는다(TRIP-835).
  // 서버 등록은 멱등이라 반복해도 무해하다. 홈 첫 요청들과 경쟁하지 않게 HOME 진입 뒤 PUSH_REGISTER_DELAY_MS 만큼
  // 미루고 상호작용이 끝난 뒤에 부른다 — 그 전에 목적지가 바뀌면(로그아웃 등) 취소한다.
  useEffect(() => {
    if (destination !== 'HOME') return;
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        void registerPushIfGranted();
      });
    }, PUSH_REGISTER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [destination]);

  const drawn = phase !== 'loading' && destination !== null && floorElapsed;
  // 훅이라 조기 반환 위에서 부른다(렌더마다 훅 개수가 같아야 한다).
  useAccountBoundaryReset(drawn, destination);

  if (!drawn) {
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
      {/* i04 재계획 요청 시트 — 허브 위에 겹쳐 띄운다(TRIP-750 D1). trips 라우트는 어떤 가드에도
          속하지 않으므로 선언도 가드 밖에 둔다. */}
      <Stack.Screen
        name="trips/[tripId]/planb/index"
        options={{ presentation: 'transparentModal' }}
      />
      {/* ✦ AI 도우미 시트(TRIP-1322 · DEC-U8-13) — 진입 화면 위 투명 모달. (tabs) 밖이라 탭바가 가려진다.
          미인증 딥링크는 가드에 안 걸리지만 세션 생성 401 이면 시트가 스스로 닫힌다. */}
      <Stack.Screen
        name="assistant/index"
        options={{ presentation: 'transparentModal' }}
      />
    </Stack>
  );
}
