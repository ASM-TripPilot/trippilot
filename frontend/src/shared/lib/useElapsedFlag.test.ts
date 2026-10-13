import { act, renderHook } from '@testing-library/react-native';

import { useElapsedFlag } from './useElapsedFlag';

/**
 * `useElapsedFlag` 단위 — "`active` 가 `ms` 동안 이어지면 true" 공개 훅의 의미론(TRIP-1109 03b 참고 3).
 *
 * 첫 소비처(h08 컨테이너)는 실패·도착을 이 플래그보다 먼저 판정해서, 훅의 `active &&` 나 타이머
 * 정리를 지워도 그쪽 통합 테스트가 green 이다. 두 번째 소비처가 이 플래그를 먼저 읽으면 그때
 * 처음 드러나므로 훅 자체를 여기서 굳힌다.
 *
 * 3동작 뼈대: 준비=가짜 시계 + 훅 렌더 → 실행=시간 흘리기·prop 바꾸기 → 단언=돌려준 값·예약된 타이머 수.
 * `frames` 는 렌더마다 돌려준 값을 쌓는다 — prop 을 바꾼 **바로 그 렌더**의 값을 보기 위해서다
 * (`rerender` 는 effect 까지 끝낸 뒤 돌아오므로 `result.current` 만 보면 그 한 프레임이 가려진다).
 */

const MS = 1000;

interface Props {
  active: boolean;
  restartKey?: number;
}

function renderFlag(initialProps: Props) {
  const frames: boolean[] = [];
  const hook = renderHook(
    ({ active, restartKey }: Props) => {
      const value = useElapsedFlag(active, MS, restartKey);
      frames.push(value);
      return value;
    },
    { initialProps }
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

describe('useElapsedFlag — 경과 플래그', () => {
  it('E1 · active 가 false 면 시간이 얼마나 가도 false 이고, 타이머를 예약하지도 않는다', () => {
    const { result } = renderFlag({ active: false });
    // 흘리기 **전에** 센다 — 흘린 뒤엔 예약됐던 타이머도 이미 울리고 사라져 0 이다.
    expect(jest.getTimerCount()).toBe(0);

    advance(MS * 3);

    expect(result.current).toBe(false);
  });

  it('E2 · 경계 — ms 직전엔 false, ms 가 차면 true', () => {
    const { result } = renderFlag({ active: true });

    advance(MS - 1);
    expect(result.current).toBe(false);

    advance(1);
    expect(result.current).toBe(true);
  });

  it('E3 · 이미 true 인데 active 가 꺼지면 **그 렌더부터** false(옛 true 가 한 프레임도 새지 않는다)', () => {
    const { result, rerender, frames } = renderFlag({ active: true });
    advance(MS);
    expect(result.current).toBe(true);
    const from = frames.length;

    rerender({ active: false });

    // 앵커 — 끈 뒤 렌더가 실제로 있었다(없으면 아래 "true 없음"이 공허하다).
    expect(frames.length).toBeGreaterThan(from);
    expect(frames.slice(from)).not.toContain(true);
  });

  it('E4 · restartKey 가 바뀌면 0부터 다시 잰다(재시도 = 새 요청 기준)', () => {
    const { result, rerender } = renderFlag({ active: true, restartKey: 0 });
    advance(MS);
    expect(result.current).toBe(true);

    rerender({ active: true, restartKey: 1 });
    expect(result.current).toBe(false);

    advance(MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('E5 · 재기 전에 껐다 켜면 옛 타이머는 취소되고 켠 시점부터 새로 잰다', () => {
    const { result, rerender } = renderFlag({ active: true });
    advance(MS * 0.6);
    rerender({ active: false });
    advance(MS * 0.1);

    rerender({ active: true });

    // 처음 켠 시점 기준이면 여기서 이미 true 다 — 옛 타이머가 살아 있다는 뜻.
    advance(MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });
});
