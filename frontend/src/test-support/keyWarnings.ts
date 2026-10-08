/**
 * React key 경고 감시(테스트 인프라 · TRIP-1296).
 *
 * React 는 목록 key 가 겹치거나 빠져도 테스트를 실패시키지 않고 `console.error` 로만 알린다 — 이 리포엔
 * console.error 를 실패로 바꾸는 jest setup 이 없다. 그래서 콘솔을 엿봐 두 경고를 직접 센다.
 * - 겹침: `"Encountered two children with the same key, `%s`. …"` — key 는 **둘째 인자**에 있다.
 * - 누락: `'Each child in a list should have a unique "key" prop.%s%s …'`
 *
 * 누락 경고는 React 가 **테스트 파일(모듈)당 부모 종류별로 한 번만** 낸다 — 앞선 테스트가 한 번 내면
 * 뒤 테스트에선 다시 안 나온다. 그래서 describe 하나가 아니라 **파일 최상위에서** 걸어 모든 테스트를
 * 지켜본다: 테스트마다 두 경고가 0 이 아니면 그 테스트를 실패시킨다.
 *
 * 쓰는 법: 테스트 파일 최상위(describe 밖)에서 `const keyWarnings = guardKeyWarnings();` 한 줄.
 * 센 두 경고만 출력을 삼키고(실패 메시지가 대신 알린다), 나머지 console.error 는 그대로 내보낸다.
 */
const DUPLICATE_KEY_MESSAGE = 'Encountered two children with the same key';
const MISSING_KEY_MESSAGE =
  'Each child in a list should have a unique "key" prop';

const isMessage = (format: unknown, message: string) =>
  typeof format === 'string' && format.includes(message);

export interface KeyWarnings {
  /** 이 테스트에서 경고된 겹친 key 목록(발생 순서). */
  keys: () => string[];
  /** 이 테스트에서 나온 key 누락 경고 수. */
  missing: () => number;
  /** 지금까지 센 것을 비운다 — 자가검사가 일부러 낸 경고를 치울 때만 쓴다. */
  clear: () => void;
}

export function guardKeyWarnings(): KeyWarnings {
  let spy: jest.SpyInstance;
  const calls = (): unknown[][] => spy.mock.calls;
  const keys = () =>
    calls()
      .filter(([format]) => isMessage(format, DUPLICATE_KEY_MESSAGE))
      .map(([, key]) => String(key));
  const missing = () =>
    calls().filter(([format]) => isMessage(format, MISSING_KEY_MESSAGE)).length;

  beforeEach(() => {
    const original = console.error;
    spy = jest
      .spyOn(console, 'error')
      .mockImplementation((format: unknown, ...rest: unknown[]) => {
        if (
          isMessage(format, DUPLICATE_KEY_MESSAGE) ||
          isMessage(format, MISSING_KEY_MESSAGE)
        ) {
          return;
        }
        original(format, ...rest);
      });
  });

  afterEach(() => {
    const found = { duplicateKeys: keys(), missingKey: missing() };
    spy.mockRestore();
    expect(found).toEqual({ duplicateKeys: [], missingKey: 0 });
  });

  return { keys, missing, clear: () => spy.mockClear() };
}
