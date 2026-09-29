import type { BootstrapDestination } from './resolveBootstrapDestination';

/**
 * 게이트 목적지 공개 통로(TRIP-1034). `useBootstrapGate` 가 목적지를 바꿀 때마다 여기에 공개하고,
 * 가드 밖 화면(설정의 로그아웃)이 "게이트가 LOGIN 을 열었다"를 기다린 뒤 이동한다 — 가드 밖 화면은
 * 가드 전환이 옮겨 주지 않아서, `(auth)` 가 열리기 전에 이동하면 액션이 무시되고 갇힌다.
 *
 * `useBootstrapGate.ts` 와 파일을 나눈 이유: SplashGate 테스트 3종이 그 모듈을 팩토리 목으로 통째
 * 갈아 끼운다. 같은 파일이면 목 아래에서 이 통로가 사라진다.
 */

let current: BootstrapDestination | null = null;
let waiters: { target: BootstrapDestination; resolve: () => void }[] = [];

export function publishGateDestination(
  destination: BootstrapDestination
): void {
  current = destination;
  const ready = waiters.filter((w) => w.target === destination);
  waiters = waiters.filter((w) => w.target !== destination);
  for (const w of ready) {
    w.resolve();
  }
}

export function getGateDestination(): BootstrapDestination | null {
  return current;
}

/**
 * 지금 값이 `target` 이면 곧바로 끝나고(구독 선례와 달리 현재 값을 재생한다), 아니면 `target` 이
 * 공개되는 순간 끝난다. 다른 값의 공개로는 끝나지 않는다. 상한은 없다(브리프 Q1).
 */
export function waitForGateDestination(
  target: BootstrapDestination
): Promise<void> {
  if (current === target) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push({ target, resolve });
  });
}

/** 테스트용 — 모듈 전역 값을 비운다(대기자는 버린다). */
export function resetGateDestination(): void {
  current = null;
  waiters = [];
}
