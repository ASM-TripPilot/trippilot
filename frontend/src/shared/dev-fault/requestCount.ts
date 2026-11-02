/**
 * 개발용 요청 카운터 저장소(TRIP-1714 · M-61) — 나간 요청을 세고 화면 진입·앱 복귀 같은 구간 표식(`mark`) 이후 건수를 알려 준다.
 * 스냅샷은 값이 바뀔 때만 새 객체다(`useSyncExternalStore` 는 읽을 때마다 새 객체면 무한 재렌더한다).
 */
export interface RequestCountSnapshot {
  label: string;
  count: number;
}

export function createRequestCount() {
  let current: RequestCountSnapshot = { label: '', count: 0 };
  const listeners = new Set<() => void>();
  const set = (next: RequestCountSnapshot) => {
    current = next;
    listeners.forEach((listener) => listener());
  };

  return {
    hit: () => set({ ...current, count: current.count + 1 }),
    mark: (label: string) => set({ label, count: 0 }),
    snapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const requestCount = createRequestCount();
