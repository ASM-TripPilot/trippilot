import '../../global.css';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Inter_700Bold } from '@expo-google-fonts/inter';
import {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
} from '@expo-google-fonts/noto-sans-kr';
import * as SplashScreen from 'expo-splash-screen';

import { SplashGate } from '@/features/auth/containers/SplashGate';

// dev mock 마스터 토글. msw/native 는 RN 런타임에 없는 전역(MessageEvent 등)을 참조해
// import 시점에 크래시하므로, 목이 꺼진 일반 부팅에서 앱이 죽지 않도록 실제 켤 때만 동적
// import 한다. (목 ON 시 msw/native 의 RN 인터셉트·기동 순서는 R1 미검증 — 겹2 상환.)
if (process.env.EXPO_PUBLIC_API_MOCK === '1') {
  import('@/mocks/native')
    .then(({ startMockServer }) => startMockServer())
    .catch((error) => {
      console.warn(
        '[mock] startMockServer 로드 실패 (R1: msw/native RN 미검증, 겹2 상환):',
        error
      );
    });
}

// 네이티브 스플래시(OS 부팅 화면)를 폰트 로드가 끝날 때까지 자동으로 숨기지 않게 붙잡는다.
// 이것은 인앱 SplashScreen 컴포넌트(SplashGate 가 부트스트랩 중 그리는 화면)와는 별개 레이어 —
// OS 가 앱 프로세스 시작 직후 그리는 최초 화면이다.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // tailwind.config 의 fontFamily 토큰(font-inter-bold·font-noto* → Inter_700Bold 등)이
  // 실제로 그려지도록 그 폰트명과 정확히 일치하는 파일을 로드한다. [loaded, error] 반환.
  const [loaded, error] = useFonts({
    Inter_700Bold,
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
  });

  useEffect(() => {
    // 로드 성공이든 실패든 결판나면 네이티브 스플래시를 내려 앱 UI 를 드러낸다.
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // 폰트 결판 전에는 네이티브 스플래시를 유지(빈 렌더) — 시스템 폰트로 잠깐 보였다 바뀌는 깜빡임 방지.
  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SplashGate />
    </GestureHandlerRootView>
  );
}
