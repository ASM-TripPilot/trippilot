import { act, renderHook } from '@testing-library/react-native';

import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';

/**
 * `useDebouncedValue` 단위 — "값이 MS 동안 더 안 바뀌어야 그때 반영한다" 공용 훅의 의미론(TRIP-1617, 원본: PlaceAddPage 의 TRIP-1348 인라인 구현).
 *
 * 3동작 뼈대: 준비=가짜 시계 + 훅 렌더 → 실행=값 바꾸기·시간 흘리기 → 단언=돌려준 값(렌더 프레임 기록 포함).
 * `frames` 는 렌더마다 돌려준 값을 쌓는다 — "중간 값이 한 번도 안 나왔다"는 `result.current`(마지막 값)만 봐서는
 * 증명되지 않기 때문이다(`useElapsedFlag.test.ts` 와 같은 방식).
 */

const MS = 300;

function renderDebounced(initial: string) {
  const frames: string[] = [];
  const hook = renderHook(
    ({ value }: { value: string }) => {
      const out = useDebouncedValue(value, MS);
      frames.push(out);
      return out;
    },
    { initialProps: { value: initial } }
  );
  return { ...hook, frames };
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

// 파일 최상위 — 가짜 시계가 다른 파일로 새지 않게.
afterEach(() => {
  jest.useRealTimers();
});

describe('useDebouncedValue — 지연 반영 값', () => {
  it('H1 · 경계 — 바꾼 뒤 299ms 까진 옛 값, 300ms 가 차는 순간 새 값', () => {
    const { result, rerender } = renderDebounced('a');

    rerender({ value: 'ab' });

    advance(MS - 1);
    expect(result.current).toBe('a');

    advance(1);
    expect(result.current).toBe('ab');
  });

  it('H2 · 연속으로 바꾸면 중간 값은 한 번도 나오지 않고, 마지막 변경 뒤 300ms 에 마지막 값만 나온다', () => {
    const { result, rerender, frames } = renderDebounced('a');

    rerender({ value: 'ab' });
    advance(100);
    rerender({ value: 'abc' });

    // 처음 바꾼 시점 기준(100+299=399 > 300)이면 벌써 'ab' 가 나와야 한다 — 마지막 변경 기준으로 다시 잰다는 증거.
    advance(MS - 1);
    expect(result.current).toBe('a');

    advance(1);
    expect(result.current).toBe('abc');

    // 렌더 프레임 전체에서 'ab' 는 한 번도 반환되지 않았다 — 'a' 에서 곧장 'abc' 로 건너뛴다.
    expect([...new Set(frames)]).toEqual(['a', 'abc']);
  });

  it('H3a · 처음 마운트한 렌더는 지연 없이 초기값을 돌려준다', () => {
    const { result, frames } = renderDebounced('초기');

    // 시간을 한 틱도 안 흘렸다 — 첫 프레임이 이미 초기값이어야 첫 조회가 300ms 늦어지지 않는다.
    expect(frames[0]).toBe('초기');
    expect(result.current).toBe('초기');
  });

  it('H3b · 대기 중에 언마운트하면 예약된 타이머가 남지 않는다', () => {
    const { rerender, unmount } = renderDebounced('a');
    rerender({ value: 'ab' });
    // 앵커 — 값을 바꿨으니 대기 타이머가 실제로 있었다(없으면 아래 0 이 공허하다).
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('H4 · 공용 상수 SEARCH_DEBOUNCE_MS 는 300ms 다 (PERF-U1-03)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });
});
