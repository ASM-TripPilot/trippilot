import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import * as SplashScreen from 'expo-splash-screen';
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from '@tanstack/react-query';

import { installForegroundPresentation } from '@/shared/push';
import { ToastHost } from '@/shared/ui/Toast';

import { initSentry } from './initSentry';
import { createAppQueryClient } from './queryClient';
import { createQueryFailureReporter } from './reportQueryFailure';
import { SentryRoot } from './SentryRoot';
import { COLOR_TOKENS } from '@/shared/config';

// 모듈 스코프에서 한 번만 만든다 — 리렌더마다 만들면 캐시가 사라진다. 최종 실패 보고는 Sentry 가 꺼져 있어도(DSN 없음) 그대로 건다 — 클라이언트가 없으면 Sentry 쪽이 no-op 이다.
const queryClient = createAppQueryClient(createQueryFailureReporter());

// 스택·탭 화면 배경은 React Navigation 테마 색(기본 #F2F2F2)이 깔린다 — 화면 루트 SafeAreaView 에 배경이 없으면
// 상태바·홈 인디케이터 영역에 그 회색이 비친다. 앱 테마 배경을 canvas(tailwind.config.js)로
// 한 번에 바꾼다. Stack contentStyle 이 아니라 테마인 이유: transparentModal(재계획 시트·AI 도우미)에는 테마 배경이
// 안 깔려 뒤 화면이 비쳐야 하는데, contentStyle 은 그 모달에도 깔린다.
const APP_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: COLOR_TOKENS.canvas },
};

// RN 에는 document 가 없어 focusManager 가 항상 focused 로 읽힌다 — 배선하지 않으면 백그라운드에서도
// refetchInterval 이 돈다. AppState 'active' 만 focused 로 본다. jest 는 이 배선을 못 본다.
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
  })
);

// OS 부팅 화면(네이티브 스플래시)을 첫 렌더까지 붙잡는다 — SplashGate 가 그리는 인앱 스플래시와는 별개다.
// ⚠️ 모듈 최상위 호출을 유지한다 — 루트 레이아웃이 이 모듈을 import 하는 순간(번들 로드 시점) 돌아야
// 네이티브 스플래시가 먼저 내려가지 않는다. 컴포넌트·지연 import 로 옮기면 jest 는 못 잡는다.
SplashScreen.preventAutoHideAsync();

// 크래시 수집은 번들 로드 시점에 한 번 켠다(DSN 없으면 no-op — initSentry 참고). 돌려준 값(추적 통합, 꺼졌으면 null)은 SentryRoot 가 쓴다.
const sentryTracing = initSentry();

// 앱이 켜져 있어도 푸시를 배너·알림 목록에 보인다 — 설치 전에 온 푸시는 안 보이므로 번들 로드 시점에 한 번.
installForegroundPresentation();

/**
 * 앱 전역 프로바이더(FSD app 층). 라우트 루트 레이아웃(`app/_layout.tsx`)이 `SplashGate` 를 감싸 조립한다.
 * 배치 계약: SentryRoot(가장 바깥) > 제스처 루트 > SafeArea > (QueryClient > children) + ToastHost — QueryClient 는 SplashGate 바깥,
 * ToastHost 는 Stack(SplashGate) 바깥. 폰트는 `app.config.ts` 의 expo-font 플러그인이 네이티브 번들에 넣으므로
 * JS 가 로드를 기다리지 않는다 — 첫 렌더에 곧바로 그린다(폰트명 계약은 `assets/fonts/README.md`).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SentryRoot tracing={sentryTracing}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* SafeAreaProvider 를 제스처 루트 안쪽에 둔다. initialMetrics 에 null 대비 기본값을
          함께 주지 않으면 jest(레이아웃 패스 없음)·initialWindowMetrics=null 환경에서 자식이
          렌더되지 않아 부팅 골격 테스트가 깨진다. */}
        <SafeAreaProvider
          initialMetrics={
            initialWindowMetrics ?? {
              frame: { x: 0, y: 0, width: 0, height: 0 },
              insets: { top: 0, left: 0, right: 0, bottom: 0 },
            }
          }
        >
          {/* SplashGate 바깥. SplashGate 의 훅이 useQueryClient 를 쓰므로, 안에 두면
            Provider가 자기보다 아래에 있게 되어 깨진다(AppProviders.test.tsx가
            SplashGate를 목으로 갈아끼운 상태에서 이 배치를 간접적으로 강제한다). */}
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={APP_THEME}>{children}</ThemeProvider>
          </QueryClientProvider>
          {/* 토스트 호스트는 Stack(SplashGate) 바깥에 한 번. 화면이 back 으로 떠나도 남는다. */}
          <ToastHost />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </SentryRoot>
  );
}
