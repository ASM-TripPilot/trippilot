// NativeWind 전역 스타일 — 앱 전체에 한 번, 라우트 트리보다 먼저 싣는다(metro withNativeWind input 과 같은 파일).
import '@/app/styles/global.css';

import { AppProviders, SplashGate } from '@/app';

// 루트 레이아웃은 조립만 한다 — 전역 프로바이더(쿼리 캐시·폰트·네이티브 스플래시·SafeArea·제스처·토스트)는
// FSD app 층(`src/app/entrypoint`), 부팅 결과에 따른 라우팅은 `src/app/routing/SplashGate` 가 맡는다(TRIP-1161).
export default function RootLayout() {
  return (
    <AppProviders>
      <SplashGate />
    </AppProviders>
  );
}
