import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// 루트 배럴이 아니라 weight 서브패스로 — 배럴은 전 weight 폰트 27종을 번들에 끌어온다(TRIP-1347).
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { NotoSansKR_400Regular } from '@expo-google-fonts/noto-sans-kr/400Regular';
import { NotoSansKR_500Medium } from '@expo-google-fonts/noto-sans-kr/500Medium';
import { NotoSansKR_700Bold } from '@expo-google-fonts/noto-sans-kr/700Bold';
import NetInfo from '@react-native-community/netinfo';
import * as SplashScreen from 'expo-splash-screen';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';

import { retryUnlessNotFound } from '@/shared/api';
import { ToastHost } from '@/shared/ui/Toast';

import { initSentry } from './initSentry';

// 서버 상태(TanStack Query)의 앱 전역 캐시 저장소 — 모듈 스코프에서 한 번만 만들어 리렌더마다
// 다시 만들지 않는다. 기본 옵션은 retry 하나만 연다(TRIP-986 #063) — 404("없다")는 다시 물어도
// 답이 같고, 같은 캐시 키의 관찰자들은 요청 하나를 공유해 그 요청을 시작한 관찰자의 retry 가
// 적용되므로 페이지 단독 옵션만으로는 막히지 않는다. staleTime 등 나머지는 여전히 그 값을 실제로
// 쓰는 소비 화면이 붙는 칸에서 근거와 함께 정한다(TRIP-179 D5).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryUnlessNotFound,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});

// RN 에는 document 가 없어 focusManager 가 항상 focused 로 읽힌다 — 배선하지 않으면 백그라운드에서도
// refetchInterval 이 돈다. AppState 'active' 만 focused 로 본다(TRIP-1347). jest 는 이 배선을 못 본다.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => sub.remove();
});

// 오프라인이면 요청을 보류하고 복귀 시 재개한다. isConnected 가 null(미확인)이면 온라인으로 본다.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false);
  }),
);

// 네이티브 스플래시(OS 부팅 화면)를 폰트 로드가 끝날 때까지 자동으로 숨기지 않게 붙잡는다.
// 이것은 인앱 SplashScreen 컴포넌트(SplashGate 가 부트스트랩 중 그리는 화면)와는 별개 레이어 —
// OS 가 앱 프로세스 시작 직후 그리는 최초 화면이다.
// ⚠️ 모듈 최상위 호출을 유지한다 — 루트 레이아웃이 이 모듈을 import 하는 순간(번들 로드 시점) 돌아야
// 네이티브 스플래시가 먼저 내려가지 않는다. 컴포넌트·지연 import 로 옮기면 jest 는 못 잡는다(TRIP-1161).
SplashScreen.preventAutoHideAsync();

// 크래시 수집은 번들 로드 시점에 한 번 켠다(DSN 없으면 no-op — initSentry 참고).
initSentry();

/**
 * 앱 전역 프로바이더(FSD app 층). 라우트 루트 레이아웃(`app/_layout.tsx`)이 `SplashGate` 를 감싸 조립한다.
 * 배치 계약: 제스처 루트 > SafeArea > (QueryClient > children) + ToastHost — QueryClient 는 SplashGate 바깥,
 * ToastHost 는 Stack(SplashGate) 바깥. 폰트 결판 전에는 아무것도 그리지 않는다(`rootLayout*` 테스트).
 */
export function AppProviders({ children }: { children: ReactNode }) {
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
        {/* D4 — SplashGate 바깥. SplashGate 안에 두면 그 훅이 나중에 useQuery로 바뀔 때
            Provider가 자기보다 아래에 있게 되어 깨진다(rootLayoutQueryProvider.test.tsx가
            SplashGate를 목으로 갈아끼운 상태에서 이 배치를 간접적으로 강제한다). */}
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
        {/* TRIP-990 — 토스트 호스트는 Stack(SplashGate) 바깥에 한 번. 화면이 back 으로 떠나도 남는다. */}
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
