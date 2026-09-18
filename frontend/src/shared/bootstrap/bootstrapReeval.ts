/**
 * 온보딩 완료 → 부트스트랩 재평가를 잇는 디커플드 신호(pub/sub). "온보딩이 방금 끝났다"를
 * 라우터를 관통하지 않고 위(useBootstrapGate)로 올리는 유일한 신호다 — tokenManager 의
 * subscribeAccessToken 과 같은 모양이되, 값 없는 순수 이벤트라 동등비교 가드는 없다.
 */

type BootstrapReevalListener = () => void;

const listeners = new Set<BootstrapReevalListener>();

/** 재평가 신호를 구독한다. 구독 해제 함수를 반환한다. */
export function subscribeBootstrapReeval(
  listener: BootstrapReevalListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 등록된 모든 구독자에게 "지금 부트스트랩을 다시 읽어라"를 통지한다. */
export function notifyBootstrapReeval(): void {
  for (const listener of listeners) {
    listener();
  }
}
