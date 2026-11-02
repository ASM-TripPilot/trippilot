/**
 * 브라우저 `localStorage` 의 테스트 대역(TRIP-1647). jest 노드 환경에는 전역 `localStorage` 가 없어서(웹 어댑터
 * 테스트 두 파일이 공유) `globalThis` 에 직접 끼웠다 뺀다. 끼운 것은 반드시 파일 최상위 `afterEach` 에서
 * `removeLocalStorage()` 로 뺀다 — 안 빼면 "localStorage 없음" 케이스가 앞 테스트의 가짜를 보고 거짓 green 이 된다.
 */

export interface FakeStorage {
  readonly data: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createFakeStorage(): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** `globalThis.localStorage` 를 읽을 때마다 `read()` 를 부르게 한다 — 던지는 함수를 주면 "접근 자체가 막힌 브라우저". */
export function defineLocalStorage(read: () => unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: read,
  });
}

export function installFakeLocalStorage(): FakeStorage {
  const storage = createFakeStorage();
  defineLocalStorage(() => storage);
  return storage;
}

export function removeLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}
