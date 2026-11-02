// NativeWind 전역 스타일 — 앱 전체에 한 번, 라우트 트리보다 먼저 싣는다(metro withNativeWind input 과 같은 파일).
import '@/app/styles/global.css';

// 부작용 import — AppProviders 모듈 최상위의 preventAutoHideAsync·initSentry 를 첫 렌더 전에 평가시킨다.
// 대입 없는 import 는 Metro inlineRequires(실험, metro.config.js·TRIP-1362)가 사용 시점으로 미루지 않는다. 지우면
// inlineRequires 를 켰을 때 네이티브 스플래시가 먼저 내려가는 깜빡임이 생기는데 jest 는 못 잡는다.
import '@/app/entrypoint/AppProviders';
import type { ComponentType } from 'react';

import { AppProviders, SplashGate } from '@/app';

// 개발 빌드 전용 「실패 주입 켜짐」 표시 — 운영 변환은 `__DEV__` 를 false 로 접어 이 require 를 그래프에서 지운다
// (남으면 metro 운영 blockList 가 export 를 깨뜨린다, `src/shared/dev-fault`).
const DevFaultBadge: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/shared/dev-fault') as { FaultInjectionBadge: ComponentType })
      .FaultInjectionBadge
  : null;

// 루트 레이아웃은 조립만 한다 — 전역 프로바이더(쿼리 캐시·폰트·네이티브 스플래시·SafeArea·제스처·토스트)는
// FSD app 층(`src/app/entrypoint`), 부팅 결과에 따른 라우팅은 `src/app/routing/SplashGate` 가 맡는다(TRIP-1161).
export default function RootLayout() {
  return (
    <AppProviders>
      <SplashGate />
      {DevFaultBadge ? <DevFaultBadge /> : null}
    </AppProviders>
  );
}
