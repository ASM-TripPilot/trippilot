/**
 * 브라우저 `window` 의 테스트 대역(TRIP-1684). jest 노드 환경(`@jest-environment node`)에는 `window` 가 없어서 웹 외부 열기 헬퍼
 * (`window.open`·`location.href`) 테스트가 `globalThis.window` 에 직접 끼웠다 뺀다. 끼운 것은 반드시 파일 최상위 `afterEach` 에서
 * `removeFakeBrowser()` 로 뺀다 — 안 빼면 "window 를 안 건드렸다" 케이스가 앞 테스트의 가짜를 보고 거짓 green 이 된다.
 */

export interface FakeBrowser {
  open: jest.Mock;
  /** `location.href = x` 로 쓰인 값들(현재 탭 이동). */
  hrefWrites: string[];
  /** 가짜 `window` 를 읽은 횟수 — 허용 안 되는 스킴은 0 이어야 한다. */
  windowReads: () => number;
  /** `open` 이 돌려주는 새 탭 — `opener` 가 끊겼는지(null) 본다. */
  tab: { opener: unknown };
}

/** `openResult` 가 `'blocked'` 면 `window.open` 이 null(팝업 차단), 아니면 새 탭 객체. */
export function installFakeBrowser(
  openResult: 'tab' | 'blocked' = 'tab'
): FakeBrowser {
  const hrefWrites: string[] = [];
  const tab = { opener: { stillConnected: true } as unknown };
  const open = jest.fn(() => (openResult === 'blocked' ? null : tab));
  const location = {};
  Object.defineProperty(location, 'href', {
    configurable: true,
    get: () => 'https://app.test/current',
    set: (value: string) => {
      hrefWrites.push(value);
    },
  });
  const fakeWindow = { open, location };
  let reads = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get: () => {
      reads += 1;
      return fakeWindow;
    },
  });
  return { open, hrefWrites, windowReads: () => reads, tab };
}

export function removeFakeBrowser(): void {
  delete (globalThis as { window?: unknown }).window;
}
