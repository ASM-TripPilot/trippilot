import '../../global.css';

import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Inter_700Bold } from '@expo-google-fonts/inter';
import {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
} from '@expo-google-fonts/noto-sans-kr';
import * as SplashScreen from 'expo-splash-screen';

import { SplashGate } from '@/features/auth/containers/SplashGate';

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
      {/* D4 — SafeAreaProvider 를 제스처 루트 안쪽에 둔다. initialMetrics 에 null 대비 기본값을
          함께 주지 않으면 jest(레이아웃 패스 없음)·initialWindowMetrics=null 환경에서 자식이
          렌더되지 않아 부팅 골격 테스트가 깨진다(AC E3 실측). */}
      <SafeAreaProvider
        initialMetrics={
          initialWindowMetrics ?? {
            frame: { x: 0, y: 0, width: 0, height: 0 },
            insets: { top: 0, left: 0, right: 0, bottom: 0 },
          }
        }
      >
        <SplashGate />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
