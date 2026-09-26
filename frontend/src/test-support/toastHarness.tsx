import type { ReactElement, ReactNode } from 'react';
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * TRIP-990 — 소비처 테스트가 루트 토스트 호스트를 함께 그리는 하네스.
 *
 * 실제 앱에서 `ToastHost` 는 `RootLayout` 에 한 번만 있다. 페이지만 렌더하는 테스트 트리에는 호스트가
 * 없어서, 페이지가 `showToast` 를 불러도 토스트가 트리에 오르지 않는다. 그래서 페이지 옆에 호스트를
 * 붙여 "사용자에게 보였다"를 testID 로 잴 수 있게 한다.
 *
 * - Toast 모듈은 함수 안에서 늦게 `require` 한다. 정적 import 면 모듈이 없을 때 이 헬퍼를 쓰는 파일의
 *   기존 테스트까지 전부 "Cannot find module" 로 죽는다.
 * - SafeAreaProvider 는 호스트가 하단 inset 을 읽어도 throw 하지 않게 까는 것이다. `initialMetrics`
 *   없이 감싸면 jest(레이아웃 패스 없음)에서 자식이 렌더되지 않는다.
 * - 스토어는 모듈 싱글턴이라 같은 파일의 테스트 사이로 샌다 — 쓰는 파일은 **파일 최상위**(describe 밖)
 *   `afterEach` 에서 `resetToast()` 를 부른다. 토스트 describe 안에만 걸면 그 앞의 기존 테스트가 띄운
 *   토스트가 describe 첫 테스트로 새어 거짓 green 이 된다(TRIP-990 03b 차단-1 실측).
 */

type ToastModule = typeof import('@/shared/ui/Toast');

function toastModule(): ToastModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/shared/ui/Toast') as ToastModule;
}

const ZERO_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function WithToastHost({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { ToastHost } = toastModule();
  return (
    <SafeAreaProvider initialMetrics={ZERO_METRICS}>
      {children}
      <ToastHost />
    </SafeAreaProvider>
  );
}

/** 떠 있는 토스트와 대기 중인 자동 숨김 타이머를 지운다. */
export function resetToast(): void {
  act(() => toastModule().hideToast());
}
